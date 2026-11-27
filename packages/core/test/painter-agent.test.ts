import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchTimeline,
  CANONICAL_MILESTONE_LABEL,
  createCorridorBaseCanvasWebp,
  createInMemoryGridlockRepository,
  evaluatePainterMilestoneGate,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  paintMilestoneDelta,
  recordAgenticStageRun,
  recordStageRun,
  SCENARIO_BRANCH_WATERMARK,
  RawCaptureSchema,
  GeneratedIllustrationSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type PainterErrorCode,
  type RunSpan,
} from "../src/index.ts";
import { createFixtureWebpBuffer, createPainterTestObservations, createSamplePngBuffer, isWebpBuffer } from "./helpers/fixtures.ts";

describe("Stateful Painter Agent & Timeline Chaining (Seam 3 Core, Ticket #7)", () => {
  test("Part 1 (Generated Illustration Spine, Schema Invariants, Chronological Active Lookup & Milestone Gate): enforces canonical vs ephemeral branch invariants, resolves highest turnNumber, skips non-milestones at 0 tokens, and computes painter cache efficiency", async () => {
    const repository = createInMemoryGridlockRepository();
    const { routineObs, milestoneObs: milestoneObs1 } = createPainterTestObservations();

    const webpBlob = createFixtureWebpBuffer("root-plate");
    assert.equal(isWebpBuffer(webpBlob), true);

    const turn2Plate = GeneratedIllustrationSchema.parse({
      illustrationId: "plate_texas-corridor-main_t2_abcd1234",
      timelineId: "texas-corridor-main",
      turnNumber: 2,
      model: PAINTER_AGENT_MODEL,
      interactionId: "inter_turn_2",
      parentInteractionId: "inter_turn_1",
      parentIllustrationId: "plate_texas-corridor-main_t1_00001111",
      rebootstrappedFromParentWebp: false,
      projectNumbers: [milestoneObs1.projectNumber],
      triggeringObservationIds: [milestoneObs1.id],
      rawCaptureHashes: [milestoneObs1.rawCaptureHash],
      prompt: "Paint Turn 2 corridor plate",
      storageUri: `${ARTIFACT_BUCKET_URI}/illustrations/texas-corridor-main/plate_texas-corridor-main_t2_abcd1234.webp`,
      mimeType: "image/webp",
      byteLength: webpBlob.byteLength,
      sha256: "b".repeat(64),
      isBranch: false,
      epistemicLabel: CANONICAL_MILESTONE_LABEL,
      watermarkText: null,
      createdAt: "2026-10-27T14:10:00.000Z",
      expiresAt: null,
    });

    const turn10Plate = GeneratedIllustrationSchema.parse({
      ...turn2Plate,
      illustrationId: "plate_texas-corridor-main_t10_99887766",
      turnNumber: 10,
      interactionId: "inter_turn_10",
      parentInteractionId: "inter_turn_9",
      parentIllustrationId: "plate_texas-corridor-main_t9_55443322",
      storageUri: `${ARTIFACT_BUCKET_URI}/illustrations/texas-corridor-main/plate_texas-corridor-main_t10_99887766.webp`,
      createdAt: "2026-10-27T15:00:00.000Z",
    });

    const branchPlate = GeneratedIllustrationSchema.parse({
      ...turn2Plate,
      illustrationId: "branch_texas-corridor-main_t11_ef567890",
      turnNumber: 11,
      interactionId: "inter_branch_1",
      parentInteractionId: turn10Plate.interactionId,
      parentIllustrationId: turn10Plate.illustrationId,
      triggeringObservationIds: ["obs_TABS2027009999_branch_only"],
      storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/texas-corridor-main/branch_texas-corridor-main_t11_ef567890.webp`,
      isBranch: true,
      scenarioPrompt: "Simulate +300MW substation expansion",
      epistemicLabel: SCENARIO_BRANCH_WATERMARK,
      watermarkText: SCENARIO_BRANCH_WATERMARK,
      expiresAt: "2027-01-25T15:00:00.000Z",
    });

    // Reject branch/canonical invariant violations at schema boundary
    assert.throws(() => GeneratedIllustrationSchema.parse({ ...branchPlate, storageUri: turn2Plate.storageUri }));
    assert.throws(() => GeneratedIllustrationSchema.parse({ ...branchPlate, expiresAt: null }));
    assert.throws(() => GeneratedIllustrationSchema.parse({ ...branchPlate, watermarkText: null }));
    assert.throws(() =>
      GeneratedIllustrationSchema.parse({ ...turn2Plate, expiresAt: "2027-01-25T15:00:00.000Z" })
    );

    // Save Turn 10 BEFORE Turn 2 (mirroring Firestore lexicographic _t10_ < _t2_ order)
    await repository.saveGeneratedIllustration(turn10Plate, webpBlob);
    await repository.saveGeneratedIllustration(turn2Plate, webpBlob);
    await repository.saveGeneratedIllustration(branchPlate, webpBlob);

    assert.deepEqual(
      (await repository.listGeneratedIllustrationsByTimeline("texas-corridor-main")).map((p) => p.turnNumber),
      [2, 10, 11]
    );
    assert.deepEqual(await repository.readGeneratedIllustrationWebp(turn10Plate.illustrationId), webpBlob);

    // Caller-facing milestone gate skips routine + already-painted canonical milestones at 0 tokens
    const skippedGate = await evaluatePainterMilestoneGate(
      { timelineId: "texas-corridor-main", observations: [routineObs, milestoneObs1] },
      { repository }
    );
    assert.equal(skippedGate.shouldPaint, false);
    assert.equal(skippedGate.result.status, "skipped_no_milestone");
    assert.equal(skippedGate.result.tokensUsed, 0);
    assert.equal(skippedGate.result.imageGenerationsAvoided, 1);
    assert.equal(skippedGate.result.activeIllustration?.illustrationId, turn10Plate.illustrationId);

    // Branch-only observation remains eligible for canonical painting
    const milestoneObsBranchOnly = ObservationSchema.parse({
      ...milestoneObs1,
      id: "obs_TABS2027009999_branch_only",
    });
    const readyGate = await evaluatePainterMilestoneGate(
      {
        timelineId: "texas-corridor-main",
        observations: [routineObs, milestoneObs1, milestoneObsBranchOnly],
      },
      { repository }
    );
    assert.equal(readyGate.shouldPaint, true);
    assert.deepEqual(
      readyGate.milestoneObservations.map((o) => o.id),
      ["obs_TABS2027009999_branch_only"]
    );
    assert.equal(readyGate.ctx.activeIllustration?.illustrationId, turn10Plate.illustrationId);

    const t0 = new Date("2026-10-27T15:07:00.000Z");
    // Uncached painter run recomputes illustrationCacheEfficiencyPercentage (1 avoided / 2 demand = 50%)
    const afterBootstrap = await recordAgenticStageRun(
      {
        stage: "painter_bootstrap",
        status: "agentic_completed",
        tokensUsed: 1500,
        interactionId: "inter_turn_11",
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );
    assert.equal(afterBootstrap.scorecard.illustrationCacheEfficiencyPercentage, 50);

    // Failed/blocked runs must never inflate imageGenerationsAvoided or illustrationCacheHits
    await recordStageRun(
      {
        stage: "painter_milestone_gate",
        execution_mode: "deterministic",
        status: "blocked_by_waf",
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        imageGenerationsAvoidedDelta: 5,
        illustrationCacheHitsDelta: 3,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );
    await recordAgenticStageRun(
      {
        stage: "painter_milestone_delta",
        status: "agentic_failed",
        tokensUsed: 300,
        illustrationCacheHitsDelta: 2,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );

    // Valid skip (+1 avoided -> 2) and cached fallback (+1 cache hit) -> (2 + 1) / (2 + 1 + 1) = 75%
    await evaluatePainterMilestoneGate(
      { timelineId: "texas-corridor-main", observations: [routineObs] },
      { repository }
    );
    const { scorecard } = await recordAgenticStageRun(
      {
        stage: "painter_milestone_delta",
        status: "agentic_completed",
        tokensUsed: 1200,
        interactionId: "inter_turn_12",
        illustrationCacheHitsDelta: 1,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );
    assert.equal(scorecard.imageGenerationsAvoided, 2);
    assert.equal(scorecard.illustrationCacheHits, 1);
    assert.equal(scorecard.illustrationCacheEfficiencyPercentage, 75);
  });

  test("Part 2 (Turn 1 bootstrapCanvas, Real PNG->WebP Lossless Codec, Artifact Pinning & Fail-Closed Guards): validates corridor base canvas, transcodes PNG to RFC-9649 WebP, pins RawCapture retention, and fails closed across status/ID/image sad paths", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const emittedSpans: RunSpan[] = [];
    const { routineObs, milestoneObs } = createPainterTestObservations();

    const fakeVp8lPayload = Buffer.from("5249464616000000574542505650384c0a000000574542505f46414b4521", "hex");
    assert.equal(isWebpBuffer(fakeVp8lPayload), false);
    assert.equal(isWebpBuffer(createCorridorBaseCanvasWebp("texas-corridor-main")), true);

    const rawHtmlGz = gzipSync(Buffer.from("<html>milestone</html>", "utf-8"));
    await repository.saveRawCapture(
      RawCaptureSchema.parse({
        sha256: milestoneObs.rawCaptureHash, connectorId: "tdlr-tabs",
        sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697",
        contentType: "text/html", rawByteLength: 22, compressedByteLength: rawHtmlGz.byteLength,
        storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${milestoneObs.rawCaptureHash}.gz`,
        capturedAt: "2026-10-27T14:00:00.000Z", expiresAt: "2027-01-25T14:00:00.000Z", referencedByMilestone: false,
      }),
      rawHtmlGz
    );

    const cannedResponses: Array<GeminiInteractionResponse | Error> = [
      { id: "inter_turn_1_bootstrap", status: "completed", output_image: { mime_type: "image/png", data: createSamplePngBuffer(2048, 8).toString("base64") }, usage: { total_tokens: 1840 } },
      { id: "inter_incomplete_turn", status: "incomplete", output_image: null, usage: { total_tokens: 320 } },
      { id: "   ", status: "completed", output_image: { mime_type: "image/webp", data: createCorridorBaseCanvasWebp().toString("base64") }, usage: { total_tokens: 150 } },
      new Error("503 Gemini upstream unavailable"),
      { id: "inter_null_image", status: "completed", output_image: null, usage: { total_tokens: 210 } },
      { id: "inter_empty_image", status: "completed", output_image: { mime_type: "image/webp", data: "" }, usage: { total_tokens: 190 } },
      { id: "inter_corrupt_header", status: "completed", output_image: { mime_type: "image/webp", data: Buffer.from("NOT_AN_IMAGE_HEADER", "ascii").toString("base64") }, usage: { total_tokens: 410 } },
    ];

    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          const next = cannedResponses[recordedRequests.length];
          recordedRequests.push(req);
          if (next instanceof Error) throw next;
          if (!next) throw new Error("Unexpected extra Gemini call");
          return next;
        },
      },
    };

    const skipped = await bootstrapCanvas({ timelineId: "texas-corridor-main", observations: [routineObs] }, { repository, geminiClient });
    assert.equal(skipped.status, "skipped_no_milestone");
    assert.equal(recordedRequests.length, 0);

    const decodeStartedAtMs = performance.now();
    const painted = await bootstrapCanvas(
      { timelineId: "texas-corridor-main", observations: [routineObs, milestoneObs] },
      { repository, geminiClient, spanSink: (s) => emittedSpans.push(s) }
    );
    assert.ok(performance.now() - decodeStartedAtMs < 500);
    assert.equal(painted.status, "illustration_painted");
    assert.equal(recordedRequests[0]?.model, PAINTER_AGENT_MODEL);
    assert.equal(recordedRequests[0]?.store, true);
    const sentBase64 = String((recordedRequests[0]?.input as Array<Record<string, unknown>>)[1]?.data ?? "");
    assert.equal(isWebpBuffer(Buffer.from(sentBase64, "base64")), true);
    assert.equal(isWebpBuffer(painted.webpBuffer), true);
    assert.equal(painted.illustration.interactionId, "inter_turn_1_bootstrap");
    const pinnedArtifact = await repository.getRawCaptureByHash(milestoneObs.rawCaptureHash);
    assert.equal(pinnedArtifact?.expiresAt, null);
    assert.equal(pinnedArtifact?.referencedByMilestone, true);

    const milestoneObsNext = ObservationSchema.parse({ ...milestoneObs, id: "obs_TABS2027003697_m2" });
    const sadCases: Array<{ timelineId: string; obs?: typeof milestoneObs; baseCanvasWebp?: Buffer; expectedCode: PainterErrorCode; expectedTokens: number }> = [
      { timelineId: "texas-corridor-main", obs: milestoneObsNext, expectedCode: "timeline_already_bootstrapped", expectedTokens: 0 },
      { timelineId: "corridor-bad-canvas", baseCanvasWebp: fakeVp8lPayload, expectedCode: "invalid_base_canvas", expectedTokens: 0 },
      { timelineId: "corridor-incomplete", expectedCode: "interaction_failed", expectedTokens: 320 },
      { timelineId: "corridor-missing-id", expectedCode: "interaction_failed", expectedTokens: 150 },
      { timelineId: "corridor-thrown", expectedCode: "interaction_failed", expectedTokens: 0 },
      { timelineId: "corridor-null-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 210 },
      { timelineId: "corridor-empty-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 190 },
      { timelineId: "corridor-corrupt-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 410 },
    ];

    await sadCases.reduce<Promise<void>>(async (prev, sc) => {
      await prev;
      const res = await bootstrapCanvas(
        { timelineId: sc.timelineId, observations: [sc.obs ?? milestoneObs], ...(sc.baseCanvasWebp !== undefined ? { baseCanvasWebp: sc.baseCanvasWebp } : {}) },
        { repository, geminiClient, spanSink: (s) => emittedSpans.push(s) }
      );
      assert.equal(res.status, "painter_failed");
      assert.equal(res.errorCode, sc.expectedCode);
      assert.equal(res.tokensUsed, sc.expectedTokens);
    }, Promise.resolve());

    assert.equal(recordedRequests.length, 7);
    assert.equal((await repository.listGeneratedIllustrationsByTimeline("texas-corridor-main")).length, 1);
    assert.equal((await repository.listGeneratedIllustrationsByTimeline("corridor-corrupt-img")).length, 0);
    assert.equal((await repository.getEfficiencyScorecard()).actualTokensUsed, 1840 + 320 + 150 + 210 + 190 + 410);
    assert.equal(emittedSpans.at(-1)?.status, "agentic_failed");
  });

  test("Part 3 (Turn 2+ paintMilestoneDelta Chaining, Continuity Constraints & Structured Expiry Fallback): advances active canonical head, preserves continuity, re-bootstraps on ApiError(404) & status:'failed' expiry, and fails closed on non-canonical/corrupt-cache/auth/model errors", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const { milestoneObs: m1 } = createPainterTestObservations();
    const m2 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027005555_t2", projectNumber: "TABS2027005555", rawCaptureHash: "b".repeat(64), scopeOfWork: "345kV substation interconnect" });
    const m3 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027008888_t3", projectNumber: "TABS2027008888", rawCaptureHash: "c".repeat(64), scopeOfWork: "Phase 2 chilled-water plant" });
    const m4 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027009111_t4", projectNumber: "TABS2027009111", rawCaptureHash: "d".repeat(64), scopeOfWork: "Phase 3 switchgear yard" });
    const m5 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027009222_t5", projectNumber: "TABS2027009222", rawCaptureHash: "e".repeat(64), scopeOfWork: "Phase 4 synchronous condenser" });

    const faultQueue: Array<() => GeminiInteractionResponse> = [];
    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          recordedRequests.push(req);
          const queuedFault = faultQueue.shift();
          if (queuedFault !== undefined) return queuedFault();
          const turnId = `inter_seq_${recordedRequests.length}`;
          return {
            id: turnId,
            status: "completed",
            output_image: { mime_type: "image/webp", data: createFixtureWebpBuffer(turnId).toString("base64") },
            usage: { total_tokens: 1200 },
          };
        },
      },
    };

    // 1. Sad Path: empty timeline, branch-only timeline, and cross-timeline isolation all fail closed with parent_not_found at 0 calls
    const orphanDelta = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(orphanDelta.status, "painter_failed");
    assert.equal(orphanDelta.errorCode, "parent_not_found");

    const branchOnlyBlob = createFixtureWebpBuffer("branch-only");
    await repository.saveGeneratedIllustration(
      GeneratedIllustrationSchema.parse({
        illustrationId: "branch_texas-corridor-main_t1_deadbeef",
        timelineId: "texas-corridor-main",
        turnNumber: 1,
        model: PAINTER_AGENT_MODEL,
        interactionId: "inter_branch_only",
        parentInteractionId: "inter_ext",
        parentIllustrationId: "plate_ext",
        rebootstrappedFromParentWebp: false,
        projectNumbers: [m1.projectNumber],
        triggeringObservationIds: ["obs_branch_only"],
        rawCaptureHashes: [m1.rawCaptureHash],
        prompt: "Ephemeral branch",
        storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/texas-corridor-main/branch_texas-corridor-main_t1_deadbeef.webp`,
        mimeType: "image/webp",
        byteLength: branchOnlyBlob.byteLength,
        sha256: "f".repeat(64),
        isBranch: true,
        scenarioPrompt: "What-if scenario",
        epistemicLabel: SCENARIO_BRANCH_WATERMARK,
        watermarkText: SCENARIO_BRANCH_WATERMARK,
        createdAt: "2026-10-27T14:00:00.000Z",
        expiresAt: "2027-01-25T14:00:00.000Z",
      }),
      branchOnlyBlob
    );
    const branchOnlyDelta = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(branchOnlyDelta.status, "painter_failed");
    assert.equal(branchOnlyDelta.errorCode, "parent_not_found");

    await bootstrapCanvas({ timelineId: "other-corridor", observations: [m1] }, { repository, geminiClient });
    const crossLineageDelta = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(crossLineageDelta.status, "painter_failed");
    assert.equal(crossLineageDelta.errorCode, "parent_not_found");
    assert.equal(recordedRequests.length, 1);

    // 2. Happy Path: Turn 1 bootstrap + Turn 2 delta chaining with visual continuity prompt
    const turn1 = await bootstrapCanvas({ timelineId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(turn1.status, "illustration_painted");

    const turn2 = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m1, m2] }, { repository, geminiClient });
    assert.equal(turn2.status, "illustration_painted");
    assert.equal(recordedRequests[2]?.previous_interaction_id, turn1.illustration.interactionId);
    assert.match(String(recordedRequests[2]?.input), /camera angle.*topography.*typography.*existing corridor infrastructure/i);
    assert.equal(turn2.illustration.turnNumber, 2);
    assert.equal(turn2.illustration.parentIllustrationId, turn1.illustration.illustrationId);
    assert.equal(turn2.rebootstrappedFromParentWebp, false);
    assert.deepEqual(turn2.illustration.triggeringObservationIds, [m2.id]);

    const repeatSkip = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m1, m2] }, { repository, geminiClient });
    assert.equal(repeatSkip.status, "skipped_no_milestone");
    assert.equal(recordedRequests.length, 3);

    // 3. Structured Expiry Fallback A: thrown @google/genai ApiError { status: 404, message: "Requested entity was not found." }
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const turn3 = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m3] }, { repository, geminiClient });
    assert.equal(turn3.status, "illustration_painted");
    assert.equal(recordedRequests.length, 5);
    assert.equal(recordedRequests[3]?.previous_interaction_id, turn2.illustration.interactionId);
    assert.equal(recordedRequests[4]?.previous_interaction_id, undefined);
    const fallbackImgB64 = String((recordedRequests[4]?.input as Array<Record<string, unknown>>)[1]?.data ?? "");
    assert.equal(isWebpBuffer(Buffer.from(fallbackImgB64, "base64")), true);
    assert.equal(turn3.rebootstrappedFromParentWebp, true);

    // 4. Structured Expiry Fallback B: status: "failed" with errors: [{ code: "previous_interaction_expired" }] accumulates priorTokensUsed
    faultQueue.push(() => ({
      id: "inter_failed_expired",
      status: "failed",
      errors: [{ code: "previous_interaction_expired", message: "Stored interaction TTL elapsed" }],
      usage: { total_tokens: 45 },
    }));
    const turn4 = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m4] }, { repository, geminiClient });
    assert.equal(turn4.status, "illustration_painted");
    assert.equal(turn4.rebootstrappedFromParentWebp, true);
    assert.equal(turn4.tokensUsed, 45 + 1200);
    assert.equal((await repository.getEfficiencyScorecard()).illustrationCacheHits, 2);

    // 5. Sad Path: non-expiry errors (401 key expired, 400 API key expired, 404 model not found, budget_exceeded) must NEVER trigger fallback
    const nonExpiryFaults: Array<{ fault: () => GeminiInteractionResponse; expectedTokens: number }> = [
      { fault: () => { throw Object.assign(new Error("401 API key expired"), { status: 401 }); }, expectedTokens: 0 },
      { fault: () => { throw Object.assign(new Error("API key expired. Please renew the API key."), { status: 400 }); }, expectedTokens: 0 },
      { fault: () => { throw Object.assign(new Error("models/gemini-3-pro-image is not found"), { status: 404 }); }, expectedTokens: 0 },
      { fault: () => ({ id: "inter_budget", status: "budget_exceeded", output_image: null, usage: { total_tokens: 275 } }), expectedTokens: 275 },
    ];

    await nonExpiryFaults.reduce<Promise<void>>(async (prev, item) => {
      await prev;
      const callsBefore = recordedRequests.length;
      faultQueue.push(item.fault);
      const failed = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m5] }, { repository, geminiClient });
      assert.equal(failed.status, "painter_failed");
      assert.equal(failed.errorCode, "interaction_failed");
      assert.equal(failed.tokensUsed, item.expectedTokens);
      assert.equal(failed.activeIllustration?.illustrationId, turn4.illustration.illustrationId);
      assert.equal(recordedRequests.length, callsBefore + 1);
    }, Promise.resolve());

    // 6. Sad Path: corrupt or missing cached parent .webp in storage when previous_interaction_id expires fails closed without firing fallback
    await repository.saveGeneratedIllustration(turn4.illustration, Buffer.from("CORRUPT_WEBP_BYTES", "ascii"));
    const callsBeforeCorruptCache = recordedRequests.length;
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const corruptCacheFallback = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m5] }, { repository, geminiClient });
    assert.equal(corruptCacheFallback.status, "painter_failed");
    assert.equal(corruptCacheFallback.errorCode, "interaction_failed");
    assert.equal(corruptCacheFallback.activeIllustration?.illustrationId, turn4.illustration.illustrationId);
    assert.equal(recordedRequests.length, callsBeforeCorruptCache + 1);

    const missingBlobRepo = { ...repository, readGeneratedIllustrationWebp: async () => null };
    const callsBeforeMissingCache = recordedRequests.length;
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const missingCacheFallback = await paintMilestoneDelta({ timelineId: "texas-corridor-main", observations: [m5] }, { repository: missingBlobRepo, geminiClient });
    assert.equal(missingCacheFallback.status, "painter_failed");
    assert.equal(missingCacheFallback.errorCode, "interaction_failed");
    assert.equal(missingCacheFallback.activeIllustration?.illustrationId, turn4.illustration.illustrationId);
    assert.equal(recordedRequests.length, callsBeforeMissingCache + 1);
  });

  test("Part 4 (branchTimeline Ephemeral Scenario Forking, Sharp Pixel+XMP Watermark, Sibling Isolation & +90d TTL): encodes JPEG/PNG/WebP via sharp with crimson/ivory banner and XMP rights, isolates sibling plateIds, fails closed on corrupt/missing-XMP outputs, and enforces TTL/quota", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const { milestoneObs: rootObs } = createPainterTestObservations();
    await repository.appendObservation(rootObs);

    const assertBranchBannerAndXmp = async (webp: Buffer, expectedWidth: number, expectedHeight: number): Promise<void> => {
      assert.equal(isWebpBuffer(webp), true);
      assert.equal(webp.subarray(12, 16).toString("ascii"), "VP8X");
      assert.ok(webp.toString("utf-8").includes(`<dc:rights>${SCENARIO_BRANCH_WATERMARK}</dc:rights>`));
      const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, expectedWidth);
      assert.equal(info.height, expectedHeight);
      // Top-left (0, 0) is crimson banner background (#9E2A2B)
      assert.ok((data[0] ?? 0) > 120 && (data[1] ?? 255) < 75 && (data[2] ?? 255) < 75);
      // Banner region contains both crimson background and ivory glyph ink (#F5F2EB)
      const bannerPixels = expectedWidth * Math.min(expectedHeight, 12);
      const hasIvoryInk = Array.from({ length: bannerPixels }, (_, idx) => {
        const off = idx * 4;
        return (data[off] ?? 0) > 200 && (data[off + 1] ?? 0) > 200 && (data[off + 2] ?? 0) > 195;
      }).some(Boolean);
      assert.equal(hasIvoryInk, true);
    };

    const rawPlateWebp = createFixtureWebpBuffer("branch-base");
    const responseQueue: GeminiInteractionResponse[] = [];
    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          recordedRequests.push(req);
          const queued = responseQueue.shift();
          if (queued) return queued;
          return {
            id: `inter_turn_${recordedRequests.length}`,
            status: "completed",
            ...(req.previous_interaction_id !== undefined ? { previous_interaction_id: req.previous_interaction_id } : {}),
            output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
            usage: { total_tokens: 1250 },
          };
        },
      },
    };

    responseQueue.push({
      id: "inter_branch_parent_root",
      status: "completed",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1250 },
    });
    const rootResult = await bootstrapCanvas(
      { timelineId: "texas-corridor-main", observations: [rootObs], now: new Date("2026-10-27T18:05:00.000Z") },
      { repository, geminiClient }
    );
    assert.equal(rootResult.status, "illustration_painted");

    // 1. Happy Path: sharp-encoded WebP branch stamps crimson/ivory banner + VP8X/XMP + sibling isolation
    const branchNow = new Date("2026-10-28T10:00:00.000Z");
    const expectedExpiresAt = new Date(branchNow.getTime() + NINETY_DAYS_MS).toISOString();
    responseQueue.push({
      id: "inter_scenario_branch_01",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1250 },
    });
    const branchResult = await branchTimeline(
      {
        parentInteractionId: "inter_branch_parent_root",
        scenarioPrompt: "Simulate ERCOT 450MW large-load interconnection curtailment in Ellis County",
        now: branchNow,
      },
      { repository, geminiClient }
    );
    assert.equal(branchResult.status, "illustration_painted");
    assert.equal(branchResult.operation, "branchTimeline");
    const branchPlate = GeneratedIllustrationSchema.parse(branchResult.illustration);
    assert.equal(branchPlate.isBranch, true);
    assert.equal(branchPlate.turnNumber, 2);
    assert.equal(branchPlate.parentInteractionId, "inter_branch_parent_root");
    assert.equal(branchPlate.parentIllustrationId, rootResult.illustration.illustrationId);
    assert.equal(branchPlate.epistemicLabel, SCENARIO_BRANCH_WATERMARK);
    assert.equal(branchPlate.watermarkText, SCENARIO_BRANCH_WATERMARK);
    assert.equal(branchPlate.expiresAt, expectedExpiresAt);
    assert.ok(branchPlate.storageUri.startsWith("gs://gridlock-artifacts/branches/ephemeral/texas-corridor-main/"));
    await assertBranchBannerAndXmp(branchResult.webpBuffer, 64, 36);

    // Sibling branch with identical output_image bytes must get a distinct illustrationId & storageUri without overwriting branch 1
    responseQueue.push({
      id: "inter_scenario_branch_02",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1180 },
    });
    const siblingBranch = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Simulate Oncor 345kV double-circuit upgrade", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(siblingBranch.status, "illustration_painted");
    assert.notEqual(siblingBranch.illustration.illustrationId, branchPlate.illustrationId);
    assert.notEqual(siblingBranch.illustration.storageUri, branchPlate.storageUri);
    assert.equal((await repository.listGeneratedIllustrationsByTimeline("texas-corridor-main")).length, 3);

    // 2. Real PNG and JPEG responses transcode single-pass through sharp with crimson/ivory banner & XMP rights
    const widePng = createSamplePngBuffer(200, 24);
    responseQueue.push({
      id: "inter_branch_png",
      status: "completed",
      output_image: { mime_type: "image/png", data: widePng.toString("base64") },
      usage: { total_tokens: 900 },
    });
    const pngBranch = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "PNG single-line watermark verification", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(pngBranch.status, "illustration_painted");
    await assertBranchBannerAndXmp(pngBranch.webpBuffer, 200, 24);

    const sampleJpeg = await sharp({
      create: { width: 120, height: 40, channels: 3, background: { r: 245, g: 242, b: 235 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    responseQueue.push({
      id: "inter_branch_jpeg",
      status: "completed",
      output_image: { mime_type: "image/jpeg", data: sampleJpeg.toString("base64") },
      usage: { total_tokens: 910 },
    });
    const jpegBranch = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "JPEG single-pass sharp watermark verification", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(jpegBranch.status, "illustration_painted");
    await assertBranchBannerAndXmp(jpegBranch.webpBuffer, 120, 40);

    // 3. Sad Path via public seams: corrupt VP8X, empty payload, and missing XMP rights fail closed without overwriting active plate
    const brokenVp8x = Buffer.from(branchResult.webpBuffer);
    brokenVp8x[20] = 0x00;
    const rejectedCanvas = await bootstrapCanvas(
      { timelineId: "corridor-corrupt-vp8x", observations: [rootObs], baseCanvasWebp: brokenVp8x },
      { repository, geminiClient }
    );
    assert.equal(rejectedCanvas.status, "painter_failed");
    assert.equal(rejectedCanvas.errorCode, "invalid_base_canvas");

    const truncatedWebp = branchResult.webpBuffer.subarray(0, 32);
    responseQueue.push({
      id: "inter_branch_corrupt_vp8x",
      status: "completed",
      output_image: { mime_type: "image/webp", data: truncatedWebp.toString("base64") },
      usage: { total_tokens: 300 },
    });
    const rejectedBranchImg = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Corrupt WebP output rejection", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(rejectedBranchImg.status, "painter_failed");
    assert.equal(rejectedBranchImg.errorCode, "corrupt_or_empty_image");

    responseQueue.push({
      id: "inter_branch_missing_xmp",
      status: "completed",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 310 },
    });
    const missingXmpBranch = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Unwatermarked custom encoder rejection", now: branchNow },
      {
        repository,
        geminiClient,
        imageEncoder: () => ({
          ok: true,
          webpBuffer: rawPlateWebp,
          sha256: createHash("sha256").update(rawPlateWebp).digest("hex"),
        }),
      }
    );
    assert.equal(missingXmpBranch.status, "painter_failed");
    assert.equal(missingXmpBranch.errorCode, "corrupt_or_empty_image");
    assert.equal(missingXmpBranch.activeIllustration?.illustrationId, rootResult.illustration.illustrationId);

    // 4. Pre-Gemini validation & quota rejections write zero run_records and zero Gemini requests; +90d TTL frees quota & blocks expired parents
    const runsBeforePreconditions = (await repository.listRunRecords()).length;
    const agenticBeforePreconditions = (await repository.getEfficiencyScorecard()).agenticRunsCount;
    const callsBeforePreconditions = recordedRequests.length;

    const emptyPrompt = await branchTimeline({ parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "   ", now: branchNow }, { repository, geminiClient });
    assert.equal(emptyPrompt.status, "painter_failed");
    assert.equal(emptyPrompt.errorCode, "invalid_scenario_prompt");

    const oversizedPrompt = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "x".repeat(MAX_SCENARIO_PROMPT_LENGTH + 1), now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(oversizedPrompt.status, "painter_failed");
    assert.equal(oversizedPrompt.errorCode, "invalid_scenario_prompt");

    const unknownParent = await branchTimeline({ parentInteractionId: "inter_missing", scenarioPrompt: "Simulate upgrade", now: branchNow }, { repository, geminiClient });
    assert.equal(unknownParent.status, "painter_failed");
    assert.equal(unknownParent.errorCode, "parent_not_found");

    const crossLineage = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", timelineId: "other-corridor", scenarioPrompt: "Cross timeline fork", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(crossLineage.status, "painter_failed");
    assert.equal(crossLineage.errorCode, "parent_not_found");

    const quotaExceeded = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Exceeding active branch cap", maxBranchesPerTimeline: 4, now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(quotaExceeded.status, "painter_failed");
    assert.equal(quotaExceeded.errorCode, "branch_quota_exceeded");

    const postExpiryNow = new Date(branchNow.getTime() + NINETY_DAYS_MS + 1_000);
    const expiredParentFork = await branchTimeline(
      { parentInteractionId: "inter_scenario_branch_01", scenarioPrompt: "Forking expired +90d branch", now: postExpiryNow },
      { repository, geminiClient }
    );
    assert.equal(expiredParentFork.status, "painter_failed");
    assert.equal(expiredParentFork.errorCode, "parent_not_found");

    assert.equal(recordedRequests.length, callsBeforePreconditions);
    assert.equal((await repository.listRunRecords()).length, runsBeforePreconditions);
    assert.equal((await repository.getEfficiencyScorecard()).agenticRunsCount, agenticBeforePreconditions);

    // After +90d TTL elapses, prior ephemeral branches no longer consume maxBranchesPerTimeline=1
    responseQueue.push({
      id: "inter_post_expiry_fresh_branch",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1100 },
    });
    const postExpiryBranch = await branchTimeline(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Fresh branch after +90d TTL expiry", maxBranchesPerTimeline: 1, now: postExpiryNow },
      { repository, geminiClient }
    );
    assert.equal(postExpiryBranch.status, "illustration_painted");
  });

  test("Part 5 (branchTimeline Serialized Slot Admission & Post-Save Scorecard Release): avoids double-counting slots during scorecard writes and prevents stale-snapshot over-admission", async () => {
    const baseRepo = createInMemoryGridlockRepository();
    const { milestoneObs: obs } = createPainterTestObservations();
    await baseRepo.appendObservation(obs);
    const webp = createFixtureWebpBuffer("slot-coordinator");

    let interSeq = 0;
    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async (req) => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return {
            id: `inter_slot_${++interSeq}`,
            status: "completed",
            ...(req.previous_interaction_id !== undefined
              ? { previous_interaction_id: req.previous_interaction_id }
              : {}),
            output_image: { mime_type: "image/webp", data: webp.toString("base64") },
            usage: { total_tokens: 150 },
          };
        },
      },
    };

    const rootRelease = await bootstrapCanvas(
      {
        timelineId: "corridor-slot-release",
        observations: [obs],
        now: new Date("2026-10-27T18:05:00.000Z"),
      },
      { repository: baseRepo, geminiClient }
    );
    assert.equal(rootRelease.status, "illustration_painted");

    let notifyPlateSaved: (() => void) | undefined;
    const firstPlateSaved = new Promise<void>((resolve) => {
      notifyPlateSaved = resolve;
    });
    let releaseRunGate: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => {
      releaseRunGate = resolve;
    });

    let branchSavedOnce = false;
    let delayedFirstRun = false;
    const trackedRepo: GridlockRepository = {
      ...baseRepo,
      saveGeneratedIllustration: async (plate, webpBuf) => {
        await baseRepo.saveGeneratedIllustration(plate, webpBuf);
        if (plate.isBranch && !branchSavedOnce) {
          branchSavedOnce = true;
          notifyPlateSaved?.();
        }
      },
      recordRunRecord: async (run, updates) => {
        if (run.stage === "painter_branch_timeline" && !delayedFirstRun) {
          delayedFirstRun = true;
          await runGate;
        }
        return baseRepo.recordRunRecord(run, updates);
      },
    };

    const nowRelease = new Date("2026-10-28T10:00:00.000Z");
    const firstBranchPromise = branchTimeline(
      {
        parentInteractionId: rootRelease.illustration.interactionId,
        scenarioPrompt: "Slot release branch 1",
        maxBranchesPerTimeline: 2,
        now: nowRelease,
      },
      { repository: trackedRepo, geminiClient }
    );

    await firstPlateSaved;
    const secondBranchResult = await branchTimeline(
      {
        parentInteractionId: rootRelease.illustration.interactionId,
        scenarioPrompt: "Slot release branch 2 during scorecard write",
        maxBranchesPerTimeline: 2,
        now: nowRelease,
      },
      { repository: trackedRepo, geminiClient }
    );
    assert.equal(secondBranchResult.status, "illustration_painted");

    releaseRunGate?.();
    const firstBranchResult = await firstBranchPromise;
    assert.equal(firstBranchResult.status, "illustration_painted");

    const rootSerialize = await bootstrapCanvas(
      {
        timelineId: "corridor-slot-serialize",
        observations: [obs],
        now: new Date("2026-10-27T18:05:00.000Z"),
      },
      { repository: baseRepo, geminiClient }
    );
    assert.equal(rootSerialize.status, "illustration_painted");

    const callsBeforeRace = interSeq;
    const delayedReadRepo: GridlockRepository = {
      ...baseRepo,
      listGeneratedIllustrationsByTimeline: async (timelineId) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return baseRepo.listGeneratedIllustrationsByTimeline(timelineId);
      },
    };

    const raceResults = await Promise.all([
      branchTimeline(
        {
          parentInteractionId: rootSerialize.illustration.interactionId,
          scenarioPrompt: "Serialized admission A",
          maxBranchesPerTimeline: 1,
          now: nowRelease,
        },
        { repository: delayedReadRepo, geminiClient }
      ),
      branchTimeline(
        {
          parentInteractionId: rootSerialize.illustration.interactionId,
          scenarioPrompt: "Serialized admission B",
          maxBranchesPerTimeline: 1,
          now: nowRelease,
        },
        { repository: delayedReadRepo, geminiClient }
      ),
    ]);

    const painted = raceResults.filter((r) => r.status === "illustration_painted");
    const rejected = raceResults.filter((r) => r.status === "painter_failed");
    assert.equal(painted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.errorCode, "branch_quota_exceeded");
    assert.equal(interSeq - callsBeforeRace, 1);
  });
});

import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchLineage,
  CANONICAL_MILESTONE_LABEL,
  createCorridorBaseCanvasWebp,
  createInMemoryGridlockRepository,
  evaluatePainterMilestoneGate,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  paintMilestoneDelta,
  recordAgenticStageTelemetry,
  recordStageTelemetry,
  SCENARIO_BRANCH_WATERMARK,
  SourceArtifactSchema,
  VisualPlateSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type PainterErrorCode,
  type TelemetrySpan,
} from "../src/index.ts";
import { createFixtureWebpBuffer, createPainterTestObservations, createSamplePngBuffer, isWebpBuffer } from "./helpers/fixtures.ts";

describe("Stateful Painter Agent & Lineage Chaining (Seam 3 Core, Ticket #7)", () => {
  test("Part 1 (Visual Plate Spine, Schema Invariants, Chronological Active Lookup & Milestone Gate): enforces canonical vs ephemeral branch invariants, resolves highest turnNumber, skips non-milestones at 0 tokens, and computes painter cache efficiency", async () => {
    const repository = createInMemoryGridlockRepository();
    const { routineObs, milestoneObs: milestoneObs1 } = createPainterTestObservations();

    const webpBlob = createFixtureWebpBuffer("root-plate");
    assert.equal(isWebpBuffer(webpBlob), true);

    const turn2Plate = VisualPlateSchema.parse({
      plateId: "plate_texas-corridor-main_t2_abcd1234",
      lineageId: "texas-corridor-main",
      turnNumber: 2,
      model: PAINTER_AGENT_MODEL,
      interactionId: "inter_turn_2",
      parentInteractionId: "inter_turn_1",
      parentPlateId: "plate_texas-corridor-main_t1_00001111",
      rebootstrappedFromParentWebp: false,
      projectNumbers: [milestoneObs1.projectNumber],
      triggeringObservationIds: [milestoneObs1.id],
      sourceArtifactHashes: [milestoneObs1.sourceArtifactHash],
      prompt: "Paint Turn 2 corridor plate",
      storageUri: `${ARTIFACT_BUCKET_URI}/plates/texas-corridor-main/plate_texas-corridor-main_t2_abcd1234.webp`,
      mimeType: "image/webp",
      byteLength: webpBlob.byteLength,
      sha256: "b".repeat(64),
      isBranch: false,
      epistemicLabel: CANONICAL_MILESTONE_LABEL,
      watermarkText: null,
      createdAt: "2026-10-27T14:10:00.000Z",
      expiresAt: null,
    });

    const turn10Plate = VisualPlateSchema.parse({
      ...turn2Plate,
      plateId: "plate_texas-corridor-main_t10_99887766",
      turnNumber: 10,
      interactionId: "inter_turn_10",
      parentInteractionId: "inter_turn_9",
      parentPlateId: "plate_texas-corridor-main_t9_55443322",
      storageUri: `${ARTIFACT_BUCKET_URI}/plates/texas-corridor-main/plate_texas-corridor-main_t10_99887766.webp`,
      createdAt: "2026-10-27T15:00:00.000Z",
    });

    const branchPlate = VisualPlateSchema.parse({
      ...turn2Plate,
      plateId: "branch_texas-corridor-main_t11_ef567890",
      turnNumber: 11,
      interactionId: "inter_branch_1",
      parentInteractionId: turn10Plate.interactionId,
      parentPlateId: turn10Plate.plateId,
      triggeringObservationIds: ["obs_TABS2027009999_branch_only"],
      storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/texas-corridor-main/branch_texas-corridor-main_t11_ef567890.webp`,
      isBranch: true,
      scenarioPrompt: "Simulate +300MW substation expansion",
      epistemicLabel: SCENARIO_BRANCH_WATERMARK,
      watermarkText: SCENARIO_BRANCH_WATERMARK,
      expiresAt: "2027-01-25T15:00:00.000Z",
    });

    // Reject branch/canonical invariant violations at schema boundary
    assert.throws(() => VisualPlateSchema.parse({ ...branchPlate, storageUri: turn2Plate.storageUri }));
    assert.throws(() => VisualPlateSchema.parse({ ...branchPlate, expiresAt: null }));
    assert.throws(() => VisualPlateSchema.parse({ ...branchPlate, watermarkText: null }));
    assert.throws(() =>
      VisualPlateSchema.parse({ ...turn2Plate, expiresAt: "2027-01-25T15:00:00.000Z" })
    );

    // Save Turn 10 BEFORE Turn 2 (mirroring Firestore lexicographic _t10_ < _t2_ order)
    await repository.saveVisualPlate(turn10Plate, webpBlob);
    await repository.saveVisualPlate(turn2Plate, webpBlob);
    await repository.saveVisualPlate(branchPlate, webpBlob);

    assert.deepEqual(
      (await repository.listVisualPlatesByLineage("texas-corridor-main")).map((p) => p.turnNumber),
      [2, 10, 11]
    );
    assert.deepEqual(await repository.readVisualPlateWebp(turn10Plate.plateId), webpBlob);

    // Caller-facing milestone gate skips routine + already-painted canonical milestones at 0 tokens
    const skippedGate = await evaluatePainterMilestoneGate(
      { lineageId: "texas-corridor-main", observations: [routineObs, milestoneObs1] },
      { repository }
    );
    assert.equal(skippedGate.shouldPaint, false);
    assert.equal(skippedGate.result.status, "skipped_no_milestone");
    assert.equal(skippedGate.result.tokensUsed, 0);
    assert.equal(skippedGate.result.imageGenerationsAvoided, 1);
    assert.equal(skippedGate.result.activePlate?.plateId, turn10Plate.plateId);

    // Branch-only observation remains eligible for canonical painting
    const milestoneObsBranchOnly = ObservationSchema.parse({
      ...milestoneObs1,
      id: "obs_TABS2027009999_branch_only",
    });
    const readyGate = await evaluatePainterMilestoneGate(
      {
        lineageId: "texas-corridor-main",
        observations: [routineObs, milestoneObs1, milestoneObsBranchOnly],
      },
      { repository }
    );
    assert.equal(readyGate.shouldPaint, true);
    assert.deepEqual(
      readyGate.milestoneObservations.map((o) => o.id),
      ["obs_TABS2027009999_branch_only"]
    );
    assert.equal(readyGate.ctx.activePlate?.plateId, turn10Plate.plateId);

    const t0 = new Date("2026-10-27T15:07:00.000Z");
    // Uncached painter run recomputes visualPlateCacheEfficiencyPercentage (1 avoided / 2 demand = 50%)
    const afterBootstrap = await recordAgenticStageTelemetry(
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
    assert.equal(afterBootstrap.ledger.visualPlateCacheEfficiencyPercentage, 50);

    // Failed/blocked runs must never inflate imageGenerationsAvoided or visualPlateCacheHits
    await recordStageTelemetry(
      {
        stage: "painter_milestone_gate",
        execution_mode: "deterministic",
        status: "blocked_by_waf",
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        imageGenerationsAvoidedDelta: 5,
        visualPlateCacheHitsDelta: 3,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );
    await recordAgenticStageTelemetry(
      {
        stage: "painter_milestone_delta",
        status: "agentic_failed",
        tokensUsed: 300,
        visualPlateCacheHitsDelta: 2,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );

    // Valid skip (+1 avoided -> 2) and cached fallback (+1 cache hit) -> (2 + 1) / (2 + 1 + 1) = 75%
    await evaluatePainterMilestoneGate(
      { lineageId: "texas-corridor-main", observations: [routineObs] },
      { repository }
    );
    const { ledger } = await recordAgenticStageTelemetry(
      {
        stage: "painter_milestone_delta",
        status: "agentic_completed",
        tokensUsed: 1200,
        interactionId: "inter_turn_12",
        visualPlateCacheHitsDelta: 1,
        startedAt: t0,
        endedAt: t0,
      },
      { repository }
    );
    assert.equal(ledger.imageGenerationsAvoided, 2);
    assert.equal(ledger.visualPlateCacheHits, 1);
    assert.equal(ledger.visualPlateCacheEfficiencyPercentage, 75);
  });

  test("Part 2 (Turn 1 bootstrapCanvas, Real PNG->WebP Lossless Codec, Artifact Pinning & Fail-Closed Guards): validates corridor base canvas, transcodes PNG to RFC-9649 WebP, pins SourceArtifact retention, and fails closed across status/ID/image sad paths", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const emittedSpans: TelemetrySpan[] = [];
    const { routineObs, milestoneObs } = createPainterTestObservations();

    const fakeVp8lPayload = Buffer.from("5249464616000000574542505650384c0a000000574542505f46414b4521", "hex");
    assert.equal(isWebpBuffer(fakeVp8lPayload), false);
    assert.equal(isWebpBuffer(createCorridorBaseCanvasWebp("texas-corridor-main")), true);

    const rawHtmlGz = gzipSync(Buffer.from("<html>milestone</html>", "utf-8"));
    await repository.saveSourceArtifact(
      SourceArtifactSchema.parse({
        sha256: milestoneObs.sourceArtifactHash, connectorId: "tdlr-tabs",
        sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697",
        contentType: "text/html", rawByteLength: 22, compressedByteLength: rawHtmlGz.byteLength,
        storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${milestoneObs.sourceArtifactHash}.gz`,
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

    const skipped = await bootstrapCanvas({ lineageId: "texas-corridor-main", observations: [routineObs] }, { repository, geminiClient });
    assert.equal(skipped.status, "skipped_no_milestone");
    assert.equal(recordedRequests.length, 0);

    const decodeStartedAtMs = performance.now();
    const painted = await bootstrapCanvas(
      { lineageId: "texas-corridor-main", observations: [routineObs, milestoneObs] },
      { repository, geminiClient, spanSink: (s) => emittedSpans.push(s) }
    );
    assert.ok(performance.now() - decodeStartedAtMs < 500);
    assert.equal(painted.status, "plate_painted");
    assert.equal(recordedRequests[0]?.model, PAINTER_AGENT_MODEL);
    assert.equal(recordedRequests[0]?.store, true);
    const sentBase64 = String((recordedRequests[0]?.input as Array<Record<string, unknown>>)[1]?.data ?? "");
    assert.equal(isWebpBuffer(Buffer.from(sentBase64, "base64")), true);
    assert.equal(isWebpBuffer(painted.webpBuffer), true);
    assert.equal(painted.plate.interactionId, "inter_turn_1_bootstrap");
    const pinnedArtifact = await repository.getSourceArtifactByHash(milestoneObs.sourceArtifactHash);
    assert.equal(pinnedArtifact?.expiresAt, null);
    assert.equal(pinnedArtifact?.referencedByMilestone, true);

    const milestoneObsNext = ObservationSchema.parse({ ...milestoneObs, id: "obs_TABS2027003697_m2" });
    const sadCases: Array<{ lineageId: string; obs?: typeof milestoneObs; baseCanvasWebp?: Buffer; expectedCode: PainterErrorCode; expectedTokens: number }> = [
      { lineageId: "texas-corridor-main", obs: milestoneObsNext, expectedCode: "lineage_already_bootstrapped", expectedTokens: 0 },
      { lineageId: "corridor-bad-canvas", baseCanvasWebp: fakeVp8lPayload, expectedCode: "invalid_base_canvas", expectedTokens: 0 },
      { lineageId: "corridor-incomplete", expectedCode: "interaction_failed", expectedTokens: 320 },
      { lineageId: "corridor-missing-id", expectedCode: "interaction_failed", expectedTokens: 150 },
      { lineageId: "corridor-thrown", expectedCode: "interaction_failed", expectedTokens: 0 },
      { lineageId: "corridor-null-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 210 },
      { lineageId: "corridor-empty-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 190 },
      { lineageId: "corridor-corrupt-img", expectedCode: "corrupt_or_empty_image", expectedTokens: 410 },
    ];

    await sadCases.reduce<Promise<void>>(async (prev, sc) => {
      await prev;
      const res = await bootstrapCanvas(
        { lineageId: sc.lineageId, observations: [sc.obs ?? milestoneObs], ...(sc.baseCanvasWebp !== undefined ? { baseCanvasWebp: sc.baseCanvasWebp } : {}) },
        { repository, geminiClient, spanSink: (s) => emittedSpans.push(s) }
      );
      assert.equal(res.status, "painter_failed");
      assert.equal(res.errorCode, sc.expectedCode);
      assert.equal(res.tokensUsed, sc.expectedTokens);
    }, Promise.resolve());

    assert.equal(recordedRequests.length, 7);
    assert.equal((await repository.listVisualPlatesByLineage("texas-corridor-main")).length, 1);
    assert.equal((await repository.listVisualPlatesByLineage("corridor-corrupt-img")).length, 0);
    assert.equal((await repository.getEfficiencyLedger()).actualTokensUsed, 1840 + 320 + 150 + 210 + 190 + 410);
    assert.equal(emittedSpans.at(-1)?.status, "agentic_failed");
  });

  test("Part 3 (Turn 2+ paintMilestoneDelta Chaining, Continuity Constraints & Structured Expiry Fallback): advances active canonical head, preserves continuity, re-bootstraps on ApiError(404) & status:'failed' expiry, and fails closed on non-canonical/corrupt-cache/auth/model errors", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const { milestoneObs: m1 } = createPainterTestObservations();
    const m2 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027005555_t2", projectNumber: "TABS2027005555", sourceArtifactHash: "b".repeat(64), scopeOfWork: "345kV substation interconnect" });
    const m3 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027008888_t3", projectNumber: "TABS2027008888", sourceArtifactHash: "c".repeat(64), scopeOfWork: "Phase 2 chilled-water plant" });
    const m4 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027009111_t4", projectNumber: "TABS2027009111", sourceArtifactHash: "d".repeat(64), scopeOfWork: "Phase 3 switchgear yard" });
    const m5 = ObservationSchema.parse({ ...m1, id: "obs_TABS2027009222_t5", projectNumber: "TABS2027009222", sourceArtifactHash: "e".repeat(64), scopeOfWork: "Phase 4 synchronous condenser" });

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

    // 1. Sad Path: empty lineage, branch-only lineage, and cross-lineage isolation all fail closed with parent_not_found at 0 calls
    const orphanDelta = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(orphanDelta.status, "painter_failed");
    assert.equal(orphanDelta.errorCode, "parent_not_found");

    const branchOnlyBlob = createFixtureWebpBuffer("branch-only");
    await repository.saveVisualPlate(
      VisualPlateSchema.parse({
        plateId: "branch_texas-corridor-main_t1_deadbeef",
        lineageId: "texas-corridor-main",
        turnNumber: 1,
        model: PAINTER_AGENT_MODEL,
        interactionId: "inter_branch_only",
        parentInteractionId: "inter_ext",
        parentPlateId: "plate_ext",
        rebootstrappedFromParentWebp: false,
        projectNumbers: [m1.projectNumber],
        triggeringObservationIds: ["obs_branch_only"],
        sourceArtifactHashes: [m1.sourceArtifactHash],
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
    const branchOnlyDelta = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(branchOnlyDelta.status, "painter_failed");
    assert.equal(branchOnlyDelta.errorCode, "parent_not_found");

    await bootstrapCanvas({ lineageId: "other-corridor", observations: [m1] }, { repository, geminiClient });
    const crossLineageDelta = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(crossLineageDelta.status, "painter_failed");
    assert.equal(crossLineageDelta.errorCode, "parent_not_found");
    assert.equal(recordedRequests.length, 1);

    // 2. Happy Path: Turn 1 bootstrap + Turn 2 delta chaining with visual continuity prompt
    const turn1 = await bootstrapCanvas({ lineageId: "texas-corridor-main", observations: [m1] }, { repository, geminiClient });
    assert.equal(turn1.status, "plate_painted");

    const turn2 = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m1, m2] }, { repository, geminiClient });
    assert.equal(turn2.status, "plate_painted");
    assert.equal(recordedRequests[2]?.previous_interaction_id, turn1.plate.interactionId);
    assert.match(String(recordedRequests[2]?.input), /camera angle.*topography.*typography.*existing corridor infrastructure/i);
    assert.equal(turn2.plate.turnNumber, 2);
    assert.equal(turn2.plate.parentPlateId, turn1.plate.plateId);
    assert.equal(turn2.rebootstrappedFromParentWebp, false);
    assert.deepEqual(turn2.plate.triggeringObservationIds, [m2.id]);

    const repeatSkip = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m1, m2] }, { repository, geminiClient });
    assert.equal(repeatSkip.status, "skipped_no_milestone");
    assert.equal(recordedRequests.length, 3);

    // 3. Structured Expiry Fallback A: thrown @google/genai ApiError { status: 404, message: "Requested entity was not found." }
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const turn3 = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m3] }, { repository, geminiClient });
    assert.equal(turn3.status, "plate_painted");
    assert.equal(recordedRequests.length, 5);
    assert.equal(recordedRequests[3]?.previous_interaction_id, turn2.plate.interactionId);
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
    const turn4 = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m4] }, { repository, geminiClient });
    assert.equal(turn4.status, "plate_painted");
    assert.equal(turn4.rebootstrappedFromParentWebp, true);
    assert.equal(turn4.tokensUsed, 45 + 1200);
    assert.equal((await repository.getEfficiencyLedger()).visualPlateCacheHits, 2);

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
      const failed = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m5] }, { repository, geminiClient });
      assert.equal(failed.status, "painter_failed");
      assert.equal(failed.errorCode, "interaction_failed");
      assert.equal(failed.tokensUsed, item.expectedTokens);
      assert.equal(failed.activePlate?.plateId, turn4.plate.plateId);
      assert.equal(recordedRequests.length, callsBefore + 1);
    }, Promise.resolve());

    // 6. Sad Path: corrupt or missing cached parent .webp in storage when previous_interaction_id expires fails closed without firing fallback
    await repository.saveVisualPlate(turn4.plate, Buffer.from("CORRUPT_WEBP_BYTES", "ascii"));
    const callsBeforeCorruptCache = recordedRequests.length;
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const corruptCacheFallback = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m5] }, { repository, geminiClient });
    assert.equal(corruptCacheFallback.status, "painter_failed");
    assert.equal(corruptCacheFallback.errorCode, "interaction_failed");
    assert.equal(corruptCacheFallback.activePlate?.plateId, turn4.plate.plateId);
    assert.equal(recordedRequests.length, callsBeforeCorruptCache + 1);

    const missingBlobRepo = { ...repository, readVisualPlateWebp: async () => null };
    const callsBeforeMissingCache = recordedRequests.length;
    faultQueue.push(() => {
      throw Object.assign(new Error("Requested entity was not found."), { status: 404 });
    });
    const missingCacheFallback = await paintMilestoneDelta({ lineageId: "texas-corridor-main", observations: [m5] }, { repository: missingBlobRepo, geminiClient });
    assert.equal(missingCacheFallback.status, "painter_failed");
    assert.equal(missingCacheFallback.errorCode, "interaction_failed");
    assert.equal(missingCacheFallback.activePlate?.plateId, turn4.plate.plateId);
    assert.equal(recordedRequests.length, callsBeforeMissingCache + 1);
  });

  test("Part 4 (branchLineage Ephemeral Scenario Forking, Pixel+XMP Watermark, Chunk Preservation, Sibling Isolation & +90d TTL): stamps legible watermark glyphs, preserves extended WebP chunks, isolates sibling plateIds, and enforces TTL/quota without unbounded rejection telemetry", async () => {
    const repository = createInMemoryGridlockRepository();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const { milestoneObs: rootObs } = createPainterTestObservations();
    await repository.appendObservation(rootObs);

    const riffChunk = (fourCc: string, payload: Buffer): Buffer => {
      const hdr = Buffer.alloc(8);
      hdr.write(fourCc.padEnd(4, " ").slice(0, 4), 0, "ascii");
      hdr.writeUInt32LE(payload.byteLength, 4);
      return Buffer.concat([hdr, payload, payload.byteLength % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
    };
    const wrapWebp = (chunks: readonly Buffer[]): Buffer => {
      const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
      const hdr = Buffer.alloc(8);
      hdr.write("RIFF", 0, "ascii");
      hdr.writeUInt32LE(body.byteLength, 4);
      return Buffer.concat([hdr, body]);
    };
    const parseWebpChunks = (buf: Buffer, off = 12, acc: Array<{ fourCc: string; data: Buffer }> = []): Array<{ fourCc: string; data: Buffer }> => {
      if (off >= buf.byteLength) return acc;
      const [fourCc, size] = [buf.subarray(off, off + 4).toString("ascii"), buf.readUInt32LE(off + 4)];
      return parseWebpChunks(buf, off + 8 + size + (size & 1), [...acc, { fourCc, data: buf.subarray(off + 8, off + 8 + size) }]);
    };
    const bitRev8 = (b: number): number => {
      const x1 = ((b & 0xf0) >>> 4) | ((b & 0x0f) << 4);
      const x2 = ((x1 & 0xcc) >>> 2) | ((x1 & 0x33) << 2);
      return ((x2 & 0xaa) >>> 1) | ((x2 & 0x55) << 1);
    };
    const glyphToChar = new Map<number, string>([
      [0o25755, "A"], [0o65656, "B"], [0o34443, "C"], [0o65556, "D"], [0o74647, "E"], [0o74644, "F"],
      [0o55755, "H"], [0o72227, "I"], [0o11152, "J"], [0o65555, "N"], [0o25552, "O"], [0o65644, "P"],
      [0o65665, "R"], [0o34216, "S"], [0o72222, "T"], [0o55557, "U"], [0o55552, "V"], [0o11244, "/"], [0, " "],
    ]);
    const decodeRenderedBannerText = (webp: Buffer, width: number, lineCount: number): string => {
      const vp8l = parseWebpChunks(webp).find((c) => c.fourCc === "VP8L")!.data;
      const pxStart = 5 + 156;
      const readRgba = (x: number, y: number): [number, number, number, number] => {
        const off = pxStart + (y * width + x) * 4;
        return [bitRev8(vp8l[off + 1]!), bitRev8(vp8l[off]!), bitRev8(vp8l[off + 2]!), bitRev8(vp8l[off + 3]!)];
      };
      assert.deepEqual(readRgba(0, 0), [158, 42, 43, 255]);
      const maxChars = Math.floor((width - 3) / 4);
      return Array.from({ length: lineCount }, (_, lineIdx) =>
        Array.from({ length: maxChars }, (__, charIdx) => {
          const mask = Array.from({ length: 15 }, (___, bitPos) => {
            const [gy, gx] = [Math.floor(bitPos / 3), bitPos % 3];
            const [r, g, b] = readRgba(2 + charIdx * 4 + gx, 1 + lineIdx * 6 + gy);
            return r === 245 && g === 242 && b === 235 ? 1 << (14 - bitPos) : 0;
          }).reduce((a, b) => a | b, 0);
          return glyphToChar.get(mask) ?? "?";
        })
          .join("")
          .trimEnd()
      ).join(" ");
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
      { lineageId: "texas-corridor-main", observations: [rootObs], now: new Date("2026-10-27T18:05:00.000Z") },
      { repository, geminiClient }
    );
    assert.equal(rootResult.status, "plate_painted");

    // 1. Happy Path: flat-tree VP8L branch stamps legible "SCENARIO BRANCH / UNVERIFIED PROJECTION" pixels + VP8X/XMP + sibling isolation
    const branchNow = new Date("2026-10-28T10:00:00.000Z");
    const expectedExpiresAt = new Date(branchNow.getTime() + NINETY_DAYS_MS).toISOString();
    responseQueue.push({
      id: "inter_scenario_branch_01",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1250 },
    });
    const branchResult = await branchLineage(
      {
        parentInteractionId: "inter_branch_parent_root",
        scenarioPrompt: "Simulate ERCOT 450MW large-load interconnection curtailment in Ellis County",
        now: branchNow,
      },
      { repository, geminiClient }
    );
    assert.equal(branchResult.status, "plate_painted");
    assert.equal(branchResult.operation, "branchLineage");
    const branchPlate = VisualPlateSchema.parse(branchResult.plate);
    assert.equal(branchPlate.isBranch, true);
    assert.equal(branchPlate.turnNumber, 2);
    assert.equal(branchPlate.parentInteractionId, "inter_branch_parent_root");
    assert.equal(branchPlate.parentPlateId, rootResult.plate.plateId);
    assert.equal(branchPlate.epistemicLabel, SCENARIO_BRANCH_WATERMARK);
    assert.equal(branchPlate.watermarkText, SCENARIO_BRANCH_WATERMARK);
    assert.equal(branchPlate.expiresAt, expectedExpiresAt);
    assert.ok(branchPlate.storageUri.startsWith("gs://gridlock-artifacts/branches/ephemeral/texas-corridor-main/"));
    assert.equal(branchResult.webpBuffer.subarray(12, 16).toString("ascii"), "VP8X");
    assert.ok(branchResult.webpBuffer.toString("utf-8").includes(`<dc:rights>${SCENARIO_BRANCH_WATERMARK}</dc:rights>`));
    assert.equal(decodeRenderedBannerText(branchResult.webpBuffer, 64, 3), SCENARIO_BRANCH_WATERMARK.toUpperCase());

    // Sibling branch with identical output_image bytes must get a distinct plateId & storageUri without overwriting branch 1
    responseQueue.push({
      id: "inter_scenario_branch_02",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1180 },
    });
    const siblingBranch = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Simulate Oncor 345kV double-circuit upgrade", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(siblingBranch.status, "plate_painted");
    assert.notEqual(siblingBranch.plate.plateId, branchPlate.plateId);
    assert.notEqual(siblingBranch.plate.storageUri, branchPlate.storageUri);
    assert.equal((await repository.listVisualPlatesByLineage("texas-corridor-main")).length, 3);

    // 2. PNG response -> transcoded & single-line pixel watermark; opaque compressed VP8L & extended VP8X+ICCP+ALPH+VP8+EXIF preserved
    const widePng = createSamplePngBuffer(200, 24);
    responseQueue.push({
      id: "inter_branch_png",
      status: "completed",
      output_image: { mime_type: "image/png", data: widePng.toString("base64") },
      usage: { total_tokens: 900 },
    });
    const pngBranch = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "PNG single-line watermark verification", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(pngBranch.status, "plate_painted");
    assert.equal(decodeRenderedBannerText(pngBranch.webpBuffer, 200, 1), SCENARIO_BRANCH_WATERMARK.toUpperCase());

    const opaqueCompressedVp8lPayload = Buffer.from([0x2f, 31, (17 << 6) & 0xff, 0x00, 0x00, 0x80, 0xaa, 0x55, 0x11]);
    const opaqueCompressedWebp = wrapWebp([riffChunk("VP8L", opaqueCompressedVp8lPayload)]);
    responseQueue.push({
      id: "inter_branch_opaque_vp8l",
      status: "completed",
      output_image: { mime_type: "image/webp", data: opaqueCompressedWebp.toString("base64") },
      usage: { total_tokens: 910 },
    });
    const opaqueBranch = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Opaque compressed VP8L flag check", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(opaqueBranch.status, "plate_painted");
    assert.equal(opaqueBranch.webpBuffer[20], 0x04);
    assert.deepEqual(parseWebpChunks(opaqueBranch.webpBuffer).find((c) => c.fourCc === "VP8L")?.data, opaqueCompressedVp8lPayload);

    const iccpData = Buffer.from("sRGB-profile", "ascii");
    const alphData = Buffer.from([0x00, 0xff, 0xff, 0xff]);
    const vp8LossyData = Buffer.from([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 32, 0x00, 18, 0x00, 0xde, 0xad]);
    const exifData = Buffer.from("Exif\0\0II", "ascii");
    const srcVp8x = Buffer.from([0x20 | 0x10 | 0x08, 0, 0, 0, 31, 0, 0, 17, 0, 0]);
    const extendedLossyWebp = wrapWebp([
      riffChunk("VP8X", srcVp8x),
      riffChunk("ICCP", iccpData),
      riffChunk("ALPH", alphData),
      riffChunk("VP8 ", vp8LossyData),
      riffChunk("EXIF", exifData),
    ]);
    responseQueue.push({
      id: "inter_branch_extended_vp8",
      status: "completed",
      output_image: { mime_type: "image/webp", data: extendedLossyWebp.toString("base64") },
      usage: { total_tokens: 920 },
    });
    const extendedBranch = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Extended VP8X ICCP+ALPH+VP8+EXIF check", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(extendedBranch.status, "plate_painted");
    assert.equal(extendedBranch.webpBuffer[20], 0x3c);
    const outChunks = parseWebpChunks(extendedBranch.webpBuffer);
    assert.deepEqual(outChunks.map((c) => c.fourCc), ["VP8X", "ICCP", "ALPH", "VP8 ", "EXIF", "XMP "]);
    assert.deepEqual(outChunks[1]?.data, iccpData);
    assert.deepEqual(outChunks[2]?.data, alphData);
    assert.deepEqual(outChunks[3]?.data, vp8LossyData);
    assert.deepEqual(outChunks[4]?.data, exifData);

    // 3. Sad Path via public seams: corrupt VP8X rejected by bootstrapCanvas & branchLineage
    const brokenVp8x = Buffer.from(branchResult.webpBuffer);
    brokenVp8x[20] = 0x00;
    const rejectedCanvas = await bootstrapCanvas(
      { lineageId: "corridor-corrupt-vp8x", observations: [rootObs], baseCanvasWebp: brokenVp8x },
      { repository, geminiClient }
    );
    assert.equal(rejectedCanvas.status, "painter_failed");
    assert.equal(rejectedCanvas.errorCode, "invalid_base_canvas");

    responseQueue.push({
      id: "inter_branch_corrupt_vp8x",
      status: "completed",
      output_image: { mime_type: "image/webp", data: brokenVp8x.toString("base64") },
      usage: { total_tokens: 300 },
    });
    const rejectedBranchImg = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Corrupt VP8X output rejection", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(rejectedBranchImg.status, "painter_failed");
    assert.equal(rejectedBranchImg.errorCode, "corrupt_or_empty_image");

    // 4. Pre-Gemini validation & quota rejections write zero telemetry_runs and zero Gemini requests; +90d TTL frees quota & blocks expired parents
    const runsBeforePreconditions = (await repository.listTelemetryRuns()).length;
    const agenticBeforePreconditions = (await repository.getEfficiencyLedger()).agenticRunsCount;
    const callsBeforePreconditions = recordedRequests.length;

    const emptyPrompt = await branchLineage({ parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "   ", now: branchNow }, { repository, geminiClient });
    assert.equal(emptyPrompt.status, "painter_failed");
    assert.equal(emptyPrompt.errorCode, "invalid_scenario_prompt");

    const oversizedPrompt = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "x".repeat(MAX_SCENARIO_PROMPT_LENGTH + 1), now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(oversizedPrompt.status, "painter_failed");
    assert.equal(oversizedPrompt.errorCode, "invalid_scenario_prompt");

    const unknownParent = await branchLineage({ parentInteractionId: "inter_missing", scenarioPrompt: "Simulate upgrade", now: branchNow }, { repository, geminiClient });
    assert.equal(unknownParent.status, "painter_failed");
    assert.equal(unknownParent.errorCode, "parent_not_found");

    const crossLineage = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", lineageId: "other-corridor", scenarioPrompt: "Cross lineage fork", now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(crossLineage.status, "painter_failed");
    assert.equal(crossLineage.errorCode, "parent_not_found");

    const quotaExceeded = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Exceeding active branch cap", maxBranchesPerLineage: 5, now: branchNow },
      { repository, geminiClient }
    );
    assert.equal(quotaExceeded.status, "painter_failed");
    assert.equal(quotaExceeded.errorCode, "branch_quota_exceeded");

    const postExpiryNow = new Date(branchNow.getTime() + NINETY_DAYS_MS + 1_000);
    const expiredParentFork = await branchLineage(
      { parentInteractionId: "inter_scenario_branch_01", scenarioPrompt: "Forking expired +90d branch", now: postExpiryNow },
      { repository, geminiClient }
    );
    assert.equal(expiredParentFork.status, "painter_failed");
    assert.equal(expiredParentFork.errorCode, "parent_not_found");

    assert.equal(recordedRequests.length, callsBeforePreconditions);
    assert.equal((await repository.listTelemetryRuns()).length, runsBeforePreconditions);
    assert.equal((await repository.getEfficiencyLedger()).agenticRunsCount, agenticBeforePreconditions);

    // After +90d TTL elapses, prior ephemeral branches no longer consume maxBranchesPerLineage=1
    responseQueue.push({
      id: "inter_post_expiry_fresh_branch",
      status: "completed",
      previous_interaction_id: "inter_branch_parent_root",
      output_image: { mime_type: "image/webp", data: rawPlateWebp.toString("base64") },
      usage: { total_tokens: 1100 },
    });
    const postExpiryBranch = await branchLineage(
      { parentInteractionId: "inter_branch_parent_root", scenarioPrompt: "Fresh branch after +90d TTL expiry", maxBranchesPerLineage: 1, now: postExpiryNow },
      { repository, geminiClient }
    );
    assert.equal(postExpiryBranch.status, "plate_painted");
  });
});

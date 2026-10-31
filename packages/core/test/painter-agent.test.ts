import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  CANONICAL_MILESTONE_LABEL,
  createCorridorBaseCanvasWebp,
  createInMemoryGridlockRepository,
  evaluatePainterMilestoneGate,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
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
      { id: "inter_turn_1_bootstrap", status: "completed", output_image: { mime_type: "image/png", data: createSamplePngBuffer(16, 9).toString("base64") }, usage: { total_tokens: 1840 } },
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

    const painted = await bootstrapCanvas(
      { lineageId: "texas-corridor-main", observations: [routineObs, milestoneObs] },
      { repository, geminiClient, spanSink: (s) => emittedSpans.push(s) }
    );
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
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  createInMemoryGridlockRepository,
  evaluatePainterMilestoneGate,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  recordAgenticStageTelemetry,
  recordStageTelemetry,
  SCENARIO_BRANCH_WATERMARK,
  VisualPlateSchema,
} from "../src/index.ts";
import {
  createFixtureWebpBuffer,
  isWebpBuffer,
} from "./helpers/fixtures.ts";

describe("Stateful Painter Agent & Lineage Chaining (Seam 3 Core, Ticket #7)", () => {
  test("Part 1 (Visual Plate Spine, Schema Invariants, Chronological Active Lookup & Milestone Gate): enforces canonical vs ephemeral branch invariants, resolves highest turnNumber, skips non-milestones at 0 tokens, and computes painter cache efficiency", async () => {
    const repository = createInMemoryGridlockRepository();
    const routineObs = ObservationSchema.parse({
      id: "obs_TABS2027001111_routine",
      projectNumber: "TABS2027001111",
      sourceArtifactHash: "1".repeat(64),
      observedAt: "2026-10-27T14:00:00.000Z",
      status: "Project Registered",
      estimatedCostUsd: 2_500_000,
      squareFootage: 12_000,
      scopeOfWork: "Minor interior office remodel",
      isMilestone: false,
    });
    const milestoneObs1 = ObservationSchema.parse({
      id: "obs_TABS2027003697_m1",
      projectNumber: "TABS2027003697",
      sourceArtifactHash: "a".repeat(64),
      observedAt: "2026-10-27T14:05:00.000Z",
      status: "Project Registered",
      estimatedCostUsd: 125_000_000,
      squareFootage: 250_000,
      scopeOfWork: "New 250,000 sq ft hyperscale data center shell",
      isMilestone: true,
    });

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
});

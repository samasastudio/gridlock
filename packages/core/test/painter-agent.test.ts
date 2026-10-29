import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  createInMemoryGridlockRepository,
  evaluateMilestoneObservations,
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
  test("Part 1 (Visual Plate Spine, Telemetry Deltas & Milestone Evaluation): persists VisualPlate + .webp blobs, filters canonical milestones, and accumulates imageGenerationsAvoided and visualPlateCacheHits", async () => {
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

    const rootPlate = VisualPlateSchema.parse({
      plateId: "plate_texas-corridor-main_t1_abcd1234",
      lineageId: "texas-corridor-main",
      turnNumber: 1,
      model: PAINTER_AGENT_MODEL,
      interactionId: "inter_turn_1",
      parentInteractionId: null,
      parentPlateId: null,
      rebootstrappedFromParentWebp: false,
      projectNumbers: [milestoneObs1.projectNumber],
      triggeringObservationIds: [milestoneObs1.id],
      sourceArtifactHashes: [milestoneObs1.sourceArtifactHash],
      prompt: "Bootstrap Atlas Dossier corridor plate",
      storageUri: `${ARTIFACT_BUCKET_URI}/plates/texas-corridor-main/plate_texas-corridor-main_t1_abcd1234.webp`,
      mimeType: "image/webp",
      byteLength: webpBlob.byteLength,
      sha256: "b".repeat(64),
      isBranch: false,
      epistemicLabel: CANONICAL_MILESTONE_LABEL,
      watermarkText: null,
      createdAt: "2026-10-27T14:10:00.000Z",
      expiresAt: null,
    });

    const branchPlate = VisualPlateSchema.parse({
      ...rootPlate,
      plateId: "branch_texas-corridor-main_t2_ef567890",
      turnNumber: 2,
      interactionId: "inter_branch_1",
      parentInteractionId: rootPlate.interactionId,
      parentPlateId: rootPlate.plateId,
      triggeringObservationIds: ["obs_TABS2027009999_branch_only"],
      isBranch: true,
      scenarioPrompt: "Simulate +300MW substation expansion",
      epistemicLabel: SCENARIO_BRANCH_WATERMARK,
      watermarkText: SCENARIO_BRANCH_WATERMARK,
      expiresAt: "2027-01-25T14:10:00.000Z",
    });

    await repository.saveVisualPlate(rootPlate, webpBlob);
    await repository.saveVisualPlate(branchPlate, webpBlob);

    assert.deepEqual(await repository.getVisualPlateById(rootPlate.plateId), rootPlate);
    assert.deepEqual(
      await repository.getVisualPlateByInteractionId("inter_turn_1"),
      rootPlate
    );
    assert.equal((await repository.listVisualPlatesByLineage("texas-corridor-main")).length, 2);
    assert.deepEqual(await repository.readVisualPlateWebp(rootPlate.plateId), webpBlob);

    // Routine or already-canonically-painted observations are filtered out; branch-only IDs remain eligible
    const milestoneObsBranchOnly = ObservationSchema.parse({
      ...milestoneObs1,
      id: "obs_TABS2027009999_branch_only",
    });
    const eligible = evaluateMilestoneObservations(
      [routineObs, milestoneObs1, milestoneObsBranchOnly],
      [rootPlate, branchPlate]
    );
    assert.deepEqual(eligible.map((o) => o.id), ["obs_TABS2027009999_branch_only"]);

    // Verify counterfactual telemetry ledger accumulation for skipped generations & cache hits
    await recordStageTelemetry(
      {
        stage: "painter_milestone_gate",
        execution_mode: "deterministic",
        status: "unchanged_artifact",
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        estimatedCostSavedUsd: 0,
        imageGenerationsAvoidedDelta: 2,
        startedAt: new Date("2026-10-27T14:11:00.000Z"),
        endedAt: new Date("2026-10-27T14:11:00.000Z"),
        recordedAt: "2026-10-27T14:11:00.000Z",
      },
      { repository }
    );
    await recordAgenticStageTelemetry(
      {
        stage: "painter_bootstrap",
        status: "agentic_completed",
        tokensUsed: 1500,
        interactionId: "inter_turn_1",
        startedAt: new Date("2026-10-27T14:11:30.000Z"),
        endedAt: new Date("2026-10-27T14:11:30.000Z"),
      },
      { repository }
    );
    const { ledger } = await recordAgenticStageTelemetry(
      {
        stage: "painter_milestone_delta",
        status: "agentic_completed",
        tokensUsed: 1200,
        interactionId: "inter_turn_2",
        visualPlateCacheHitsDelta: 1,
        startedAt: new Date("2026-10-27T14:12:00.000Z"),
        endedAt: new Date("2026-10-27T14:12:00.000Z"),
      },
      { repository }
    );
    assert.equal(ledger.imageGenerationsAvoided, 2);
    assert.equal(ledger.visualPlateCacheHits, 1);
    assert.equal(ledger.actualTokensUsed, 2700);
  });
});

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchTimeline,
  CandidateSelectorPatchSchema,
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  ConnectorHealthCardNodeSchema,
  createInMemoryGridlockRepository,
  DEFAULT_TIMELINE_ID,
  FrameTimelineScrubberNodeSchema,
  getFrameTimeline,
  hydrateInvestigationWorkspace,
  ingestTdlrFiling,
  MAX_SCENARIO_PROMPT_LENGTH,
  MAX_WORKSPACE_NODES,
  NINETY_DAYS_MS,
  recordStageRun,
  runOutOfBandRepairAgent,
  WorkspaceLayoutSchema,
  type GeminiInteractionsClient,
  type GridlockRepository,
} from "../src/index.ts";
import {
  createFixtureWebpBuffer,
  createTestRawCapture,
  FROZEN_TABS_2027003697_HTML,
  HISTORICAL_FIXTURE_V1_HTML,
  MUTATED_PORTAL_V2_HTML,
} from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");
const ROBOTS_ALLOW_ALL = "User-agent: *\nAllow: /\n";

function createPainterClientStub(): GeminiInteractionsClient {
  let seq = 0;
  return {
    interactions: {
      create: async () => {
        seq += 1;
        return {
          id: `ix_painter_${seq}`,
          status: "completed",
          output_image: {
            mime_type: "image/webp",
            data: createFixtureWebpBuffer(`seam-plate-${seq}`).toString(
              "base64"
            ),
          },
          usage: { total_tokens: 180 },
        };
      },
    },
  };
}

async function seedFullFiveCardRepository(): Promise<{
  repository: GridlockRepository;
  canonicalPlateId: string;
  branchPlateId: string;
}> {
  const repository = createInMemoryGridlockRepository();

  const firstIngest = await ingestTdlrFiling(
    {
      projectNumber: "TABS2027003697",
      baseUrl: "https://www.tdlr.texas.gov",
      now: new Date("2026-10-27T12:00:00.000Z"),
      robotsTxt: ROBOTS_ALLOW_ALL,
    },
    {
      repository,
      pageLoader: async () => ({
        status: 200,
        contentType: "text/html",
        body: FROZEN_TABS_2027003697_HTML,
      }),
    }
  );
  assert.equal(firstIngest.status, "ingested");

  const anomaly = await ingestTdlrFiling(
    {
      projectNumber: "TABS2027009888",
      baseUrl: "https://www.tdlr.texas.gov",
      now: new Date("2026-10-27T14:00:00.000Z"),
      robotsTxt: ROBOTS_ALLOW_ALL,
    },
    {
      repository,
      pageLoader: async () => ({
        status: 200,
        contentType: "text/html",
        body: MUTATED_PORTAL_V2_HTML,
      }),
    }
  );
  assert.equal(anomaly.status, "selector_anomaly");

  const repairResult = await runOutOfBandRepairAgent(
    {
      connectorId: "tdlr-tabs",
      quarantinedArtifact: anomaly.rawCapture,
      brokenInvariants: [
        ...anomaly.invariantErrors,
        "Selector <div class=\"project-details\"> missing; ping sre_oncall@example.com",
      ],
      historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
      anomalyDetectedAt: new Date("2026-10-27T14:00:00.000Z"),
      now: new Date("2026-10-27T14:00:02.000Z"),
    },
    {
      repository,
      geminiClient: {
        interactions: {
          create: async () => ({
            id: "ix_repair_tdlr_v2",
            status: "completed",
            output_text: JSON.stringify(
              CandidateSelectorPatchSchema.parse({
                detailContainerSelector:
                  ".project-details, .tabs-project-details-v2",
                fieldLabels: {
                  estimatedCost: "Estimated Cost: | Total Estimated Cost:",
                },
                rootCauseSummary:
                  "Wrapper <div class=\"v2\">\nshifted; notify ops_lead@example.com for *audit*",
              })
            ),
            usage: { total_tokens: 340 },
          }),
        },
      },
    }
  );
  assert.equal(repairResult.status, "repair_promoted");

  const healedIngest = await ingestTdlrFiling(
    {
      projectNumber: "TABS2027009888",
      baseUrl: "https://www.tdlr.texas.gov",
      now: new Date("2026-10-27T14:05:00.000Z"),
      robotsTxt: ROBOTS_ALLOW_ALL,
    },
    {
      repository,
      pageLoader: async () => ({
        status: 200,
        contentType: "text/html",
        body: MUTATED_PORTAL_V2_HTML,
      }),
    }
  );
  assert.equal(healedIngest.status, "ingested");

  const dfwObservations =
    await repository.listObservationsByProject("TABS2027003697");
  const geminiClient = createPainterClientStub();

  const bootstrapRes = await bootstrapCanvas(
    {
      timelineId: DEFAULT_TIMELINE_ID,
      observations: dfwObservations,
      prompt:
        "Bootstrap <svg>\ncanvas for [corridor](https://example.test) contact grid_ops@example.com",
      now: new Date("2026-10-27T15:00:00.000Z"),
    },
    { repository, geminiClient }
  );
  assert.equal(bootstrapRes.status, "illustration_painted");

  const branchRes = await branchTimeline(
    {
      timelineId: DEFAULT_TIMELINE_ID,
      parentInteractionId: bootstrapRes.illustration.interactionId,
      scenarioPrompt:
        "Add *300MW* switchyard\nfor corridor_lead@example.com <marquee>",
      now: new Date("2026-10-27T15:10:00.000Z"),
    },
    { repository, geminiClient }
  );
  assert.equal(branchRes.status, "illustration_painted");

  for (let idx = 0; idx < 15; idx += 1) {
    const start = new Date(NOW.getTime() - (20 - idx) * 1_000);
    await recordStageRun(
      {
        stage: "tdlr_ingest",
        connectorId: "tdlr-tabs",
        projectNumber: "TABS2027003697",
        execution_mode: "deterministic",
        status: "ingested",
        rawByteLength: 2_048,
        tokensUsed: 0,
        naiveTokensAvoided: 512,
        startedAt: start,
        endedAt: new Date(start.getTime() + 45),
      },
      { repository }
    );
  }

  return {
    repository,
    canonicalPlateId: bootstrapRes.illustration.illustrationId,
    branchPlateId: branchRes.illustration.illustrationId,
  };
}

describe("Workspace Layout Contracts & Deterministic Workspace Hydrator — Phase 3", () => {
  test("hydrates a full 6-node workspace across all 5 canonical card types with bounded scorecard runs and escaped prose", async () => {
    const { repository, canonicalPlateId, branchPlateId } =
      await seedFullFiveCardRepository();

    const result = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "dossier-dfw",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027003697",
          },
          {
            nodeId: "corridor-scrubber",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
            initialIllustrationId: branchPlateId,
          },
          {
            nodeId: "corridor-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027003697", "TABS2027009888"],
          },
          {
            nodeId: "corridor-table",
            component: "MetricComparisonTable",
            projectNumbers: ["TABS2027003697", "TABS2027009888"],
          },
          {
            nodeId: "tdlr-health",
            component: "ConnectorHealthCard",
            connectorId: "tdlr-tabs",
          },
          {
            nodeId: "dossier-v2",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027009888",
          },
        ],
      },
      { repository },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    assert.equal(result.workspace.nodes.length, MAX_WORKSPACE_NODES);
    assert.deepEqual(
      WorkspaceLayoutSchema.parse(result.workspace),
      result.workspace
    );

    const serializedBytes = Buffer.byteLength(
      JSON.stringify(result.workspace),
      "utf-8"
    );
    assert.ok(
      serializedBytes < 16_384,
      `Expected compact WorkspaceLayout (< 16384 bytes), got ${serializedBytes}`
    );

    const scrubberNode = result.workspace.nodes[1];
    assert.ok(scrubberNode && scrubberNode.component === "FrameTimelineScrubber");
    assert.deepEqual(
      FrameTimelineScrubberNodeSchema.parse(scrubberNode),
      scrubberNode
    );
    assert.equal(scrubberNode.initialIllustrationId, branchPlateId);
    assert.equal(
      scrubberNode.timeline.activeCanonicalIllustrationId,
      canonicalPlateId
    );
    assert.equal(scrubberNode.timeline.nodes.length, 2);

    const [canonicalNode, branchedNode] = scrubberNode.timeline.nodes;
    assert.ok(canonicalNode && branchedNode);
    assert.equal(
      canonicalNode.plate.prompt,
      "Bootstrap \\<svg\\> canvas for \\[corridor\\](https://example.test) contact [REDACTED_EMAIL]"
    );
    assert.match(branchedNode.plate.prompt, /\[REDACTED_EMAIL\]/);
    assert.equal(
      branchedNode.plate.scenarioPrompt,
      "Add \\*300MW\\* switchyard for [REDACTED_EMAIL] \\<marquee\\>"
    );

    const maxPromptPrefix =
      "Add *300MW* <svg> switchyard for corridor_lead@example.com ";
    const maxScenarioPrompt =
      maxPromptPrefix +
      "*".repeat(MAX_SCENARIO_PROMPT_LENGTH - maxPromptPrefix.length);
    assert.equal(maxScenarioPrompt.length, MAX_SCENARIO_PROMPT_LENGTH);

    const maxBranchRes = await branchTimeline(
      {
        timelineId: DEFAULT_TIMELINE_ID,
        parentInteractionId: canonicalNode.plate.interactionId,
        scenarioPrompt: maxScenarioPrompt,
        now: new Date("2026-10-27T15:12:00.000Z"),
      },
      {
        repository,
        geminiClient: {
          interactions: {
            create: async () => ({
              id: "ix_painter_max_branch",
              status: "completed",
              output_image: {
                mime_type: "image/webp",
                data: createFixtureWebpBuffer("seam-plate-max").toString(
                  "base64"
                ),
              },
              usage: { total_tokens: 180 },
            }),
          },
        },
      }
    );
    assert.equal(maxBranchRes.status, "illustration_painted");

    const maxScrubberRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "max-prompt-scrubber",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
            initialIllustrationId: maxBranchRes.illustration.illustrationId,
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(maxScrubberRes.ok, true);
    const maxScrubberNode = maxScrubberRes.workspace.nodes[0];
    assert.ok(
      maxScrubberNode && maxScrubberNode.component === "FrameTimelineScrubber"
    );
    const hydratedMaxBranch = maxScrubberNode.timeline.nodes.find(
      (n) => n.plate.illustrationId === maxBranchRes.illustration.illustrationId
    );
    assert.ok(hydratedMaxBranch?.plate.scenarioPrompt);
    assert.ok(
      hydratedMaxBranch.plate.scenarioPrompt.length <= MAX_SCENARIO_PROMPT_LENGTH
    );
    assert.ok(
      hydratedMaxBranch.plate.scenarioPrompt.startsWith(
        "Add \\*300MW\\* \\<svg\\> switchyard for [REDACTED_EMAIL] "
      )
    );
    assert.ok(hydratedMaxBranch.plate.scenarioPrompt.endsWith("\\*..."));
    assert.equal(
      (
        hydratedMaxBranch.plate.scenarioPrompt
          .slice(0, -3)
          .match(/\\+$/)?.[0].length ?? 0
      ) % 2,
      0
    );

    const healthNode = result.workspace.nodes[4];
    assert.ok(healthNode && healthNode.component === "ConnectorHealthCard");
    assert.deepEqual(
      ConnectorHealthCardNodeSchema.parse(healthNode),
      healthNode
    );
    assert.equal(
      healthNode.scorecard.recentRuns.length,
      CONNECTOR_HEALTH_RECENT_RUNS_LIMIT
    );
    assert.equal(healthNode.changelog.activeVersion, 2);
    assert.equal(healthNode.changelog.entries.length, 1);

    const [healEntry] = healthNode.changelog.entries;
    assert.ok(healEntry);
    assert.equal(
      healEntry.rootCauseSummary,
      'Wrapper \\<div class="v2"\\> shifted; notify [REDACTED_EMAIL] for \\*audit\\*'
    );
    assert.ok(
      healEntry.brokenInvariants.some(
        (inv) =>
          inv.includes('\\<div class="project-details"\\>') &&
          inv.includes("[REDACTED_EMAIL]")
      )
    );
  });

  test("fails closed on empty or expired Frame Timelines, invalid initialIllustrationId, and unresolvable canonical illustration provenance", async () => {
    const { repository, canonicalPlateId, branchPlateId } =
      await seedFullFiveCardRepository();

    const unknownTimelineCheck = await getFrameTimeline(
      { timelineId: "unknown-corridor-timeline", now: NOW },
      { repository }
    );
    assert.equal(unknownTimelineCheck.ok, true);
    assert.deepEqual(unknownTimelineCheck.timeline.nodes, []);

    const unknownTimelineRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "missing-timeline",
            component: "FrameTimelineScrubber",
            timelineId: "unknown-corridor-timeline",
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(unknownTimelineRes.ok, false);
    assert.equal(unknownTimelineRes.error, "entity_not_found");

    const allPlates = await repository.listGeneratedIllustrationsByTimeline(
      DEFAULT_TIMELINE_ID
    );
    const branchOnlyPlates = allPlates.filter((plate) => plate.isBranch);
    const futureAfterBranchTtl = new Date(
      NOW.getTime() + NINETY_DAYS_MS + 60_000
    );

    const expiredBranchOnlyRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "expired-timeline",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
          },
        ],
      },
      {
        repository: {
          ...repository,
          listGeneratedIllustrationsByTimeline: async () => branchOnlyPlates,
        },
      },
      { now: futureAfterBranchTtl }
    );
    assert.equal(expiredBranchOnlyRes.ok, false);
    assert.equal(expiredBranchOnlyRes.error, "entity_not_found");

    for (const [badInitialId, evalNow] of [
      ["plate_nonexistent_id", NOW],
      [branchPlateId, futureAfterBranchTtl],
    ] as const) {
      const badInitialRes = await hydrateInvestigationWorkspace(
        {
          nodes: [
            {
              nodeId: "bad-initial-plate",
              component: "FrameTimelineScrubber",
              timelineId: DEFAULT_TIMELINE_ID,
              initialIllustrationId: badInitialId,
            },
          ],
        },
        { repository },
        { now: evalNow }
      );
      assert.equal(badInitialRes.ok, false);
      assert.equal(badInitialRes.error, "entity_not_found");
    }

    const canonicalPlate = allPlates.find(
      (plate) => plate.illustrationId === canonicalPlateId
    );
    assert.ok(canonicalPlate);
    const canonicalArtifactHash = canonicalPlate.rawCaptureHashes[0];
    assert.ok(canonicalArtifactHash);

    const quarantinedArtifact = createTestRawCapture(
      canonicalArtifactHash,
      "TABS2027003697",
      {
        storageUri: `${ARTIFACT_BUCKET_URI}/quarantine/${canonicalArtifactHash}.gz`,
        referencedByMilestone: false,
      }
    );

    for (const overrideArtifact of [null, quarantinedArtifact]) {
      const provFailRes = await hydrateInvestigationWorkspace(
        {
          nodes: [
            {
              nodeId: "scrubber-bad-prov",
              component: "FrameTimelineScrubber",
              timelineId: DEFAULT_TIMELINE_ID,
            },
          ],
        },
        {
          repository: {
            ...repository,
            getRawCaptureByHash: async (sha256) =>
              sha256 === canonicalArtifactHash
                ? overrideArtifact
                : repository.getRawCaptureByHash(sha256),
          },
        },
        { now: NOW }
      );
      assert.equal(provFailRes.ok, false);
      assert.equal(provFailRes.error, "unresolvable_provenance");

      const branchProvFailRes = await hydrateInvestigationWorkspace(
        {
          nodes: [
            {
              nodeId: "branch-scrubber-bad-prov",
              component: "FrameTimelineScrubber",
              timelineId: DEFAULT_TIMELINE_ID,
            },
          ],
        },
        {
          repository: {
            ...repository,
            listGeneratedIllustrationsByTimeline: async () => branchOnlyPlates,
            getRawCaptureByHash: async (sha256) =>
              sha256 === canonicalArtifactHash
                ? overrideArtifact
                : repository.getRawCaptureByHash(sha256),
          },
        },
        { now: NOW }
      );
      assert.equal(branchProvFailRes.ok, false);
      assert.equal(branchProvFailRes.error, "unresolvable_provenance");
    }

    const missingTriggeringObsRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "scrubber-missing-obs",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
          },
        ],
      },
      {
        repository: {
          ...repository,
          listObservationsByProject: async () => [],
        },
      },
      { now: NOW }
    );
    assert.equal(missingTriggeringObsRes.ok, false);
    assert.equal(missingTriggeringObsRes.error, "unresolvable_provenance");

    const zeroCitationPlateRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "scrubber-zero-citations",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
          },
        ],
      },
      {
        repository: {
          ...repository,
          listGeneratedIllustrationsByTimeline: async () => [
            { ...canonicalPlate, rawCaptureHashes: [] },
          ],
        },
      },
      { now: NOW }
    );
    assert.equal(zeroCitationPlateRes.ok, false);
    assert.equal(zeroCitationPlateRes.error, "unresolvable_provenance");
  });

  test("defensively slices unsliced scorecard recentRuns and fails closed on unknown Connector IDs or corrupted records", async () => {
    const { repository } = await seedFullFiveCardRepository();

    const unslicedScorecardRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "unsliced-scorecard-card",
            component: "ConnectorHealthCard",
            connectorId: "tdlr-tabs",
          },
        ],
      },
      {
        repository: {
          ...repository,
          getEfficiencyScorecard: async () => repository.getEfficiencyScorecard(),
        },
      },
      { now: NOW }
    );
    assert.equal(unslicedScorecardRes.ok, true);
    const slicedHealthNode = unslicedScorecardRes.workspace.nodes[0];
    assert.ok(
      slicedHealthNode && slicedHealthNode.component === "ConnectorHealthCard"
    );
    assert.equal(
      slicedHealthNode.scorecard.recentRuns.length,
      CONNECTOR_HEALTH_RECENT_RUNS_LIMIT
    );

    const unknownConnectorRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "unknown-connector-card",
            component: "ConnectorHealthCard",
            connectorId: "unknown-connector",
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(unknownConnectorRes.ok, false);
    assert.equal(unknownConnectorRes.error, "entity_not_found");

    const corruptPlateRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corrupt-scrubber",
            component: "FrameTimelineScrubber",
            timelineId: DEFAULT_TIMELINE_ID,
          },
        ],
      },
      {
        repository: {
          ...repository,
          listGeneratedIllustrationsByTimeline: async () =>
            [{ illustrationId: "corrupt", timelineId: DEFAULT_TIMELINE_ID }] as never,
        },
      },
      { now: NOW }
    );
    assert.equal(corruptPlateRes.ok, false);
    assert.equal(corruptPlateRes.error, "repository_integrity_error");

    const corruptConfigRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corrupt-config-card",
            component: "ConnectorHealthCard",
            connectorId: "tdlr-tabs",
          },
        ],
      },
      {
        repository: {
          ...repository,
          getActiveConnectorConfig: async () =>
            ({ connectorId: "wrong-id", version: -1 }) as never,
        },
      },
      { now: NOW }
    );
    assert.equal(corruptConfigRes.ok, false);
    assert.equal(corruptConfigRes.error, "repository_integrity_error");

    const corruptScorecardRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corrupt-scorecard-card",
            component: "ConnectorHealthCard",
            connectorId: "tdlr-tabs",
          },
        ],
      },
      {
        repository: {
          ...repository,
          getEfficiencyScorecard: async () =>
            ({ scorecardId: "broken_scorecard", totalRunsCount: -5 }) as never,
        },
      },
      { now: NOW }
    );
    assert.equal(corruptScorecardRes.ok, false);
    assert.equal(corruptScorecardRes.error, "repository_integrity_error");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  hydrateInvestigationWorkspace,
  MetricComparisonTableNodeSchema,
  ObservationSchema,
  ObservationTimelineNodeSchema,
  PlannerLayoutSpecSchema,
  UiWorkspaceAstSchema,
  type GridlockRepository,
} from "../src/index.ts";
import {
  createPainterTestObservations,
  createTestProject,
  createTestSourceArtifact,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");

async function seedTwoProjects(repository: GridlockRepository): Promise<void> {
  const { routineObs, milestoneObs } = createPainterTestObservations();
  const hashTie = "2".repeat(64);
  const hashEarly = "3".repeat(64);

  await repository.saveSourceArtifact(
    createTestSourceArtifact(routineObs.sourceArtifactHash, "TABS2027001111", {
      expiresAt: "2027-01-25T14:00:00.000Z",
      referencedByMilestone: false,
    }),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(milestoneObs.sourceArtifactHash, "TABS2027003697"),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(hashTie, "TABS2027003697"),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(hashEarly, "TABS2027001111"),
    GZIP_HTML_STUB
  );

  await repository.upsertProject(
    createTestProject("TABS2027001111", routineObs.sourceArtifactHash, {
      estimatedCostUsd: 2_500_000,
      squareFootage: 12_000,
    })
  );
  await repository.upsertProject(
    createTestProject("TABS2027003697", milestoneObs.sourceArtifactHash, {
      estimatedCostUsd: 125_000_000,
      squareFootage: 250_000,
    })
  );

  await repository.appendObservation(milestoneObs);
  await repository.appendObservation(
    ObservationSchema.parse({
      id: "obs_TABS2027003697_tie",
      projectNumber: "TABS2027003697",
      sourceArtifactHash: hashTie,
      observedAt: routineObs.observedAt,
      status: "Review <img src=x>\n *Pending*",
      estimatedCostUsd: 125_000_000,
      squareFootage: 250_000,
      scopeOfWork: "Notify ops_lead@example.com about [link](https://bad.test)",
      isMilestone: true,
    })
  );
  await repository.appendObservation(routineObs);
  await repository.appendObservation(
    ObservationSchema.parse({
      id: "obs_TABS2027001111_early",
      projectNumber: "TABS2027001111",
      sourceArtifactHash: hashEarly,
      observedAt: "2026-10-25T09:00:00.000Z",
      status: "Initial Filing",
      estimatedCostUsd: 2_500_000,
      squareFootage: 12_000,
      scopeOfWork: "Initial campus grading",
      isMilestone: true,
    })
  );
}

describe("UI AST Contracts & Deterministic Workspace Hydrator — Phase 2", () => {
  test("hydrates sorted multi-project ObservationTimeline, ordered MetricComparisonTable, and empty standalone card schemas", async () => {
    const repository = createInMemoryGridlockRepository();
    await seedTwoProjects(repository);

    const result = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corridor-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027003697", "TABS2027001111"],
          },
          {
            nodeId: "corridor-comparison",
            component: "MetricComparisonTable",
            projectNumbers: ["TABS2027003697", "TABS2027001111"],
          },
        ],
      },
      { repository },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      UiWorkspaceAstSchema.parse(result.workspace),
      result.workspace
    );

    const [timelineNode, tableNode] = result.workspace.nodes;
    assert.ok(timelineNode && timelineNode.component === "ObservationTimeline");
    assert.ok(tableNode && tableNode.component === "MetricComparisonTable");

    assert.deepEqual(
      timelineNode.observations.map((entry) => entry.observation.id),
      [
        "obs_TABS2027001111_early",
        "obs_TABS2027001111_routine",
        "obs_TABS2027003697_tie",
        "obs_TABS2027003697_m1",
      ]
    );

    const sanitizedEntry = timelineNode.observations[2];
    assert.ok(sanitizedEntry);
    assert.equal(
      sanitizedEntry.observation.status,
      "Review \\<img src=x\\> \\*Pending\\*"
    );
    assert.equal(
      sanitizedEntry.observation.scopeOfWork,
      "Notify [REDACTED_EMAIL] about \\[link\\](https://bad.test)"
    );
    assert.ok(
      timelineNode.observations.every(
        (entry) =>
          entry.citation.sha256 === entry.observation.sourceArtifactHash &&
          entry.citation.sourceUrl.startsWith("https://")
      )
    );

    assert.deepEqual(
      tableNode.rows.map((row) => ({
        projectNumber: row.project.projectNumber,
        estimatedCostUsd: row.project.estimatedCostUsd,
        squareFootage: row.project.squareFootage,
        sha256Matches:
          row.citation.sha256 === row.project.latestSourceArtifactHash,
      })),
      [
        {
          projectNumber: "TABS2027003697",
          estimatedCostUsd: 125_000_000,
          squareFootage: 250_000,
          sha256Matches: true,
        },
        {
          projectNumber: "TABS2027001111",
          estimatedCostUsd: 2_500_000,
          squareFootage: 12_000,
          sha256Matches: true,
        },
      ]
    );

    assert.equal(
      ObservationTimelineNodeSchema.safeParse({
        nodeId: "empty-timeline",
        component: "ObservationTimeline",
        projectNumbers: [],
        observations: [],
      }).success,
      true
    );
    assert.equal(
      MetricComparisonTableNodeSchema.safeParse({
        nodeId: "empty-table",
        component: "MetricComparisonTable",
        rows: [],
      }).success,
      true
    );
    assert.equal(
      PlannerLayoutSpecSchema.safeParse({
        nodes: [
          {
            nodeId: "empty-plan-timeline",
            component: "ObservationTimeline",
            projectNumbers: [],
          },
        ],
      }).success,
      false
    );
  });
});

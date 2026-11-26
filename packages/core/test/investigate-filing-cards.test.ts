import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  createInMemoryGridlockRepository,
  hydrateInvestigationWorkspace,
  MAX_PROJECTS_PER_CARD,
  MetricComparisonTableNodeSchema,
  ObservationSchema,
  ObservationTimelineNodeSchema,
  OrchestrationLayoutSpecSchema,
  WorkspaceLayoutSchema,
  type GridlockRepository,
  type RawCapture,
} from "../src/index.ts";
import {
  createPainterTestObservations,
  createTestProject,
  createTestRawCapture,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");

async function seedTwoProjects(repository: GridlockRepository): Promise<void> {
  const { routineObs, milestoneObs } = createPainterTestObservations();
  const hashTie = "2".repeat(64);
  const hashEarly = "3".repeat(64);

  await repository.saveRawCapture(
    createTestRawCapture(routineObs.rawCaptureHash, "TABS2027001111", {
      expiresAt: "2027-01-25T14:00:00.000Z",
      referencedByMilestone: false,
    }),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(milestoneObs.rawCaptureHash, "TABS2027003697"),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(hashTie, "TABS2027003697"),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(hashEarly, "TABS2027001111"),
    GZIP_HTML_STUB
  );

  await repository.upsertProject(
    createTestProject("TABS2027001111", routineObs.rawCaptureHash, {
      estimatedCostUsd: 2_500_000,
      squareFootage: 12_000,
    })
  );
  await repository.upsertProject(
    createTestProject("TABS2027003697", milestoneObs.rawCaptureHash, {
      estimatedCostUsd: 125_000_000,
      squareFootage: 250_000,
    })
  );

  await repository.appendObservation(milestoneObs);
  await repository.appendObservation(
    ObservationSchema.parse({
      id: "obs_TABS2027003697_tie",
      projectNumber: "TABS2027003697",
      rawCaptureHash: hashTie,
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
      rawCaptureHash: hashEarly,
      observedAt: "2026-10-25T09:00:00.000Z",
      status: "Initial Filing",
      estimatedCostUsd: 2_500_000,
      squareFootage: 12_000,
      scopeOfWork: "Initial campus grading",
      isMilestone: true,
    })
  );
}

describe("Workspace Layout Contracts & Deterministic Workspace Hydrator — Phase 2", () => {
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
      WorkspaceLayoutSchema.parse(result.workspace),
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
          entry.citation.sha256 === entry.observation.rawCaptureHash &&
          entry.citation.sourceUrl.startsWith("https://")
      )
    );

    assert.deepEqual(
      tableNode.rows.map((row) => ({
        projectNumber: row.project.projectNumber,
        estimatedCostUsd: row.project.estimatedCostUsd,
        squareFootage: row.project.squareFootage,
        sha256Matches:
          row.citation.sha256 === row.project.latestRawCaptureHash,
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
      OrchestrationLayoutSpecSchema.safeParse({
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

  test("quietly omits aged-out 90-day routine observations while failing closed on expired milestone, missing, or quarantined artifacts", async () => {
    const repository = createInMemoryGridlockRepository();
    const expiredRoutineHash = "4".repeat(64);
    const liveMilestoneHash = "5".repeat(64);

    await repository.saveRawCapture(
      createTestRawCapture(expiredRoutineHash, "TABS2027005555", {
        capturedAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-09-29T00:00:00.000Z",
        referencedByMilestone: false,
      }),
      GZIP_HTML_STUB
    );
    await repository.saveRawCapture(
      createTestRawCapture(liveMilestoneHash, "TABS2027005555", {
        expiresAt: null,
        referencedByMilestone: true,
      }),
      GZIP_HTML_STUB
    );
    await repository.upsertProject(
      createTestProject("TABS2027005555", liveMilestoneHash)
    );
    await repository.appendObservation(
      ObservationSchema.parse({
        id: "obs_routine_aged",
        projectNumber: "TABS2027005555",
        rawCaptureHash: expiredRoutineHash,
        observedAt: "2026-07-01T00:00:00.000Z",
        status: "Project Registered",
        estimatedCostUsd: 3_000_000,
        squareFootage: 15_000,
        scopeOfWork: "Routine electrical revision",
        isMilestone: false,
      })
    );
    await repository.appendObservation(
      ObservationSchema.parse({
        id: "obs_milestone_live",
        projectNumber: "TABS2027005555",
        rawCaptureHash: liveMilestoneHash,
        observedAt: "2026-10-20T10:00:00.000Z",
        status: "Construction Started",
        estimatedCostUsd: 80_000_000,
        squareFootage: 180_000,
        scopeOfWork: "Primary compute hall construction",
        isMilestone: true,
      })
    );

    const mixedRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "ttl-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027005555"],
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(mixedRes.ok, true);
    const mixedNode = mixedRes.workspace.nodes[0];
    assert.ok(mixedNode && mixedNode.component === "ObservationTimeline");
    assert.deepEqual(
      mixedNode.observations.map((entry) => entry.observation.id),
      ["obs_milestone_live"]
    );

    await repository.upsertProject(
      createTestProject("TABS2027006666", expiredRoutineHash, {
        estimatedCostUsd: 3_000_000,
        squareFootage: 15_000,
      })
    );
    await repository.appendObservation(
      ObservationSchema.parse({
        id: "obs_only_aged_routine",
        projectNumber: "TABS2027006666",
        rawCaptureHash: expiredRoutineHash,
        observedAt: "2026-07-01T00:00:00.000Z",
        status: "Project Registered",
        estimatedCostUsd: 3_000_000,
        squareFootage: 15_000,
        scopeOfWork: "Aged routine filing",
        isMilestone: false,
      })
    );

    const allAgedRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "all-aged-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027006666"],
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(allAgedRes.ok, true);
    const agedNode = allAgedRes.workspace.nodes[0];
    assert.ok(agedNode && agedNode.component === "ObservationTimeline");
    assert.deepEqual(agedNode.observations, []);

    const badObservationCases: ReadonlyArray<{
      isMilestone: boolean;
      artifact: RawCapture | null;
    }> = [
      {
        isMilestone: true,
        artifact: createTestRawCapture("7".repeat(64), "TABS2027005555", {
          expiresAt: "2026-10-28T15:00:00.000Z",
        }),
      },
      {
        isMilestone: false,
        artifact: null,
      },
      {
        isMilestone: false,
        artifact: createTestRawCapture("7".repeat(64), "TABS2027005555", {
          storageUri: `${ARTIFACT_BUCKET_URI}/quarantine/${"7".repeat(64)}.gz`,
        }),
      },
    ];

    for (const badCase of badObservationCases) {
      const targetHash = "7".repeat(64);
      const failRes = await hydrateInvestigationWorkspace(
        {
          nodes: [
            {
              nodeId: "fail-prov-timeline",
              component: "ObservationTimeline",
              projectNumbers: ["TABS2027005555"],
            },
          ],
        },
        {
          repository: {
            ...repository,
            getProjectByNumber: async () =>
              createTestProject("TABS2027005555", liveMilestoneHash),
            getRawCaptureByHash: async (sha256) =>
              sha256 === targetHash ? badCase.artifact : null,
            listObservationsByProject: async () => [
              ObservationSchema.parse({
                id: "obs_bad_prov",
                projectNumber: "TABS2027005555",
                rawCaptureHash: targetHash,
                observedAt: "2026-10-20T10:00:00.000Z",
                status: "Project Registered",
                estimatedCostUsd: 50_000_000,
                squareFootage: 100_000,
                scopeOfWork: "Compute shell",
                isMilestone: badCase.isMilestone,
              }),
            ],
          },
        },
        { now: NOW }
      );
      assert.equal(failRes.ok, false);
      assert.equal(failRes.error, "unresolvable_provenance");
    }
  });

  test("enforces project bounds, missing entity checks, and stored Observation integrity", async () => {
    const repository = createInMemoryGridlockRepository();
    await seedTwoProjects(repository);

    const elevenProjects = Array.from(
      { length: MAX_PROJECTS_PER_CARD + 1 },
      (_, idx) => `TABS202700${String(1000 + idx)}`
    );

    for (const invalidSpec of [
      {
        nodes: [
          {
            nodeId: "dup-projects",
            component: "MetricComparisonTable",
            projectNumbers: ["TABS2027003697", "TABS2027003697"],
          },
        ],
      },
      {
        nodes: [
          {
            nodeId: "too-many-projects",
            component: "ObservationTimeline",
            projectNumbers: elevenProjects,
          },
        ],
      },
    ]) {
      const res = await hydrateInvestigationWorkspace(invalidSpec, {
        repository,
      });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_layout_spec");
    }

    for (const component of [
      "ObservationTimeline",
      "MetricComparisonTable",
    ] as const) {
      const missingRes = await hydrateInvestigationWorkspace(
        {
          nodes: [
            {
              nodeId: `missing-${component}`,
              component,
              projectNumbers: ["TABS2027003697", "TABS2099000099"],
            },
          ],
        },
        { repository },
        { now: NOW }
      );
      assert.equal(missingRes.ok, false);
      assert.equal(missingRes.error, "entity_not_found");
    }

    const corruptObsRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corrupt-obs",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027003697"],
          },
        ],
      },
      {
        repository: {
          ...repository,
          listObservationsByProject: async () =>
            [{ id: "broken", projectNumber: "TABS2027003697" }] as never,
        },
      },
      { now: NOW }
    );
    assert.equal(corruptObsRes.ok, false);
    assert.equal(corruptObsRes.error, "repository_integrity_error");
  });
});

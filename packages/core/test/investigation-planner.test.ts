import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_LINEAGE_ID,
  INVESTIGATION_PLANNER_MODEL,
  InvestigatePlanResponseSchema,
  MAX_INVESTIGATE_QUERY_LENGTH,
  MAX_PLANNER_CATALOG_PROJECTS,
  PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
  RepairChangelogEntrySchema,
  runInvestigationPlanner,
  TelemetryStageSchema,
  type GeminiInteractionResponse,
  type GridlockRepository,
  type TelemetrySpan,
} from "../src/index.ts";
import { createTestProject } from "./helpers/fixtures.ts";
import {
  createFiveCardLayoutSpec,
  createPlannerClientStub,
  createPlannerObservation,
  createQueuedLayoutClientStub,
  HASH_ACTIVE_A,
  HASH_QUARANTINED,
  PLANNER_TEST_NOW,
  seedFilingPlannerRepository,
  seedFiveCardPlannerRepository,
  singleNodeLayout,
} from "./helpers/planner-test-helpers.ts";

describe("runInvestigationPlanner (Core filing planner & preconditions)", () => {
  test("TelemetryStageSchema accepts investigation_planner", () => {
    assert.equal(TelemetryStageSchema.safeParse("investigation_planner").success, true);
  });

  test("hydrates filing cards, filters uncitable catalog projects, redacts PII, and records telemetry", async () => {
    const repository = await seedFilingPlannerRepository();
    const spans: TelemetrySpan[] = [];
    const { geminiClient, recordedRequests } = createPlannerClientStub(async () => ({
      id: "ix_planner_200",
      status: "completed",
      output_text: JSON.stringify({
        nodes: [
          {
            nodeId: "dossier-1001",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027001001",
          },
          {
            nodeId: "timeline-ellis",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027001001", "TABS2027001002"],
          },
          {
            nodeId: "metrics-ellis",
            component: "MetricComparisonTable",
            projectNumbers: ["TABS2027001001", "TABS2027001002"],
          },
        ],
      }),
      usage: { total_tokens: 340 },
    }));

    const outcome = await runInvestigationPlanner(
      { query: "Compare Ellis County data center filings", now: PLANNER_TEST_NOW },
      { repository, geminiClient, spanSink: (span) => spans.push(span) }
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.status, 200);
    assert.equal(InvestigatePlanResponseSchema.safeParse(outcome.response).success, true);
    assert.equal(outcome.response.interactionId, "ix_planner_200");
    assert.equal(outcome.response.tokensUsed, 340);
    assert.equal(outcome.response.workspace.isEmpty, false);
    assert.equal(outcome.response.workspace.nodes.length, 3);
    const dossierNode = outcome.response.workspace.nodes[0]!;
    assert.equal(dossierNode.component, "ProjectDossierCard");
    if (dossierNode.component === "ProjectDossierCard") {
      assert.equal(dossierNode.citedProject.citation.sha256, HASH_ACTIVE_A);
      assert.equal(
        dossierNode.citedProject.project.projectName.includes("[REDACTED_EMAIL]"),
        true
      );
      assert.equal(
        dossierNode.citedProject.project.projectName.includes("ops@example.com"),
        false
      );
      assert.equal(
        dossierNode.citedProject.project.ownerName.includes("[REDACTED_PHONE]"),
        true
      );
      assert.equal(
        dossierNode.citedProject.project.ownerName.includes("555-0199"),
        false
      );
    }

    assert.equal(recordedRequests.length, 1);
    const geminiReq = recordedRequests[0]!;
    assert.equal(geminiReq.model, INVESTIGATION_PLANNER_MODEL);
    assert.deepEqual(geminiReq.response_format?.schema, PLANNER_LAYOUT_SPEC_JSON_SCHEMA);
    assert.equal(PLANNER_LAYOUT_SPEC_JSON_SCHEMA.additionalProperties, false);

    const parsedPrompt = JSON.parse(String(geminiReq.input)) as {
      catalog: { projects: Array<Record<string, unknown>> };
    };
    const catalogNumbers = parsedPrompt.catalog.projects.map((p) => p.projectNumber);
    assert.deepEqual(catalogNumbers, ["TABS2027001001", "TABS2027001002"]);
    assert.equal(String(geminiReq.input).includes("ops@example.com"), false);
    assert.equal(String(geminiReq.input).includes("555-0199"), false);
    assert.equal(String(geminiReq.input).includes("[REDACTED_EMAIL]"), true);
    assert.equal(String(geminiReq.input).includes("[REDACTED_PHONE]"), true);

    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.stage, "investigation_planner");
    assert.equal(runs[0]?.execution_mode, "agentic");
    assert.equal(runs[0]?.status, "agentic_completed");
    assert.equal(runs[0]?.tokensUsed, 340);
    assert.equal(runs[0]?.expiresAt, null);
    const ledger = await repository.getEfficiencyLedger();
    assert.equal(ledger.agenticRunsCount, 1);
    assert.equal(ledger.actualTokensUsed, 340);
    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.stage, "investigation_planner");
    assert.equal(spans[0]?.attributes?.nodeCount, 3);
    assert.equal(spans[0]?.attributes?.isEmpty, false);
  });

  test("caps citable project catalog at MAX_PLANNER_CATALOG_PROJECTS with deterministic tie-breaking and flags unresolvable milestone timelines", async () => {
    const repository = await seedFilingPlannerRepository();
    await repository.appendObservation(
      createPlannerObservation(
        "obs_1001_quarantined_m2",
        "TABS2027001001",
        HASH_QUARANTINED,
        { observedAt: "2026-10-28T11:00:00.000Z", isMilestone: true }
      )
    );

    await repository.upsertProject(
      createTestProject("TABS2027005002", HASH_ACTIVE_A, {
        updatedAt: "2026-10-28T14:00:00.000Z",
      })
    );
    await repository.upsertProject(
      createTestProject("TABS2027005001", HASH_ACTIVE_A, {
        updatedAt: "2026-10-28T14:00:00.000Z",
      })
    );
    for (let idx = 3; idx <= 48; idx += 1) {
      const padded = String(idx).padStart(2, "0");
      await repository.upsertProject(
        createTestProject(`TABS20270050${padded}`, HASH_ACTIVE_A, {
          updatedAt: `2026-10-27T12:${padded}:00.000Z`,
        })
      );
    }
    for (const tail of ["49", "50"]) {
      await repository.upsertProject(
        createTestProject(`TABS20270050${tail}`, HASH_ACTIVE_A, {
          updatedAt: "2026-10-26T00:00:00.000Z",
        })
      );
    }

    const { geminiClient, recordedRequests } = createPlannerClientStub(async () => ({
      id: "ix_planner_cap",
      status: "completed",
      output_text: JSON.stringify({ nodes: [] }),
      usage: { total_tokens: 150 },
    }));

    const outcome = await runInvestigationPlanner(
      { query: "List top Ellis corridor filings", now: PLANNER_TEST_NOW },
      { repository, geminiClient }
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const parsedPrompt = JSON.parse(String(recordedRequests[0]?.input)) as {
      catalog: {
        projects: Array<{
          projectNumber: string;
          timelineHydratable: boolean;
          observationCount: number;
          hasMilestone: boolean;
        }>;
      };
    };
    assert.equal(parsedPrompt.catalog.projects.length, MAX_PLANNER_CATALOG_PROJECTS);
    assert.deepEqual(
      parsedPrompt.catalog.projects.slice(0, 3).map((p) => p.projectNumber),
      ["TABS2027005001", "TABS2027005002", "TABS2027001001"]
    );
    assert.equal(
      parsedPrompt.catalog.projects.some((p) => p.projectNumber === "TABS2027005049"),
      false
    );
    assert.equal(
      parsedPrompt.catalog.projects.some((p) => p.projectNumber === "TABS2027005050"),
      false
    );

    const entry1001 = parsedPrompt.catalog.projects.find(
      (p) => p.projectNumber === "TABS2027001001"
    );
    assert.equal(entry1001?.timelineHydratable, false);
    assert.equal(entry1001?.observationCount, 1);
    assert.equal(entry1001?.hasMilestone, true);
  });

  test("hydrates zero-match empty workspace (isEmpty: true) and records completed telemetry", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient } = createPlannerClientStub(async () => ({
      id: "ix_planner_empty",
      status: "completed",
      output_text: JSON.stringify({ nodes: [] }),
      usage: { total_tokens: 120 },
    }));

    const outcome = await runInvestigationPlanner(
      { query: "Show El Paso geothermal filings", now: PLANNER_TEST_NOW },
      { repository, geminiClient }
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.status, 200);
    assert.equal(outcome.response.workspace.isEmpty, true);
    assert.deepEqual(outcome.response.workspace.nodes, []);

    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "agentic_completed");
    assert.equal(runs[0]?.tokensUsed, 120);

    const brokenTelemetryRepo: GridlockRepository = {
      ...repository,
      recordTelemetryRun: async () => {
        throw new Error("Telemetry ledger write failed");
      },
    };
    const telemetryWriteErr = await runInvestigationPlanner(
      { query: "Show El Paso geothermal filings", now: PLANNER_TEST_NOW },
      { repository: brokenTelemetryRepo, geminiClient }
    );
    assert.equal(telemetryWriteErr.ok, false);
    if (!telemetryWriteErr.ok) {
      assert.equal(telemetryWriteErr.status, 500);
      assert.equal(telemetryWriteErr.error, "investigate_plan_error");
    }
  });

  test("enforces zero-token preconditions on 400 invalid input/now/query, 500 corrupt or duplicate-observation storage, and 503 missing client", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient, recordedRequests } = createPlannerClientStub(async () => ({
      id: "ix_unused",
      status: "completed",
      output_text: JSON.stringify({ nodes: [] }),
    }));

    for (const malformedInput of [
      null as never,
      [] as never,
      { query: "Show Ellis filings", now: new Date("invalid") },
      { query: "Show Ellis filings", now: "2026-10-28T15:00:00.000Z" as never },
      { query: "Show Ellis filings", extraKey: true, now: PLANNER_TEST_NOW } as never,
      { query: "   ", now: PLANNER_TEST_NOW },
      { query: "x".repeat(MAX_INVESTIGATE_QUERY_LENGTH + 1), now: PLANNER_TEST_NOW },
    ]) {
      const badInputRes = await runInvestigationPlanner(malformedInput, {
        repository,
        geminiClient,
      });
      assert.equal(badInputRes.ok, false);
      if (!badInputRes.ok) {
        assert.equal(badInputRes.status, 400);
        assert.equal(badInputRes.error, "invalid_request_body");
      }
    }

    const duplicateObservation = createPlannerObservation(
      "obs_1001_m1",
      "TABS2027001001",
      HASH_ACTIVE_A,
      { scopeOfWork: "Duplicate observation id fixture" }
    );
    const corruptRepositories: GridlockRepository[] = [
      {
        ...repository,
        listProjects: async () => [{ broken: true }] as never,
      },
      {
        ...repository,
        listObservationsByProject: async (projectNumber) =>
          projectNumber === "TABS2027001001"
            ? [duplicateObservation, duplicateObservation]
            : repository.listObservationsByProject(projectNumber),
      },
    ];
    for (const corruptRepo of corruptRepositories) {
      const corruptRes = await runInvestigationPlanner(
        { query: "Show Ellis filings", now: PLANNER_TEST_NOW },
        { repository: corruptRepo, geminiClient }
      );
      assert.equal(corruptRes.ok, false);
      if (!corruptRes.ok) {
        assert.equal(corruptRes.status, 500);
        assert.equal(corruptRes.error, "investigate_plan_error");
      }
    }

    const unavailableRes = await runInvestigationPlanner(
      { query: "Show Ellis filings", now: PLANNER_TEST_NOW },
      { repository }
    );
    assert.equal(unavailableRes.ok, false);
    if (!unavailableRes.ok) {
      assert.equal(unavailableRes.status, 503);
      assert.equal(unavailableRes.error, "planner_unavailable");
    }

    assert.equal(recordedRequests.length, 0);
    assert.equal((await repository.listTelemetryRuns()).length, 0);
  });

  test("maps upstream and structural AI failures to 502 with agentic_failed telemetry", async () => {
    const repository = await seedFilingPlannerRepository();

    const thrownOutcome = await runInvestigationPlanner(
      { query: "Show Ellis filings", now: PLANNER_TEST_NOW },
      {
        repository,
        geminiClient: {
          interactions: {
            create: async () => {
              throw new Error("Upstream Gemini timeout");
            },
          },
        },
      }
    );
    assert.equal(thrownOutcome.ok, false);
    if (!thrownOutcome.ok) {
      assert.equal(thrownOutcome.status, 502);
      assert.equal(thrownOutcome.error, "planner_upstream_error");
    }

    const invalidResponses: GeminiInteractionResponse[] = [
      {
        id: "ix_failed_status",
        status: "failed",
        errors: [{ code: "INTERNAL", message: "Model overloaded" }],
        usage: { total_tokens: 45 },
      },
      {
        id: "   ",
        status: "completed",
        output_text: JSON.stringify({ nodes: [] }),
        usage: { total_tokens: 50 },
      },
      {
        id: "ix_empty_text",
        status: "completed",
        output_text: "   ",
        usage: { total_tokens: 52.9 },
      },
      {
        id: "ix_bad_json",
        status: "completed",
        output_text: "{not-json",
        usage: { total_tokens: 60 },
      },
      {
        id: "ix_bad_spec",
        status: "completed",
        output_text: JSON.stringify({
          nodes: [{ nodeId: "dup", component: "UnknownWidget" }],
        }),
        usage: { total_tokens: 75 },
      },
    ];

    for (const response of invalidResponses) {
      const { geminiClient } = createPlannerClientStub(async () => response);
      const res = await runInvestigationPlanner(
        { query: "Show Ellis filings", now: PLANNER_TEST_NOW },
        { repository, geminiClient }
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 502);
        assert.equal(res.error, "planner_upstream_error");
      }
    }

    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, 6);
    assert.equal(
      runs.every((run) => run.stage === "investigation_planner" && run.status === "agentic_failed"),
      true
    );
    assert.deepEqual(
      runs.map((run) => run.tokensUsed),
      [0, 45, 50, 52, 60, 75]
    );
    assert.equal(runs[2]?.interactionId, undefined);
  });

  test("maps fabricated or quarantined entity references in valid specs to 422", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient } = createQueuedLayoutClientStub(
      [
        singleNodeLayout({
          nodeId: "missing-dossier",
          component: "ProjectDossierCard",
          projectNumber: "TABS9999999999",
        }),
        singleNodeLayout({
          nodeId: "quarantined-dossier",
          component: "ProjectDossierCard",
          projectNumber: "TABS2027001003",
        }),
      ],
      { idPrefix: "ix_unresolvable_422", baseTokens: 85, tokenStep: 5 }
    );

    for (const query of ["Show TABS9999999999", "Show quarantined project"]) {
      const unresolvableRes = await runInvestigationPlanner(
        { query, now: PLANNER_TEST_NOW },
        { repository, geminiClient }
      );
      assert.equal(unresolvableRes.ok, false);
      if (!unresolvableRes.ok) {
        assert.equal(unresolvableRes.status, 422);
        assert.equal(unresolvableRes.error, "planner_unresolvable_plan");
      }
    }

    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, 2);
    assert.equal(runs[0]?.status, "agentic_failed");
    assert.equal(runs[0]?.tokensUsed, 90);
    assert.equal(runs[1]?.status, "agentic_failed");
    assert.equal(runs[1]?.tokensUsed, 95);
  });
});

describe("runInvestigationPlanner (Cross-seam grounding)", () => {
  test("grounds healthy lineages and connectors, omits quarantined/expired lineages, and hydrates all 5 card types", async () => {
    const { repository, branchPlateId } = await seedFiveCardPlannerRepository();
    const { geminiClient, recordedRequests } = createPlannerClientStub(async () => ({
      id: "ix_planner_five_card",
      status: "completed",
      output_text: JSON.stringify(createFiveCardLayoutSpec(branchPlateId)),
      usage: { total_tokens: 410 },
    }));

    const outcome = await runInvestigationPlanner(
      {
        query: "Assemble full Ellis corridor dossier, plates, and connector health",
        now: PLANNER_TEST_NOW,
      },
      { repository, geminiClient }
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.status, 200);
    assert.deepEqual(
      outcome.response.workspace.nodes.map((node) => node.component),
      [
        "ProjectDossierCard",
        "ObservationTimeline",
        "MetricComparisonTable",
        "VisualPlateScrubber",
        "ConnectorHealthCard",
      ]
    );
    const scrubberNode = outcome.response.workspace.nodes.find(
      (node) => node.component === "VisualPlateScrubber"
    );
    assert.equal(scrubberNode?.component, "VisualPlateScrubber");
    if (scrubberNode?.component === "VisualPlateScrubber") {
      const frameIds = scrubberNode.lineage.nodes.map((n) => n.plate.plateId);
      assert.equal(frameIds.length, 2);
      assert.equal(frameIds.includes(branchPlateId), true);
      assert.equal(frameIds.includes("plate_expired_branch"), false);
    }

    const promptText = String(recordedRequests[0]?.input);
    const parsedPrompt = JSON.parse(promptText) as {
      catalog: {
        projects: Array<{ projectNumber: string }>;
        lineages: Array<{ lineageId: string; plates: Array<{ plateId: string }> }>;
        connectors: Array<{ connectorId: string; activeVersion: number; repairCount: number }>;
      };
    };
    assert.deepEqual(
      parsedPrompt.catalog.projects.map((p) => p.projectNumber),
      ["TABS2027001001", "TABS2027001002"]
    );
    assert.deepEqual(
      parsedPrompt.catalog.lineages.map((l) => l.lineageId),
      [DEFAULT_LINEAGE_ID]
    );
    assert.equal(parsedPrompt.catalog.lineages[0]?.plates.length, 2);
    assert.deepEqual(parsedPrompt.catalog.connectors, [
      { connectorId: "tdlr-tabs", status: "healthy", activeVersion: 2, repairCount: 1 },
    ]);
    assert.equal(promptText.includes("planner_lead@example.com"), false);
    assert.equal(promptText.includes("[REDACTED_EMAIL]"), true);
  });

  test("aborts with 500 at 0 Gemini calls and 0 TelemetryRun writes on corrupt VisualPlate, RepairChangelogEntry, or ConnectorConfig", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient, recordedRequests } = createPlannerClientStub(async () => ({
      id: "ix_unreachable",
      status: "completed",
      output_text: JSON.stringify({ nodes: [] }),
    }));

    const blankSummaryEntry = RepairChangelogEntrySchema.parse({
      id: "chg_blank_summary",
      connectorId: "tdlr-tabs",
      previousVersion: 1,
      promotedVersion: 2,
      quarantinedArtifactHash: HASH_QUARANTINED,
      brokenInvariants: ["Missing selector"],
      selectorDiffs: [
        {
          field: "detailContainerSelector",
          before: ".old",
          after: ".new",
        },
      ],
      rootCauseSummary: "   ",
      historicalFixturesTested: 1,
      historicalFixturesPassed: 1,
      totalFixturesVerified: 2,
      anomalyDetectedAt: "2026-10-28T11:59:00.000Z",
      patchPromotedAt: "2026-10-28T12:00:00.000Z",
      mttrMs: 500,
      interactionId: "ix_blank_summary",
      repairTokensUsed: 100,
      estimatedRepairCostUsd: 0.00025,
      subsequentDeterministicRunsServed: 0,
      expiresAt: null,
    });

    const blankProseRes = await runInvestigationPlanner(
      { query: "Check corridor status", now: PLANNER_TEST_NOW },
      {
        repository: {
          ...repository,
          listRepairChangelog: async () => [blankSummaryEntry],
        },
        geminiClient,
      }
    );
    assert.equal(blankProseRes.ok, false);
    if (!blankProseRes.ok) {
      assert.equal(blankProseRes.status, 500);
      assert.equal(blankProseRes.error, "investigate_plan_error");
      assert.equal(
        blankProseRes.message,
        "Sanitized RepairChangelogEntry prose failed runtime schema validation"
      );
    }

    const corruptVariants: GridlockRepository[] = [
      {
        ...repository,
        listVisualPlatesByLineage: async () => [{ plateId: "bad" }] as never,
      },
      {
        ...repository,
        listRepairChangelog: async () => [{ connectorId: "tdlr-tabs" }] as never,
      },
      {
        ...repository,
        getActiveConnectorConfig: async () => ({ connectorId: "wrong-id" }) as never,
      },
    ];

    for (const corruptRepo of corruptVariants) {
      const res = await runInvestigationPlanner(
        { query: "Check corridor status", now: PLANNER_TEST_NOW },
        { repository: corruptRepo, geminiClient }
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 500);
        assert.equal(res.error, "investigate_plan_error");
      }
    }

    assert.equal(recordedRequests.length, 0);
    assert.equal((await repository.listTelemetryRuns()).length, 0);
  });
});

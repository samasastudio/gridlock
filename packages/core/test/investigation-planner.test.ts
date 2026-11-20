import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  INVESTIGATION_PLANNER_MODEL,
  InvestigatePlanResponseSchema,
  MAX_PLANNER_CATALOG_PROJECTS,
  PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
  runInvestigationPlanner,
  TelemetryStageSchema,
  type GeminiInteractionsClient,
  type TelemetrySpan,
} from "../src/index.ts";
import {
  createPlannerClientStub,
  HASH_ACTIVE_A,
  PLANNER_TEST_NOW,
  seedFilingPlannerRepository,
} from "./helpers/planner-test-helpers.ts";

describe("runInvestigationPlanner (Core filing planner & preconditions)", () => {
  test("TelemetryStageSchema accepts investigation_planner", () => {
    assert.equal(TelemetryStageSchema.safeParse("investigation_planner").success, true);
    assert.equal(MAX_PLANNER_CATALOG_PROJECTS, 50);
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

  test("hydrates zero-match empty workspace (isEmpty: true) and records completed telemetry", async () => {
    const repository = createInMemoryGridlockRepository();
    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async () => ({
          id: "ix_planner_empty",
          status: "completed",
          output_text: JSON.stringify({ nodes: [] }),
          usage: { total_tokens: 120 },
        }),
      },
    };

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
  });
});

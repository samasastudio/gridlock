import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  INVESTIGATION_PLANNER_MODEL,
  InvestigatePlanResponseSchema,
  ObservationSchema,
  PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
  runInvestigationPlanner,
  TelemetryStageSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionsClient,
  type TelemetrySpan,
} from "../src/index.ts";
import {
  createTestProject,
  createTestSourceArtifact,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";

const PLANNER_TEST_NOW = new Date("2026-10-28T15:00:00.000Z");
const HASH_ACTIVE_A = "a".repeat(64);

describe("runInvestigationPlanner (Core filing planner & preconditions)", () => {
  test("TelemetryStageSchema accepts investigation_planner", () => {
    assert.equal(TelemetryStageSchema.safeParse("investigation_planner").success, true);
  });

  test("hydrates filing cards, redacts PII, and records investigation_planner telemetry", async () => {
    const repository = createInMemoryGridlockRepository();
    await repository.saveSourceArtifact(
      createTestSourceArtifact(HASH_ACTIVE_A, "TABS2027001001"),
      GZIP_HTML_STUB
    );
    await repository.upsertProject(
      createTestProject("TABS2027001001", HASH_ACTIVE_A, {
        projectName: "Ellis Campus Hall A - contact ops@example.com",
        ownerName: "Corridor Holdings LLC (512) 555-0199",
        estimatedCostUsd: 120_000_000,
        squareFootage: 260_000,
        updatedAt: "2026-10-28T10:00:00.000Z",
      })
    );
    await repository.appendObservation(
      ObservationSchema.parse({
        id: "obs_1001_m1",
        projectNumber: "TABS2027001001",
        sourceArtifactHash: HASH_ACTIVE_A,
        observedAt: "2026-10-28T10:00:00.000Z",
        status: "Project Registered",
        estimatedCostUsd: 120_000_000,
        squareFootage: 260_000,
        scopeOfWork: "Construct hyperscale data hall A",
        isMilestone: true,
      })
    );

    const spans: TelemetrySpan[] = [];
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async (req) => {
          recordedRequests.push(req);
          return {
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
                  projectNumbers: ["TABS2027001001"],
                },
              ],
            }),
            usage: { total_tokens: 340 },
          };
        },
      },
    };

    const outcome = await runInvestigationPlanner(
      { query: "Inspect Ellis County data center filings", now: PLANNER_TEST_NOW },
      { repository, geminiClient, spanSink: (span) => spans.push(span) }
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.status, 200);
    assert.equal(InvestigatePlanResponseSchema.safeParse(outcome.response).success, true);
    assert.equal(outcome.response.interactionId, "ix_planner_200");
    assert.equal(outcome.response.tokensUsed, 340);
    assert.equal(outcome.response.workspace.isEmpty, false);
    assert.equal(outcome.response.workspace.nodes.length, 2);

    const dossierNode = outcome.response.workspace.nodes[0]!;
    assert.equal(dossierNode.component, "ProjectDossierCard");
    if (dossierNode.component === "ProjectDossierCard") {
      assert.equal(dossierNode.citedProject.citation.sha256, HASH_ACTIVE_A);
      assert.equal(
        dossierNode.citedProject.project.projectName.includes("[REDACTED_EMAIL]"),
        true
      );
      assert.equal(
        dossierNode.citedProject.project.ownerName.includes("[REDACTED_PHONE]"),
        true
      );
    }

    assert.equal(recordedRequests.length, 1);
    const geminiReq = recordedRequests[0]!;
    assert.equal(geminiReq.model, INVESTIGATION_PLANNER_MODEL);
    assert.deepEqual(geminiReq.response_format?.schema, PLANNER_LAYOUT_SPEC_JSON_SCHEMA);
    assert.equal(PLANNER_LAYOUT_SPEC_JSON_SCHEMA.additionalProperties, false);
    assert.equal(String(geminiReq.input).includes("ops@example.com"), false);
    assert.equal(String(geminiReq.input).includes("555-0199"), false);

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
    assert.equal(spans[0]?.attributes?.nodeCount, 2);
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

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  InvestigatePlanResponseSchema,
  MAX_INVESTIGATE_QUERY_LENGTH,
  MAX_WORKSPACE_NODES,
  type GeminiInteractionResponse,
  type GridlockRepository,
} from "../src/index.ts";
import {
  assertInvestigateErrorResponse,
  createPlannerClientStub,
  createQueuedLayoutClientStub,
  HASH_ACTIVE_A,
  postInvestigatePlan,
  seedFilingPlannerRepository,
  withGridlockTestServer,
} from "./helpers/planner-test-helpers.ts";

const NOW = new Date("2026-10-28T16:00:00.000Z");

describe("POST /api/investigate/plan HTTP Seam", () => {
  test("returns 200 for multi-card and empty workspaces, CORS headers, and 204 on OPTIONS", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient } = createQueuedLayoutClientStub(
      [
        {
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
            {
              nodeId: "metrics-ellis",
              component: "MetricComparisonTable",
              projectNumbers: ["TABS2027001001", "TABS2027001002"],
            },
          ],
        },
        { nodes: [] },
      ],
      { idPrefix: "ix_http_filing" }
    );

    await withGridlockTestServer(
      { repository, geminiClient, now: () => NOW },
      async (baseUrl) => {
        const optRes = await fetch(`${baseUrl}/api/investigate/plan`, {
          method: "OPTIONS",
        });
        assert.equal(optRes.status, 204);
        assert.equal(optRes.headers.get("access-control-allow-origin"), "*");
        assert.equal(
          optRes.headers.get("access-control-allow-methods"),
          "GET, POST, OPTIONS"
        );
        assert.equal(
          optRes.headers.get("access-control-allow-headers"),
          "content-type"
        );

        const multiRes = await postInvestigatePlan(
          `${baseUrl}/api/investigate/plan`,
          JSON.stringify({ query: "Compare Ellis filings" })
        );
        assert.equal(multiRes.status, 200);
        assert.equal(multiRes.headers.get("access-control-allow-origin"), "*");
        assert.equal(multiRes.headers.get("cache-control"), "no-store");
        const multiPayload = InvestigatePlanResponseSchema.parse(
          await multiRes.json()
        );
        assert.equal(multiPayload.workspace.isEmpty, false);
        assert.equal(multiPayload.workspace.nodes.length, 3);
        assert.equal(multiPayload.workspace.generatedAt, NOW.toISOString());
        const httpDossier = multiPayload.workspace.nodes[0]!;
        assert.equal(httpDossier.component, "ProjectDossierCard");
        if (httpDossier.component === "ProjectDossierCard") {
          assert.equal(httpDossier.citedProject.citation.sha256, HASH_ACTIVE_A);
          assert.equal(
            httpDossier.citedProject.project.projectName.includes("[REDACTED_EMAIL]"),
            true
          );
          assert.equal(
            httpDossier.citedProject.project.ownerName.includes("[REDACTED_PHONE]"),
            true
          );
        }

        const emptyRes = await postInvestigatePlan(
          `${baseUrl}/api/investigate/plan`,
          JSON.stringify({ query: "Show Lubbock nuclear filings" })
        );
        assert.equal(emptyRes.status, 200);
        const emptyPayload = InvestigatePlanResponseSchema.parse(
          await emptyRes.json()
        );
        assert.equal(emptyPayload.workspace.isEmpty, true);
        assert.deepEqual(emptyPayload.workspace.nodes, []);
      }
    );

    const ledger = await repository.getEfficiencyLedger();
    assert.equal(ledger.agenticRunsCount, 2);
    assert.equal(ledger.actualTokensUsed, 540);
  });

  test("enforces 405 method guard, 400 query/body validation, 503 missing client, and 500 corrupt storage at 0 tokens", async () => {
    const repository = await seedFilingPlannerRepository();
    const { geminiClient, recordedRequests } = createPlannerClientStub(
      async () => ({
        id: "ix_unused",
        status: "completed",
        output_text: JSON.stringify({ nodes: [] }),
      })
    );

    await withGridlockTestServer(
      { repository, geminiClient, now: () => NOW },
      async (baseUrl) => {
        const getRes = await fetch(`${baseUrl}/api/investigate/plan`);
        assert.equal(getRes.status, 405);
        assert.equal(getRes.headers.get("allow"), "POST");
        assert.equal(
          ((await getRes.json()) as { error: string }).error,
          "method_not_allowed"
        );

        await assertInvestigateErrorResponse(
          postInvestigatePlan(
            `${baseUrl}/api/investigate/plan?foo=bar`,
            '{"query":"ok"}'
          ),
          400,
          "invalid_query_parameters"
        );
        await assertInvestigateErrorResponse(
          postInvestigatePlan(
            `${baseUrl}/api/investigate/plan?a=1&a=2`,
            '{"query":"ok"}'
          ),
          400,
          "invalid_query_parameters"
        );

        const invalidBodies = [
          "",
          "[]",
          "42",
          "{malformed",
          JSON.stringify({ query: "   " }),
          JSON.stringify({
            query: "q".repeat(MAX_INVESTIGATE_QUERY_LENGTH + 1),
          }),
          JSON.stringify({ query: "valid", extraField: true }),
        ];
        for (const rawBody of invalidBodies) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(`${baseUrl}/api/investigate/plan`, rawBody),
            400,
            "invalid_request_body"
          );
        }
      }
    );

    await withGridlockTestServer(
      { repository, now: () => NOW },
      async (baseUrl) => {
        await assertInvestigateErrorResponse(
          postInvestigatePlan(
            `${baseUrl}/api/investigate/plan`,
            '{"query":"Ellis"}'
          ),
          503,
          "planner_unavailable"
        );
      }
    );

    const corruptRepo: GridlockRepository = {
      ...repository,
      listProjects: async () => [{ invalid: true }] as never,
    };
    await withGridlockTestServer(
      { repository: corruptRepo, geminiClient, now: () => NOW },
      async (baseUrl) => {
        await assertInvestigateErrorResponse(
          postInvestigatePlan(
            `${baseUrl}/api/investigate/plan`,
            '{"query":"Ellis"}'
          ),
          500,
          "investigate_plan_error"
        );
      }
    );

    assert.equal(recordedRequests.length, 0);
    assert.equal((await repository.listTelemetryRuns()).length, 0);
  });

  test("maps upstream/structural AI errors to 502 and unresolvable entities to 422 with agentic_failed telemetry", async () => {
    const repository = await seedFilingPlannerRepository();
    const oversizedNodes = Array.from(
      { length: MAX_WORKSPACE_NODES + 1 },
      (_, idx) => ({
        nodeId: `card-${idx}`,
        component: "ProjectDossierCard",
        projectNumber: "TABS2027001001",
      })
    );

    const upstreamSteps: Array<() => Promise<GeminiInteractionResponse>> = [
      async () => {
        throw new Error("Gemini network reset");
      },
      async () => ({
        id: "ix_non_completed",
        status: "failed",
        errors: [{ code: "UNAVAILABLE", message: "Capacity exhausted" }],
        usage: { total_tokens: 40 },
      }),
      async () => ({
        id: "   ",
        status: "completed",
        output_text: '{"nodes":[]}',
        usage: { total_tokens: 45 },
      }),
      async () => ({
        id: "ix_empty_text",
        status: "completed",
        output_text: "   ",
        usage: { total_tokens: 48 },
      }),
      async () => ({
        id: "ix_malformed_json",
        status: "completed",
        output_text: "{bad-json",
        usage: { total_tokens: 50 },
      }),
      async () => ({
        id: "ix_unknown_comp",
        status: "completed",
        output_text: JSON.stringify({
          nodes: [{ nodeId: "n1", component: "BogusCard" }],
        }),
        usage: { total_tokens: 55 },
      }),
      async () => ({
        id: "ix_dup_node",
        status: "completed",
        output_text: JSON.stringify({
          nodes: [
            {
              nodeId: "dup",
              component: "ProjectDossierCard",
              projectNumber: "TABS2027001001",
            },
            {
              nodeId: "dup",
              component: "ProjectDossierCard",
              projectNumber: "TABS2027001002",
            },
          ],
        }),
        usage: { total_tokens: 60 },
      }),
      async () => ({
        id: "ix_too_many_nodes",
        status: "completed",
        output_text: JSON.stringify({ nodes: oversizedNodes }),
        usage: { total_tokens: 65 },
      }),
    ];

    const unresolvableNumbers = [
      "TABS9999999999",
      "TABS2027001003",
      "TABS2027001004",
    ];
    const allHandlers = [
      ...upstreamSteps,
      ...unresolvableNumbers.map((projectNumber, idx) => async () => ({
        id: `ix_unresolvable_${idx}`,
        status: "completed" as const,
        output_text: JSON.stringify({
          nodes: [
            {
              nodeId: `unresolvable-${idx}`,
              component: "ProjectDossierCard",
              projectNumber,
            },
          ],
        }),
        usage: { total_tokens: 80 + idx * 5 },
      })),
    ];

    let stepIndex = 0;
    const { geminiClient } = createPlannerClientStub(async () => {
      const next = allHandlers[stepIndex]!;
      stepIndex += 1;
      return next();
    });

    await withGridlockTestServer(
      { repository, geminiClient, now: () => NOW },
      async (baseUrl) => {
        for (let i = 0; i < upstreamSteps.length; i += 1) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(
              `${baseUrl}/api/investigate/plan`,
              '{"query":"Ellis"}'
            ),
            502,
            "planner_upstream_error"
          );
        }
        for (let i = 0; i < unresolvableNumbers.length; i += 1) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(
              `${baseUrl}/api/investigate/plan`,
              '{"query":"Ellis"}'
            ),
            422,
            "planner_unresolvable_plan"
          );
        }
      }
    );

    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, upstreamSteps.length + unresolvableNumbers.length);
    assert.equal(
      runs.every(
        (run) =>
          run.stage === "investigation_planner" &&
          run.status === "agentic_failed"
      ),
      true
    );
    assert.deepEqual(
      runs.map((run) => run.tokensUsed),
      [0, 40, 45, 48, 50, 55, 60, 65, 80, 85, 90]
    );
  });
});

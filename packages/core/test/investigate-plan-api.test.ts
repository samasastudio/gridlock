import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import {
  DEFAULT_LINEAGE_ID,
  InvestigatePlanResponseSchema,
  MAX_INVESTIGATE_BODY_BYTES,
  MAX_INVESTIGATE_QUERY_LENGTH,
  MAX_WORKSPACE_NODES,
  type GeminiInteractionResponse,
  type GridlockRepository,
  type RunSpan,
} from "../src/index.ts";
import {
  assertInvestigateErrorResponse,
  createFiveCardLayoutSpec,
  createOrchestrationClientStub,
  createOrchestrationObservation,
  createQueuedLayoutClientStub,
  HASH_ACTIVE_A,
  postInvestigatePlan,
  seedFilingOrchestrationRepository,
  seedFiveCardOrchestrationRepository,
  singleNodeLayout,
  streamOversizedJsonPost,
  withGridlockTestServer,
} from "./helpers/orchestration-test-helpers.ts";

const NOW = new Date("2026-10-28T16:00:00.000Z");

describe("POST /api/investigate/plan HTTP Seam", () => {
  test("returns 200 for multi-card and empty workspaces, CORS headers, and 204 on OPTIONS", async () => {
    const repository = await seedFilingOrchestrationRepository();
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

    const scorecard = await repository.getEfficiencyScorecard();
    assert.equal(scorecard.agenticRunsCount, 2);
    assert.equal(scorecard.actualTokensUsed, 540);
  });

  test("enforces 405 method guard, 400 query/body validation, 503 missing client, and 500 corrupt storage at 0 tokens", async () => {
    const repository = await seedFilingOrchestrationRepository();
    const { geminiClient, recordedRequests } = createOrchestrationClientStub(
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
          "orchestration_unavailable"
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
    assert.equal((await repository.listRunRecords()).length, 0);
  });

  test("maps upstream/structural AI errors to 502 and unresolvable entities to 422 with agentic_failed run records", async () => {
    const repository = await seedFilingOrchestrationRepository();
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
    const { geminiClient } = createOrchestrationClientStub(async () => {
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
            "orchestration_upstream_error"
          );
        }
        for (let i = 0; i < unresolvableNumbers.length; i += 1) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(
              `${baseUrl}/api/investigate/plan`,
              '{"query":"Ellis"}'
            ),
            422,
            "orchestration_unresolvable_layout"
          );
        }
      }
    );

    const runs = await repository.listRunRecords();
    assert.equal(runs.length, upstreamSteps.length + unresolvableNumbers.length);
    assert.equal(
      runs.every(
        (run) =>
          run.stage === "ui_orchestration_agent" &&
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

describe("POST /api/investigate/plan Cross-Seam Grounding", () => {
  test("returns 200 for mixed 5-card workspace and maps cross-seam 422 and 502 errors", async () => {
    const { repository, branchPlateId } =
      await seedFiveCardOrchestrationRepository();
    const { geminiClient } = createQueuedLayoutClientStub(
      [
        createFiveCardLayoutSpec(branchPlateId),
        singleNodeLayout({
          nodeId: "scrubber-missing-lineage",
          component: "VisualPlateScrubber",
          lineageId: "fabricated-lineage",
        }),
        singleNodeLayout({
          nodeId: "scrubber-unknown-plate",
          component: "VisualPlateScrubber",
          lineageId: DEFAULT_LINEAGE_ID,
          initialPlateId: "plate_unknown_999",
        }),
        singleNodeLayout({
          nodeId: "scrubber-expired-plate",
          component: "VisualPlateScrubber",
          lineageId: DEFAULT_LINEAGE_ID,
          initialPlateId: "plate_expired_branch",
        }),
        singleNodeLayout({
          nodeId: "scrubber-quarantined",
          component: "VisualPlateScrubber",
          lineageId: "quarantined-lineage",
        }),
        singleNodeLayout({
          nodeId: "connector-missing",
          component: "ConnectorHealthCard",
          connectorId: "unknown-connector",
        }),
        singleNodeLayout({
          nodeId: "scrubber-bad-id",
          component: "VisualPlateScrubber",
          lineageId: "../bad/id",
        }),
        singleNodeLayout({
          nodeId: "connector-bad-id",
          component: "ConnectorHealthCard",
          connectorId: "../bad/id",
        }),
      ],
      { idPrefix: "ix_cross_seam", baseTokens: 200, tokenStep: 10 }
    );

    await withGridlockTestServer(
      { repository, geminiClient, now: () => NOW },
      async (baseUrl) => {
        const okRes = await postInvestigatePlan(
          `${baseUrl}/api/investigate/plan`,
          JSON.stringify({ query: "Show full Ellis investigation workspace" })
        );
        assert.equal(okRes.status, 200);
        const okPayload = InvestigatePlanResponseSchema.parse(await okRes.json());
        assert.equal(okPayload.workspace.nodes.length, 5);
        const scrubberNode = okPayload.workspace.nodes.find(
          (node) => node.component === "VisualPlateScrubber"
        );
        assert.equal(scrubberNode?.component, "VisualPlateScrubber");
        if (scrubberNode?.component === "VisualPlateScrubber") {
          assert.equal(scrubberNode.initialPlateId, branchPlateId);
          const frameIds = scrubberNode.lineage.nodes.map((n) => n.plate.plateId);
          assert.equal(frameIds.length, 2);
          assert.equal(frameIds.includes(branchPlateId), true);
          assert.equal(frameIds.includes("plate_expired_branch"), false);
        }

        for (let i = 0; i < 5; i += 1) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(
              `${baseUrl}/api/investigate/plan`,
              '{"query":"Ellis"}'
            ),
            422,
            "orchestration_unresolvable_layout"
          );
        }

        for (let i = 0; i < 2; i += 1) {
          await assertInvestigateErrorResponse(
            postInvestigatePlan(
              `${baseUrl}/api/investigate/plan`,
              '{"query":"Ellis"}'
            ),
            502,
            "orchestration_upstream_error"
          );
        }
      }
    );
  });
});

describe("POST /api/investigate/plan Refinement & 128 KiB Body Cap", () => {
  test("accepts 20-60 KiB currentLayout refinement payloads with hasCurrentLayout span attributes", async () => {
    assert.equal(MAX_INVESTIGATE_BODY_BYTES, 131_072);
    const { repository, canonicalArtifactHash, branchPlateId } =
      await seedFiveCardOrchestrationRepository();
    for (let idx = 0; idx < 40; idx += 1) {
      await repository.appendObservation(
        createOrchestrationObservation(
          `obs_1001_bulk_${idx}`,
          "TABS2027001001",
          canonicalArtifactHash,
          {
            observedAt: `2026-10-28T12:${String(idx).padStart(2, "0")}:00.000Z`,
            status: "Inspection Logged",
            scopeOfWork: `Structural steel and switchgear inspection sequence ${idx} for Red Oak corridor campus expansion hall`,
            isMilestone: false,
          }
        )
      );
    }

    const spans: RunSpan[] = [];
    const { geminiClient } = createQueuedLayoutClientStub(
      [
        createFiveCardLayoutSpec(branchPlateId),
        {
          nodes: [
            {
              nodeId: "scrubber-corridor",
              component: "VisualPlateScrubber",
              lineageId: DEFAULT_LINEAGE_ID,
              initialPlateId: branchPlateId,
            },
            {
              nodeId: "dossier-1002",
              component: "ProjectDossierCard",
              projectNumber: "TABS2027001002",
            },
          ],
        },
      ],
      { idPrefix: "ix_http_refine", baseTokens: 300, tokenStep: 10 }
    );

    await withGridlockTestServer(
      {
        repository,
        geminiClient,
        spanSink: (span) => spans.push(span),
        now: () => NOW,
      },
      async (baseUrl) => {
        const initialRes = await postInvestigatePlan(
          `${baseUrl}/api/investigate/plan`,
          JSON.stringify({ query: "Assemble Ellis workspace" })
        );
        assert.equal(initialRes.status, 200);
        const initialPayload = InvestigatePlanResponseSchema.parse(
          await initialRes.json()
        );

        const refineBody = JSON.stringify({
          query: "Keep corridor plate and switch dossier to TABS2027001002",
          currentLayout: initialPayload.workspace,
        });
        const refineBytes = Buffer.byteLength(refineBody, "utf-8");
        assert.equal(refineBytes > 20 * 1024 && refineBytes < 60 * 1024, true);

        const refineRes = await postInvestigatePlan(
          `${baseUrl}/api/investigate/plan`,
          refineBody
        );
        assert.equal(refineRes.status, 200);
        const refinePayload = InvestigatePlanResponseSchema.parse(
          await refineRes.json()
        );
        assert.deepEqual(
          refinePayload.workspace.nodes.map((node) => node.nodeId),
          ["scrubber-corridor", "dossier-1002"]
        );
      }
    );

    assert.equal(spans.length, 2);
    assert.equal(spans[0]?.attributes?.hasCurrentLayout, false);
    assert.equal(spans[1]?.attributes?.hasCurrentLayout, true);
  });

  test("enforces 131072-byte streaming cutoff on /api/investigate/plan and preserves 16384-byte cutoff on /api/illustrations/branch", async () => {
    const repository = await seedFilingOrchestrationRepository();
    const { geminiClient, recordedRequests } = createOrchestrationClientStub(
      async () => ({
        id: "ix_unreachable_stream",
        status: "completed",
        output_text: '{"nodes":[]}',
      })
    );

    await withGridlockTestServer(
      { repository, geminiClient, now: () => NOW },
      async (baseUrl) => {
        const investigateOutcome = await streamOversizedJsonPost(
          baseUrl,
          "/api/investigate/plan",
          32_768,
          8
        );
        assert.equal(investigateOutcome.status, 400);
        assert.equal(investigateOutcome.connection, "close");
        assert.equal(investigateOutcome.error, "request_body_too_large");
        assert.equal(
          investigateOutcome.message,
          "Request body exceeds 131072-byte limit"
        );

        const branchOutcome = await streamOversizedJsonPost(
          baseUrl,
          "/api/illustrations/branch",
          16_384,
          2
        );
        assert.equal(branchOutcome.status, 400);
        assert.equal(branchOutcome.connection, "close");
        assert.equal(branchOutcome.error, "request_body_too_large");
        assert.equal(
          branchOutcome.message,
          "Request body exceeds 16384-byte limit"
        );
      }
    );

    assert.equal(recordedRequests.length, 0);
    assert.equal((await repository.listRunRecords()).length, 0);
  });
});

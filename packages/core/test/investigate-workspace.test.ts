import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  hydrateInvestigationWorkspace,
  ingestTdlrFiling,
  InvestigatePlanRequestSchema,
  InvestigatePlanResponseSchema,
  MAX_WORKSPACE_NODES,
  UiWorkspaceAstSchema,
} from "../src/index.ts";
import { FROZEN_TABS_2027003697_HTML } from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");

describe("UI AST Contracts & Deterministic Workspace Hydrator — Phase 1", () => {
  test("hydrates ProjectDossierCard from ingested TDLR filing and round-trips InvestigatePlan envelopes", async () => {
    const repository = createInMemoryGridlockRepository();
    const ingestResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl: "https://www.tdlr.texas.gov",
        now: NOW,
        robotsTxt: "User-agent: *\nAllow: /\n",
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
    assert.equal(ingestResult.status, "ingested");

    const expectedSha256 = createHash("sha256")
      .update(Buffer.from(FROZEN_TABS_2027003697_HTML, "utf-8"))
      .digest("hex");

    const result = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "dossier-dfw-bldg10",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027003697",
          },
        ],
      },
      { repository },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    assert.equal(result.workspace.version, 1);
    assert.equal(result.workspace.generatedAt, NOW.toISOString());
    assert.equal(result.workspace.isEmpty, false);
    assert.equal(result.workspace.nodes.length, 1);

    const [node] = result.workspace.nodes;
    assert.ok(node);
    assert.equal(node.component, "ProjectDossierCard");
    assert.equal(node.citedProject.project.estimatedCostUsd, 100_000_000);
    assert.equal(node.citedProject.project.squareFootage, 251_815);
    assert.equal(
      node.citedProject.project.latestSourceArtifactHash,
      expectedSha256
    );
    assert.equal(node.citedProject.citation.sha256, expectedSha256);
    assert.equal(
      node.citedProject.citation.sourceUrl,
      "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697"
    );

    const planReq = InvestigatePlanRequestSchema.parse({
      query: "  Show me the Compass Red Oak Building 10 filing  ",
      currentAst: result.workspace,
    });
    assert.equal(
      planReq.query,
      "Show me the Compass Red Oak Building 10 filing"
    );

    const planRes = InvestigatePlanResponseSchema.parse({
      workspace: result.workspace,
      interactionId: "ix_planner_turn_1",
      tokensUsed: 412,
    });
    assert.deepEqual(
      UiWorkspaceAstSchema.parse(planRes.workspace),
      result.workspace
    );
  });

  test("hydrates empty PlannerLayoutSpec without invoking repository lookups", async () => {
    const unexpectedCall = async (): Promise<never> => {
      throw new Error("Unexpected repository lookup on empty PlannerLayoutSpec");
    };
    const result = await hydrateInvestigationWorkspace(
      { nodes: [] },
      {
        repository: {
          getProjectByNumber: unexpectedCall,
          getSourceArtifactByHash: unexpectedCall,
          listObservationsByProject: unexpectedCall,
          listVisualPlatesByLineage: unexpectedCall,
          getActiveConnectorConfig: unexpectedCall,
          listRepairChangelog: unexpectedCall,
          getEfficiencyLedger: unexpectedCall,
        },
      },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    assert.equal(result.workspace.isEmpty, true);
    assert.deepEqual(result.workspace.nodes, []);
  });

  test("fails closed with invalid_layout_spec on unknown components, >6 nodes, duplicate nodeIds, and extra keys", async () => {
    const repository = createInMemoryGridlockRepository();
    const invalidSpecs: unknown[] = [
      {
        nodes: [
          {
            nodeId: "bad-1",
            component: "HallucinatedChart",
            projectNumber: "TABS2027003697",
          },
        ],
      },
      {
        nodes: Array.from({ length: MAX_WORKSPACE_NODES + 1 }, (_, idx) => ({
          nodeId: `node-${idx}`,
          component: "ProjectDossierCard",
          projectNumber: "TABS2027003697",
        })),
      },
      {
        nodes: [
          {
            nodeId: "dup-id",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027003697",
          },
          {
            nodeId: "dup-id",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027001111",
          },
        ],
      },
      {
        nodes: [
          {
            nodeId: "extra-key-node",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027003697",
            hallucinatedSummary: "Invented prose",
          },
        ],
      },
    ];

    for (const invalidSpec of invalidSpecs) {
      const res = await hydrateInvestigationWorkspace(invalidSpec, {
        repository,
      });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_layout_spec");
    }
  });
});

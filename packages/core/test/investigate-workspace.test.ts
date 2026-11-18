import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  hydrateInvestigationWorkspace,
  MAX_WORKSPACE_NODES,
} from "../src/index.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");

describe("UI AST Contracts & Deterministic Workspace Hydrator — Phase 1", () => {
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

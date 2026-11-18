import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bootstrapCanvas,
  branchLineage,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  hydrateInvestigationWorkspace,
  ingestTdlrFiling,
  MAX_SCENARIO_PROMPT_LENGTH,
  UiWorkspaceAstSchema,
  VisualPlateScrubberNodeSchema,
  type GeminiInteractionsClient,
  type GridlockRepository,
} from "../src/index.ts";
import {
  createFixtureWebpBuffer,
  FROZEN_TABS_2027003697_HTML,
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

async function seedLineageRepository(): Promise<{
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

  const dfwObservations =
    await repository.listObservationsByProject("TABS2027003697");
  const geminiClient = createPainterClientStub();

  const bootstrapRes = await bootstrapCanvas(
    {
      lineageId: DEFAULT_LINEAGE_ID,
      observations: dfwObservations,
      prompt:
        "Bootstrap <svg>\ncanvas for [corridor](https://example.test) contact grid_ops@example.com",
      now: new Date("2026-10-27T15:00:00.000Z"),
    },
    { repository, geminiClient }
  );
  assert.equal(bootstrapRes.status, "plate_painted");

  const branchRes = await branchLineage(
    {
      lineageId: DEFAULT_LINEAGE_ID,
      parentInteractionId: bootstrapRes.plate.interactionId,
      scenarioPrompt:
        "Add *300MW* switchyard\nfor planner_lead@example.com <marquee>",
      now: new Date("2026-10-27T15:10:00.000Z"),
    },
    { repository, geminiClient }
  );
  assert.equal(branchRes.status, "plate_painted");

  return {
    repository,
    canonicalPlateId: bootstrapRes.plate.plateId,
    branchPlateId: branchRes.plate.plateId,
  };
}

describe("UI AST Contracts & Deterministic Workspace Hydrator — Phase 3", () => {
  test("hydrates VisualPlateScrubber with escaped prompts and safely bounds 1,000-character scenarioPrompt", async () => {
    const { repository, canonicalPlateId, branchPlateId } =
      await seedLineageRepository();

    const result = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "corridor-scrubber",
            component: "VisualPlateScrubber",
            lineageId: DEFAULT_LINEAGE_ID,
            initialPlateId: branchPlateId,
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

    const scrubberNode = result.workspace.nodes[0];
    assert.ok(scrubberNode && scrubberNode.component === "VisualPlateScrubber");
    assert.deepEqual(
      VisualPlateScrubberNodeSchema.parse(scrubberNode),
      scrubberNode
    );
    assert.equal(scrubberNode.initialPlateId, branchPlateId);
    assert.equal(
      scrubberNode.lineage.activeCanonicalPlateId,
      canonicalPlateId
    );
    assert.equal(scrubberNode.lineage.nodes.length, 2);

    const [canonicalNode, branchedNode] = scrubberNode.lineage.nodes;
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
      "Add *300MW* <svg> switchyard for planner_lead@example.com ";
    const maxScenarioPrompt =
      maxPromptPrefix +
      "*".repeat(MAX_SCENARIO_PROMPT_LENGTH - maxPromptPrefix.length);
    assert.equal(maxScenarioPrompt.length, MAX_SCENARIO_PROMPT_LENGTH);

    const maxBranchRes = await branchLineage(
      {
        lineageId: DEFAULT_LINEAGE_ID,
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
    assert.equal(maxBranchRes.status, "plate_painted");

    const maxScrubberRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "max-prompt-scrubber",
            component: "VisualPlateScrubber",
            lineageId: DEFAULT_LINEAGE_ID,
            initialPlateId: maxBranchRes.plate.plateId,
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(maxScrubberRes.ok, true);
    const maxScrubberNode = maxScrubberRes.workspace.nodes[0];
    assert.ok(
      maxScrubberNode && maxScrubberNode.component === "VisualPlateScrubber"
    );
    const hydratedMaxBranch = maxScrubberNode.lineage.nodes.find(
      (n) => n.plate.plateId === maxBranchRes.plate.plateId
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
  });
});

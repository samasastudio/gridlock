import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  createInMemoryGridlockRepository,
  hydrateInvestigationWorkspace,
  ingestTdlrFiling,
  InvestigatePlanRequestSchema,
  InvestigatePlanResponseSchema,
  MAX_WORKSPACE_NODES,
  WorkspaceLayoutSchema,
} from "../src/index.ts";
import {
  createTestProject,
  createTestRawCapture,
  FROZEN_TABS_2027003697_HTML,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";

const NOW = new Date("2026-10-28T15:00:00.000Z");

describe("Workspace Layout Contracts & Deterministic Workspace Hydrator — Phase 1", () => {
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
      node.citedProject.project.latestRawCaptureHash,
      expectedSha256
    );
    assert.equal(node.citedProject.citation.sha256, expectedSha256);
    assert.equal(
      node.citedProject.citation.sourceUrl,
      "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697"
    );

    const planReq = InvestigatePlanRequestSchema.parse({
      query: "  Show me the Compass Red Oak Building 10 filing  ",
      currentLayout: result.workspace,
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
      WorkspaceLayoutSchema.parse(planRes.workspace),
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
          getRawCaptureByHash: unexpectedCall,
          listObservationsByProject: unexpectedCall,
          listVisualPlatesByLineage: unexpectedCall,
          getActiveConnectorConfig: unexpectedCall,
          listRepairChangelog: unexpectedCall,
          getEfficiencyScorecard: unexpectedCall,
        },
      },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    assert.equal(result.workspace.isEmpty, true);
    assert.deepEqual(result.workspace.nodes, []);
  });

  test("escapes HTML and CommonMark metacharacters while keeping canonical PII placeholders intact and blocking forged placeholder links", async () => {
    const repository = createInMemoryGridlockRepository();
    const sha256 = "b".repeat(64);

    await repository.saveRawCapture(
      createTestRawCapture(sha256, "TABS2027004242"),
      GZIP_HTML_STUB
    );

    await repository.upsertProject(
      createTestProject("TABS2027004242", sha256, {
        projectName: "Campus <script>alert(1)</script>\n  Phase *Alpha*",
        facilityName: "Hall `One` {West}",
        ownerName: "Contact jane_doe@example.com (Owner) or (512) 555-0199",
        designFirmName: "Studio ~Delta~",
        locationAddress: "1200 Elm St Apt 4B, Austin, TX 78701",
        county: "Travis",
        estimatedCostUsd: 45_000_000,
        squareFootage: 90_000,
        typeOfWork:
          "Forged [REDACTED_EMAIL](https://bad.example), [REDACTED_EMAIL][ref], and ![REDACTED_ADDRESS](https://bad.example/beacon.png)",
        scopeOfWork:
          "See [injected](https://bad.example)\nand email jane_doe@example.com",
        currentStatus:
          "Synthesized !jane_doe@example.com(https://bad.example/p.png) [REDACTED_PHONE]: https://bad.example",
      })
    );

    const result = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "sanitized-dossier",
            component: "ProjectDossierCard",
            projectNumber: "TABS2027004242",
          },
        ],
      },
      { repository },
      { now: NOW }
    );

    assert.equal(result.ok, true);
    const firstNode = result.workspace.nodes[0];
    assert.ok(firstNode);
    assert.equal(firstNode.component, "ProjectDossierCard");
    const project = firstNode.citedProject.project;
    assert.equal(
      project.projectName,
      "Campus \\<script\\>alert(1)\\</script\\> Phase \\*Alpha\\*"
    );
    assert.equal(project.facilityName, "Hall \\`One\\` \\{West\\}");
    assert.equal(
      project.ownerName,
      "Contact [REDACTED_EMAIL] (Owner) or [REDACTED_PHONE]"
    );
    assert.equal(project.designFirmName, "Studio \\~Delta\\~");
    assert.equal(project.locationAddress, "[REDACTED_ADDRESS], Austin, TX 78701");
    assert.equal(
      project.typeOfWork,
      "Forged \\[REDACTED_EMAIL\\](https://bad.example), \\[REDACTED_EMAIL\\]\\[ref\\], and !\\[REDACTED_ADDRESS\\](https://bad.example/beacon.png)"
    );
    assert.equal(
      project.scopeOfWork,
      "See \\[injected\\](https://bad.example) and email [REDACTED_EMAIL]"
    );
    assert.equal(
      project.currentStatus,
      "Synthesized !\\[REDACTED_EMAIL\\](https://bad.example/p.png) \\[REDACTED_PHONE\\]: https://bad.example"
    );
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

  test("fails closed on missing Project, invalid or quarantined Raw Capture provenance, and corrupted storage", async () => {
    const repository = createInMemoryGridlockRepository();
    const missingProjectRes = await hydrateInvestigationWorkspace(
      {
        nodes: [
          {
            nodeId: "missing-proj",
            component: "ProjectDossierCard",
            projectNumber: "TABS2099000001",
          },
        ],
      },
      { repository },
      { now: NOW }
    );
    assert.equal(missingProjectRes.ok, false);
    assert.equal(missingProjectRes.error, "entity_not_found");

    const baseHash = "c".repeat(64);
    const baseProject = createTestProject("TABS2027008888", baseHash);
    await repository.upsertProject(baseProject);

    const spec = {
      nodes: [
        {
          nodeId: "prov-check",
          component: "ProjectDossierCard",
          projectNumber: "TABS2027008888",
        },
      ],
    };

    const missingArtRes = await hydrateInvestigationWorkspace(
      spec,
      { repository },
      { now: NOW }
    );
    assert.equal(missingArtRes.ok, false);
    assert.equal(missingArtRes.error, "unresolvable_provenance");

    const provenanceFailureArtifacts = [
      {
        storageUri: `${ARTIFACT_BUCKET_URI}/quarantine/${baseHash}.gz`,
        sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027008888",
        expiresAt: null,
      },
      {
        storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${baseHash}.gz`,
        sourceUrl: "ftp://files.tdlr.texas.gov/TABS2027008888.html",
        expiresAt: null,
      },
      {
        storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${baseHash}.gz`,
        sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027008888",
        expiresAt: "2026-10-28T15:00:00.000Z",
      },
    ];

    for (const override of provenanceFailureArtifacts) {
      const artifact = createTestRawCapture(baseHash, "TABS2027008888", {
        sourceUrl: override.sourceUrl,
        storageUri: override.storageUri,
        expiresAt: override.expiresAt,
        referencedByMilestone: false,
      });
      const stubRes = await hydrateInvestigationWorkspace(
        spec,
        {
          repository: {
            ...repository,
            getProjectByNumber: async () => baseProject,
            getRawCaptureByHash: async () => artifact,
          },
        },
        { now: NOW }
      );
      assert.equal(stubRes.ok, false);
      assert.equal(stubRes.error, "unresolvable_provenance");
    }

    for (const badProject of [
      { ...baseProject, projectNumber: "TABS2027009999" },
      { projectNumber: "TABS2027008888", estimatedCostUsd: -50 },
    ]) {
      const corruptRes = await hydrateInvestigationWorkspace(
        spec,
        {
          repository: {
            ...repository,
            getProjectByNumber: async () =>
              badProject as unknown as typeof baseProject,
            getRawCaptureByHash: async () => null,
          },
        },
        { now: NOW }
      );
      assert.equal(corruptRes.ok, false);
      assert.equal(corruptRes.error, "repository_integrity_error");
    }

    for (const badArtifact of [
      createTestRawCapture("d".repeat(64), "TABS2027008888"),
      { sha256: baseHash, rawByteLength: -1 },
    ]) {
      const corruptArtifactRes = await hydrateInvestigationWorkspace(
        spec,
        {
          repository: {
            ...repository,
            getProjectByNumber: async () => baseProject,
            getRawCaptureByHash: async () => badArtifact as never,
          },
        },
        { now: NOW }
      );
      assert.equal(corruptArtifactRes.ok, false);
      assert.equal(corruptArtifactRes.error, "repository_integrity_error");
    }
  });
});

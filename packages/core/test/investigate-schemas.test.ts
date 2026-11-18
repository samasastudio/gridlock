import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  DEFAULT_LINEAGE_ID,
  ProjectSchema,
  UiAstComponentTypeSchema,
  UiWidgetNodeSchema,
  UiWorkspaceAstSchema,
} from "../src/index.ts";
import { createPainterTestObservations } from "./helpers/fixtures.ts";

const NOW_ISO = "2026-10-28T15:00:00.000Z";

describe("UI AST & Planner Zod Contracts", () => {
  test("validates UiAstComponentTypeSchema, UiWidgetNodeSchema cross-field invariants, and UiWorkspaceAstSchema", () => {
    assert.deepEqual(UiAstComponentTypeSchema.options, [
      "ProjectDossierCard",
      "VisualPlateScrubber",
      "ObservationTimeline",
      "MetricComparisonTable",
      "ConnectorHealthCard",
    ]);
    assert.equal(
      UiAstComponentTypeSchema.safeParse("ProjectDossierCard").success,
      true
    );
    assert.equal(
      UiAstComponentTypeSchema.safeParse("HallucinatedChart").success,
      false
    );

    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const projectA = ProjectSchema.parse({
      projectNumber: "TABS2027003697",
      projectName: "Compass Building 10",
      facilityName: "Hall 10",
      ownerName: "Compass Datacenters LLC",
      locationAddress: "590 Austin Blvd, Red Oak, TX 75154",
      county: "Ellis",
      estimatedCostUsd: 100_000_000,
      squareFootage: 251_815,
      typeOfWork: "New Construction",
      scopeOfWork: "Construct hyperscale data hall shell",
      currentStatus: "Project Registered",
      startDate: "2026-11-01",
      completionDate: "2028-06-01",
      latestSourceArtifactHash: hashA,
      updatedAt: "2026-10-27T14:05:00.000Z",
    });
    const citationA = {
      sha256: hashA,
      sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697",
      connectorId: "tdlr-tabs",
      capturedAt: "2026-10-27T14:05:00.000Z",
      referencedByMilestone: true,
    };
    const { milestoneObs } = createPainterTestObservations();

    const validDossierNode = {
      nodeId: "valid-dossier",
      component: "ProjectDossierCard" as const,
      citedProject: { project: projectA, citation: citationA },
    };
    assert.equal(UiWidgetNodeSchema.safeParse(validDossierNode).success, true);

    const validLineageNode = {
      plate: {
        plateId: "plate_canonical_1",
        lineageId: DEFAULT_LINEAGE_ID,
        turnNumber: 1,
        model: "gemini-3-pro-image",
        interactionId: "ix_canonical_1",
        parentInteractionId: null,
        parentPlateId: null,
        projectNumbers: ["TABS2027003697"],
        triggeringObservationIds: [milestoneObs.id],
        sourceArtifactHashes: [hashA],
        prompt: "Corridor baseline",
        storageUri: `${ARTIFACT_BUCKET_URI}/plates/plate_canonical_1.webp`,
        mimeType: "image/webp" as const,
        byteLength: 512,
        sha256: hashA,
        isBranch: false,
        epistemicLabel: CANONICAL_MILESTONE_LABEL,
        watermarkText: null,
        createdAt: "2026-10-27T15:00:00.000Z",
        expiresAt: null,
      },
      assetPath: "/api/plates/assets/plate_canonical_1.webp",
      triggeringObservations: [milestoneObs],
      sourceArtifacts: [citationA],
    };

    const validScrubberNode = {
      nodeId: "valid-scrubber",
      component: "VisualPlateScrubber" as const,
      initialPlateId: "plate_canonical_1",
      lineage: {
        lineageId: DEFAULT_LINEAGE_ID,
        activeCanonicalPlateId: "plate_canonical_1",
        nodes: [validLineageNode],
        edges: [],
      },
    };
    assert.equal(UiWidgetNodeSchema.safeParse(validScrubberNode).success, true);

    const invalidCases: ReadonlyArray<{ node: unknown; expectedPath: string }> =
      [
        {
          node: { nodeId: "unknown-widget", component: "HallucinatedChart" },
          expectedPath: "component",
        },
        {
          node: {
            nodeId: "mismatched-project-citation",
            component: "ProjectDossierCard",
            citedProject: {
              project: projectA,
              citation: { ...citationA, sha256: hashB },
            },
          },
          expectedPath: "citedProject.citation.sha256",
        },
        {
          node: {
            nodeId: "out-of-scope-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027001111"],
            observations: [{ observation: milestoneObs, citation: citationA }],
          },
          expectedPath: "observations",
        },
        {
          node: {
            nodeId: "duplicate-obs-timeline",
            component: "ObservationTimeline",
            projectNumbers: ["TABS2027003697"],
            observations: [
              { observation: milestoneObs, citation: citationA },
              { observation: milestoneObs, citation: citationA },
            ],
          },
          expectedPath: "observations",
        },
        {
          node: {
            ...validScrubberNode,
            nodeId: "invalid-initial-plate",
            initialPlateId: "plate_absent_id",
          },
          expectedPath: "initialPlateId",
        },
        {
          node: {
            ...validScrubberNode,
            nodeId: "zero-citation-scrubber",
            lineage: {
              ...validScrubberNode.lineage,
              nodes: [
                {
                  ...validLineageNode,
                  plate: { ...validLineageNode.plate, sourceArtifactHashes: [] },
                  sourceArtifacts: [],
                },
              ],
            },
          },
          expectedPath: "lineage.nodes",
        },
      ];

    for (const { node, expectedPath } of invalidCases) {
      const parsed = UiWidgetNodeSchema.safeParse(node);
      assert.equal(parsed.success, false);
      assert.ok(
        parsed.error.issues.some((issue) => issue.path.join(".") === expectedPath)
      );
    }

    const emptyWorkspace = UiWorkspaceAstSchema.parse({
      version: 1,
      generatedAt: NOW_ISO,
      isEmpty: true,
      nodes: [],
    });
    assert.equal(
      UiWorkspaceAstSchema.safeParse({ ...emptyWorkspace, isEmpty: false })
        .success,
      false
    );
    assert.equal(
      UiWorkspaceAstSchema.safeParse({
        version: 1,
        generatedAt: NOW_ISO,
        isEmpty: false,
        nodes: [validDossierNode, validDossierNode],
      }).success,
      false
    );
  });
});

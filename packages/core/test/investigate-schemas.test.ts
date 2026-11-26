import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  DEFAULT_TIMELINE_ID,
  InvestigatePlanRequestSchema,
  InvestigatePlanResponseSchema,
  MAX_INVESTIGATE_QUERY_LENGTH,
  ProjectSchema,
  WorkspaceCardNodeSchema,
  WorkspaceCardTypeSchema,
  WorkspaceLayoutSchema,
} from "../src/index.ts";
import { createPainterTestObservations } from "./helpers/fixtures.ts";

const NOW_ISO = "2026-10-28T15:00:00.000Z";

describe("Workspace Layout & Orchestration Zod Contracts", () => {
  test("validates WorkspaceCardTypeSchema, WorkspaceCardNodeSchema cross-field invariants, and InvestigatePlan bounds", () => {
    assert.deepEqual(WorkspaceCardTypeSchema.options, [
      "ProjectDossierCard",
      "FrameTimelineScrubber",
      "ObservationTimeline",
      "MetricComparisonTable",
      "ConnectorHealthCard",
    ]);
    assert.equal(
      WorkspaceCardTypeSchema.safeParse("ProjectDossierCard").success,
      true
    );
    assert.equal(
      WorkspaceCardTypeSchema.safeParse("HallucinatedChart").success,
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
      latestRawCaptureHash: hashA,
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
    assert.equal(WorkspaceCardNodeSchema.safeParse(validDossierNode).success, true);

    const validTimelineNode = {
      plate: {
        illustrationId: "plate_canonical_1",
        timelineId: DEFAULT_TIMELINE_ID,
        turnNumber: 1,
        model: "gemini-3-pro-image",
        interactionId: "ix_canonical_1",
        parentInteractionId: null,
        parentIllustrationId: null,
        projectNumbers: ["TABS2027003697"],
        triggeringObservationIds: [milestoneObs.id],
        rawCaptureHashes: [hashA],
        prompt: "Corridor baseline",
        storageUri: `${ARTIFACT_BUCKET_URI}/illustrations/plate_canonical_1.webp`,
        mimeType: "image/webp" as const,
        byteLength: 512,
        sha256: hashA,
        isBranch: false,
        epistemicLabel: CANONICAL_MILESTONE_LABEL,
        watermarkText: null,
        createdAt: "2026-10-27T15:00:00.000Z",
        expiresAt: null,
      },
      assetPath: "/api/illustrations/assets/plate_canonical_1.webp",
      triggeringObservations: [milestoneObs],
      rawCaptures: [citationA],
    };

    const validScrubberNode = {
      nodeId: "valid-scrubber",
      component: "FrameTimelineScrubber" as const,
      initialIllustrationId: "plate_canonical_1",
      timeline: {
        timelineId: DEFAULT_TIMELINE_ID,
        activeCanonicalIllustrationId: "plate_canonical_1",
        nodes: [validTimelineNode],
        edges: [],
      },
    };
    assert.equal(WorkspaceCardNodeSchema.safeParse(validScrubberNode).success, true);

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
            initialIllustrationId: "plate_absent_id",
          },
          expectedPath: "initialIllustrationId",
        },
        {
          node: {
            ...validScrubberNode,
            nodeId: "zero-citation-scrubber",
            timeline: {
              ...validScrubberNode.timeline,
              nodes: [
                {
                  ...validTimelineNode,
                  plate: { ...validTimelineNode.plate, rawCaptureHashes: [] },
                  rawCaptures: [],
                },
              ],
            },
          },
          expectedPath: "timeline.nodes",
        },
      ];

    for (const { node, expectedPath } of invalidCases) {
      const parsed = WorkspaceCardNodeSchema.safeParse(node);
      assert.equal(parsed.success, false);
      assert.ok(
        parsed.error.issues.some((issue) => issue.path.join(".") === expectedPath)
      );
    }

    const emptyWorkspace = WorkspaceLayoutSchema.parse({
      version: 1,
      generatedAt: NOW_ISO,
      isEmpty: true,
      nodes: [],
    });

    for (const badRequest of [
      { query: "   " },
      { query: "q".repeat(MAX_INVESTIGATE_QUERY_LENGTH + 1) },
      { query: "Compare Ellis County compute filings", unexpectedField: true },
    ]) {
      assert.equal(
        InvestigatePlanRequestSchema.safeParse(badRequest).success,
        false
      );
    }

    for (const badResponse of [
      { workspace: emptyWorkspace, interactionId: "", tokensUsed: 10 },
      { workspace: emptyWorkspace, interactionId: "ix_1", tokensUsed: -1 },
      { workspace: emptyWorkspace, interactionId: "ix_1", tokensUsed: 1.5 },
      {
        workspace: emptyWorkspace,
        interactionId: "ix_1",
        tokensUsed: 10,
        unexpectedField: true,
      },
    ]) {
      assert.equal(
        InvestigatePlanResponseSchema.safeParse(badResponse).success,
        false
      );
    }
  });
});

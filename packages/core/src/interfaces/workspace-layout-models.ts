import { z } from "zod";
import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  MAX_PROJECTS_PER_CARD,
  MAX_WORKSPACE_NODES,
} from "./constants.ts";
import { ObservationSchema, ProjectSchema } from "./filing-models.ts";
import {
  FrameTimelineResponseSchema,
  TimelineSourceCitationSchema,
} from "./painter-models.ts";
import { TdlrProjectNumberSchema } from "./primitives.ts";
import { RepairChangelogResponseSchema } from "./repair-models.ts";
import { EfficiencyScorecardSchema } from "./run-record-models.ts";

export const SafeLayoutIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?!\.\.?$)[^\s/]+$/, "Expected safe non-empty layout identifier");

const HttpSourceCitationSchema = TimelineSourceCitationSchema.refine(
  (citation) => /^https?:\/\//i.test(citation.sourceUrl),
  {
    path: ["sourceUrl"],
    message: "Citation sourceUrl must use http:// or https://",
  }
);

export const WorkspaceCardTypeSchema = z.enum([
  "ProjectDossierCard",
  "FrameTimelineScrubber",
  "ObservationTimeline",
  "MetricComparisonTable",
  "ConnectorHealthCard",
]);

export type WorkspaceCardType = z.infer<typeof WorkspaceCardTypeSchema>;

export const CitedProjectSchema = z
  .object({
    project: ProjectSchema,
    citation: HttpSourceCitationSchema,
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.citation.sha256 !== entry.project.latestRawCaptureHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citation", "sha256"],
        message: "Citation sha256 must match project.latestRawCaptureHash",
      });
    }
  });

export type CitedProject = z.infer<typeof CitedProjectSchema>;

export const CitedObservationSchema = z
  .object({
    observation: ObservationSchema,
    citation: HttpSourceCitationSchema,
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.citation.sha256 !== entry.observation.rawCaptureHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citation", "sha256"],
        message: "Citation sha256 must match observation.rawCaptureHash",
      });
    }
  });

export type CitedObservation = z.infer<typeof CitedObservationSchema>;

export const ProjectDossierCardNodeSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ProjectDossierCard"),
    citedProject: CitedProjectSchema,
  })
  .strict();

export type ProjectDossierCardNode = z.infer<
  typeof ProjectDossierCardNodeSchema
>;

const HydratedProjectNumberListSchema = z
  .array(TdlrProjectNumberSchema)
  .max(MAX_PROJECTS_PER_CARD)
  .refine(
    (items) => new Set(items).size === items.length,
    "Duplicate projectNumber in ObservationTimelineNode"
  );

const ObservationTimelineNodeBaseSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ObservationTimeline"),
    projectNumbers: HydratedProjectNumberListSchema,
    observations: z.array(CitedObservationSchema),
  })
  .strict();

function refineObservationTimelineNode(
  node: z.infer<typeof ObservationTimelineNodeBaseSchema>,
  ctx: z.RefinementCtx
): void {
  const allowedProjects = new Set(node.projectNumbers);
  if (
    node.observations.some(
      (entry) => !allowedProjects.has(entry.observation.projectNumber)
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["observations"],
      message:
        "Every timeline observation must belong to node.projectNumbers",
    });
  }
  const uniqueObsIds = new Set(
    node.observations.map((entry) => entry.observation.id)
  );
  if (uniqueObsIds.size !== node.observations.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["observations"],
      message: "Duplicate observation.id in ObservationTimelineNode",
    });
  }
}

export const ObservationTimelineNodeSchema =
  ObservationTimelineNodeBaseSchema.superRefine(refineObservationTimelineNode);

export type ObservationTimelineNode = z.infer<
  typeof ObservationTimelineNodeSchema
>;

export const MetricComparisonTableNodeSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("MetricComparisonTable"),
    rows: z
      .array(CitedProjectSchema)
      .max(MAX_PROJECTS_PER_CARD)
      .refine(
        (rows) =>
          new Set(rows.map((row) => row.project.projectNumber)).size ===
          rows.length,
        "Duplicate projectNumber in MetricComparisonTableNode rows"
      ),
  })
  .strict();

export type MetricComparisonTableNode = z.infer<
  typeof MetricComparisonTableNodeSchema
>;

const NonEmptyFrameTimelineSchema = FrameTimelineResponseSchema.refine(
  (timeline) => timeline.nodes.length > 0,
  {
    path: ["nodes"],
    message: "FrameTimelineScrubber requires at least one active FrameTimelineNode",
  }
)
  .refine(
    (timeline) => timeline.nodes.every((node) => node.rawCaptures.length > 0),
    {
      path: ["nodes"],
      message:
        "Every FrameTimelineNode in FrameTimelineScrubber requires at least one RawCapture citation",
    }
  )
  .refine(
    (timeline) =>
      timeline.nodes.every((node) =>
        node.rawCaptures.every((art) => /^https?:\/\//i.test(art.sourceUrl))
      ),
    {
      path: ["nodes"],
      message: "FrameTimeline rawCaptures must use http:// or https:// sourceUrl",
    }
  );

const FrameTimelineScrubberNodeBaseSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("FrameTimelineScrubber"),
    timeline: NonEmptyFrameTimelineSchema,
    initialIllustrationId: SafeLayoutIdSchema.optional(),
  })
  .strict();

function refineFrameTimelineScrubberNode(
  node: z.infer<typeof FrameTimelineScrubberNodeBaseSchema>,
  ctx: z.RefinementCtx
): void {
  if (
    node.initialIllustrationId !== undefined &&
    !node.timeline.nodes.some((n) => n.plate.illustrationId === node.initialIllustrationId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["initialIllustrationId"],
      message: "initialIllustrationId must reference an active node in timeline.nodes",
    });
  }
}

export const FrameTimelineScrubberNodeSchema =
  FrameTimelineScrubberNodeBaseSchema.superRefine(refineFrameTimelineScrubberNode);

export type FrameTimelineScrubberNode = z.infer<
  typeof FrameTimelineScrubberNodeSchema
>;

const CompactEfficiencyScorecardSchema = EfficiencyScorecardSchema.refine(
  (scorecard) => scorecard.recentRuns.length <= CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  {
    path: ["recentRuns"],
    message: `ConnectorHealthCard scorecard.recentRuns must have <= ${CONNECTOR_HEALTH_RECENT_RUNS_LIMIT} entries`,
  }
);

export const ConnectorHealthCardNodeSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ConnectorHealthCard"),
    changelog: RepairChangelogResponseSchema,
    scorecard: CompactEfficiencyScorecardSchema,
  })
  .strict();

export type ConnectorHealthCardNode = z.infer<
  typeof ConnectorHealthCardNodeSchema
>;

export const WorkspaceCardNodeSchema = z
  .discriminatedUnion("component", [
    ProjectDossierCardNodeSchema,
    FrameTimelineScrubberNodeBaseSchema,
    ObservationTimelineNodeBaseSchema,
    MetricComparisonTableNodeSchema,
    ConnectorHealthCardNodeSchema,
  ])
  .superRefine((node, ctx) => {
    if (node.component === "ObservationTimeline") {
      refineObservationTimelineNode(node, ctx);
    }
    if (node.component === "FrameTimelineScrubber") {
      refineFrameTimelineScrubberNode(node, ctx);
    }
  });

export type WorkspaceCardNode = z.infer<typeof WorkspaceCardNodeSchema>;

export const WorkspaceLayoutSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    isEmpty: z.boolean(),
    nodes: z.array(WorkspaceCardNodeSchema).max(MAX_WORKSPACE_NODES),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const expectedEmpty = layout.nodes.length === 0;
    if (layout.isEmpty !== expectedEmpty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isEmpty"],
        message: "isEmpty must be true iff nodes is empty",
      });
    }
    const uniqueNodeIds = new Set(layout.nodes.map((node) => node.nodeId));
    if (uniqueNodeIds.size !== layout.nodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Duplicate nodeId in WorkspaceLayout nodes",
      });
    }
  });

export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>;

export type HydrateWorkspaceErrorCode =
  | "invalid_layout_spec"
  | "entity_not_found"
  | "unresolvable_provenance"
  | "repository_integrity_error";

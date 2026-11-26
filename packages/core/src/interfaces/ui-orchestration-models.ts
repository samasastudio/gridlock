import { z } from "zod";
import {
  MAX_INVESTIGATE_QUERY_LENGTH,
  MAX_PROJECTS_PER_CARD,
  MAX_WORKSPACE_NODES,
} from "./constants.ts";
import {
  SafeLayoutIdSchema,
  WorkspaceLayoutSchema,
} from "./workspace-layout-models.ts";
import { TdlrProjectNumberSchema } from "./primitives.ts";

const ProjectDossierCardSpecSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ProjectDossierCard"),
    projectNumber: TdlrProjectNumberSchema,
  })
  .strict();

const OrchestrationProjectNumberListSchema = z
  .array(TdlrProjectNumberSchema)
  .min(1)
  .max(MAX_PROJECTS_PER_CARD)
  .refine(
    (items) => new Set(items).size === items.length,
    "Duplicate projectNumber in orchestration card spec"
  );

const ObservationTimelineSpecSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ObservationTimeline"),
    projectNumbers: OrchestrationProjectNumberListSchema,
  })
  .strict();

const MetricComparisonTableSpecSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("MetricComparisonTable"),
    projectNumbers: OrchestrationProjectNumberListSchema,
  })
  .strict();

const FrameTimelineScrubberSpecSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("FrameTimelineScrubber"),
    timelineId: SafeLayoutIdSchema,
    initialPlateId: SafeLayoutIdSchema.optional(),
  })
  .strict();

const ConnectorHealthCardSpecSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ConnectorHealthCard"),
    connectorId: SafeLayoutIdSchema,
  })
  .strict();

export const OrchestrationNodeSpecSchema = z.discriminatedUnion("component", [
  ProjectDossierCardSpecSchema,
  FrameTimelineScrubberSpecSchema,
  ObservationTimelineSpecSchema,
  MetricComparisonTableSpecSchema,
  ConnectorHealthCardSpecSchema,
]);

export type OrchestrationNodeSpec = z.infer<typeof OrchestrationNodeSpecSchema>;

export const OrchestrationLayoutSpecSchema = z
  .object({
    nodes: z.array(OrchestrationNodeSpecSchema).max(MAX_WORKSPACE_NODES),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const uniqueNodeIds = new Set(spec.nodes.map((node) => node.nodeId));
    if (uniqueNodeIds.size !== spec.nodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Duplicate nodeId in OrchestrationLayoutSpec nodes",
      });
    }
  });

export type OrchestrationLayoutSpec = z.infer<typeof OrchestrationLayoutSpecSchema>;

export const InvestigatePlanRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_INVESTIGATE_QUERY_LENGTH),
    currentLayout: WorkspaceLayoutSchema.optional(),
  })
  .strict();

export type InvestigatePlanRequest = z.infer<
  typeof InvestigatePlanRequestSchema
>;

export const InvestigatePlanResponseSchema = z
  .object({
    workspace: WorkspaceLayoutSchema,
    interactionId: z.string().min(1),
    tokensUsed: z.number().int().nonnegative(),
  })
  .strict();

export type InvestigatePlanResponse = z.infer<
  typeof InvestigatePlanResponseSchema
>;

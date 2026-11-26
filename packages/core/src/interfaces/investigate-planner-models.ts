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

const ProjectDossierCardPlanSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ProjectDossierCard"),
    projectNumber: TdlrProjectNumberSchema,
  })
  .strict();

const PlannedProjectNumberListSchema = z
  .array(TdlrProjectNumberSchema)
  .min(1)
  .max(MAX_PROJECTS_PER_CARD)
  .refine(
    (items) => new Set(items).size === items.length,
    "Duplicate projectNumber in planner card spec"
  );

const ObservationTimelinePlanSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ObservationTimeline"),
    projectNumbers: PlannedProjectNumberListSchema,
  })
  .strict();

const MetricComparisonTablePlanSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("MetricComparisonTable"),
    projectNumbers: PlannedProjectNumberListSchema,
  })
  .strict();

const VisualPlateScrubberPlanSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("VisualPlateScrubber"),
    lineageId: SafeLayoutIdSchema,
    initialPlateId: SafeLayoutIdSchema.optional(),
  })
  .strict();

const ConnectorHealthCardPlanSchema = z
  .object({
    nodeId: SafeLayoutIdSchema,
    component: z.literal("ConnectorHealthCard"),
    connectorId: SafeLayoutIdSchema,
  })
  .strict();

export const PlannerNodeSpecSchema = z.discriminatedUnion("component", [
  ProjectDossierCardPlanSchema,
  VisualPlateScrubberPlanSchema,
  ObservationTimelinePlanSchema,
  MetricComparisonTablePlanSchema,
  ConnectorHealthCardPlanSchema,
]);

export type PlannerNodeSpec = z.infer<typeof PlannerNodeSpecSchema>;

export const PlannerLayoutSpecSchema = z
  .object({
    nodes: z.array(PlannerNodeSpecSchema).max(MAX_WORKSPACE_NODES),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const uniqueNodeIds = new Set(spec.nodes.map((node) => node.nodeId));
    if (uniqueNodeIds.size !== spec.nodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "Duplicate nodeId in PlannerLayoutSpec nodes",
      });
    }
  });

export type PlannerLayoutSpec = z.infer<typeof PlannerLayoutSpecSchema>;

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

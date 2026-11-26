import type { Buffer } from "node:buffer";
import { z } from "zod";
import {
  CANONICAL_MILESTONE_LABEL,
  MAX_SCENARIO_PROMPT_LENGTH,
  SCENARIO_BRANCH_WATERMARK,
} from "./constants.ts";
import { ObservationSchema } from "./filing-models.ts";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

const SafeSegmentIdSchema = z.string().regex(/^(?!\.\.?$)[^\s/]+$/);

export const EpistemicIllustrationLabelSchema = z.enum([
  CANONICAL_MILESTONE_LABEL,
  SCENARIO_BRANCH_WATERMARK,
]);

export type EpistemicIllustrationLabel = z.infer<typeof EpistemicIllustrationLabelSchema>;

export const GeneratedIllustrationSchema = z
  .object({
    plateId: SafeSegmentIdSchema,
    timelineId: SafeSegmentIdSchema,
    turnNumber: z.number().int().positive(),
    model: z.string().min(1),
    interactionId: z.string().min(1),
    parentInteractionId: z.string().min(1).nullable(),
    parentPlateId: SafeSegmentIdSchema.nullable(),
    rebootstrappedFromParentWebp: z.boolean().default(false),
    projectNumbers: z.array(TdlrProjectNumberSchema),
    triggeringObservationIds: z.array(z.string().min(1)),
    rawCaptureHashes: z.array(Sha256HashSchema),
    prompt: z.string().min(1),
    storageUri: z.string().startsWith("gs://"),
    mimeType: z.literal("image/webp"),
    byteLength: z.number().int().positive(),
    sha256: Sha256HashSchema,
    isBranch: z.boolean(),
    scenarioPrompt: z.string().min(1).max(MAX_SCENARIO_PROMPT_LENGTH).optional(),
    epistemicLabel: EpistemicIllustrationLabelSchema,
    watermarkText: z.literal(SCENARIO_BRANCH_WATERMARK).nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .superRefine((plate, ctx) => {
    const fail = (field: keyof typeof plate, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });

    if (plate.isBranch) {
      if (plate.epistemicLabel !== SCENARIO_BRANCH_WATERMARK) {
        fail("epistemicLabel", `Branched GeneratedIllustration requires "${SCENARIO_BRANCH_WATERMARK}"`);
      }
      if (plate.watermarkText !== SCENARIO_BRANCH_WATERMARK) {
        fail("watermarkText", `Branched GeneratedIllustration requires "${SCENARIO_BRANCH_WATERMARK}"`);
      }
      if (!plate.storageUri.includes("/branches/ephemeral/")) {
        fail("storageUri", "Branched GeneratedIllustration storageUri must use /branches/ephemeral/");
      }
      if (plate.expiresAt === null) {
        fail("expiresAt", "Branched GeneratedIllustration requires a 90-day expiresAt TTL");
      }
      return;
    }

    if (plate.epistemicLabel !== CANONICAL_MILESTONE_LABEL) {
      fail("epistemicLabel", `Canonical GeneratedIllustration requires "${CANONICAL_MILESTONE_LABEL}"`);
    }
    if (plate.watermarkText !== null) {
      fail("watermarkText", "Canonical GeneratedIllustration requires watermarkText: null");
    }
    if (!plate.storageUri.includes("/illustrations/") || plate.storageUri.includes("/branches/ephemeral/")) {
      fail("storageUri", "Canonical GeneratedIllustration storageUri must use /illustrations/");
    }
    if (plate.expiresAt !== null) {
      fail("expiresAt", "Canonical GeneratedIllustration requires permanent expiresAt: null");
    }
    if (plate.scenarioPrompt !== undefined) {
      fail("scenarioPrompt", "Canonical GeneratedIllustration must not set scenarioPrompt");
    }
  });

export type GeneratedIllustration = z.infer<typeof GeneratedIllustrationSchema>;

export type PainterErrorCode =
  | "timeline_already_bootstrapped"
  | "invalid_base_canvas"
  | "parent_not_found"
  | "invalid_scenario_prompt"
  | "branch_quota_exceeded"
  | "corrupt_or_empty_image"
  | "interaction_failed";

export type StatefulPainterResult =
  | {
      status: "skipped_no_milestone";
      timelineId: string;
      tokensUsed: 0;
      imageGenerationsAvoided: number;
      activeIllustration: GeneratedIllustration | null;
    }
  | {
      status: "illustration_painted";
      operation: "bootstrapCanvas" | "paintMilestoneDelta" | "branchTimeline";
      timelineId: string;
      illustration: GeneratedIllustration;
      webpBuffer: Buffer;
      tokensUsed: number;
      rebootstrappedFromParentWebp: boolean;
    }
  | {
      status: "painter_failed";
      timelineId: string;
      reason: string;
      errorCode: PainterErrorCode;
      tokensUsed: number;
      activeIllustration: GeneratedIllustration | null;
    };

export const TimelineSourceCitationSchema = z.object({
  sha256: Sha256HashSchema,
  sourceUrl: z.string().url(),
  connectorId: z.string().min(1),
  capturedAt: z.string().datetime(),
  referencedByMilestone: z.boolean(),
});

export type TimelineSourceCitation = z.infer<typeof TimelineSourceCitationSchema>;

export const FrameTimelineNodeSchema = z
  .object({
    plate: GeneratedIllustrationSchema,
    assetPath: z.string().startsWith("/api/illustrations/assets/").endsWith(".webp"),
    triggeringObservations: z.array(ObservationSchema),
    rawCaptures: z.array(TimelineSourceCitationSchema),
  })
  .superRefine((node, ctx) => {
    const expectedPath = `/api/illustrations/assets/${encodeURIComponent(node.plate.plateId)}.webp`;
    if (node.assetPath !== expectedPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetPath"],
        message: `Expected assetPath "${expectedPath}"`,
      });
    }
    if (
      node.triggeringObservations.some(
        (obs) => !node.plate.triggeringObservationIds.includes(obs.id)
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggeringObservations"],
        message: "Observation ID not referenced by illustration",
      });
    }
    if (
      node.rawCaptures.some(
        (art) => !node.plate.rawCaptureHashes.includes(art.sha256)
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rawCaptures"],
        message: "RawCapture sha256 not referenced by illustration",
      });
    }
  });

export type FrameTimelineNode = z.infer<typeof FrameTimelineNodeSchema>;

export const FrameTimelineEdgeSchema = z.object({
  parentInteractionId: z.string().min(1),
  childInteractionId: z.string().min(1),
  parentPlateId: z.string().min(1),
  childPlateId: z.string().min(1),
  isBranch: z.boolean(),
});

export type FrameTimelineEdge = z.infer<typeof FrameTimelineEdgeSchema>;

export const FrameTimelineResponseSchema = z
  .object({
    timelineId: SafeSegmentIdSchema,
    activeCanonicalPlateId: z.string().min(1).nullable(),
    nodes: z.array(FrameTimelineNodeSchema),
    edges: z.array(FrameTimelineEdgeSchema),
  })
  .superRefine((data, ctx) => {
    const fail = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (data.nodes.some((node) => node.plate.timelineId !== data.timelineId)) {
      fail(["nodes"], "All FrameTimelineNodes must match timelineId");
    }

    const uniquePlateIds = new Set(data.nodes.map((node) => node.plate.plateId));
    const uniqueInteractionIds = new Set(
      data.nodes.map((node) => node.plate.interactionId)
    );
    if (
      uniquePlateIds.size !== data.nodes.length ||
      uniqueInteractionIds.size !== data.nodes.length
    ) {
      fail(["nodes"], "Duplicate plateId or interactionId in FrameTimelineNodes");
    }

    const canonicalIds = new Set(
      data.nodes
        .filter((node) => !node.plate.isBranch)
        .map((node) => node.plate.plateId)
    );
    const hasValidActiveHead =
      canonicalIds.size === 0
        ? data.activeCanonicalPlateId === null
        : data.activeCanonicalPlateId !== null &&
          canonicalIds.has(data.activeCanonicalPlateId);
    if (!hasValidActiveHead) {
      fail(
        ["activeCanonicalPlateId"],
        "Invalid activeCanonicalPlateId for canonical nodes"
      );
    }

    const byInteraction = new Map(
      data.nodes.map((node) => [node.plate.interactionId, node.plate])
    );
    const invalidEdgeIdx = data.edges.findIndex((edge) => {
      const parent = byInteraction.get(edge.parentInteractionId);
      const child = byInteraction.get(edge.childInteractionId);
      return (
        !parent ||
        !child ||
        edge.parentInteractionId === edge.childInteractionId ||
        parent.plateId !== edge.parentPlateId ||
        child.plateId !== edge.childPlateId ||
        child.parentInteractionId !== edge.parentInteractionId ||
        child.isBranch !== edge.isBranch
      );
    });
    if (invalidEdgeIdx !== -1) {
      fail(
        ["edges", invalidEdgeIdx],
        "FrameTimelineEdge endpoints must match active parent-child nodes"
      );
    }
  });

export type FrameTimelineResponse = z.infer<typeof FrameTimelineResponseSchema>;

export const BranchIllustrationRequestSchema = z
  .object({
    interactionId: z.string().trim().min(1),
    scenarioPrompt: z.string().trim().min(1).max(MAX_SCENARIO_PROMPT_LENGTH),
    timelineId: z.string().trim().max(128).pipe(SafeSegmentIdSchema).optional(),
  })
  .strict();

export type BranchIllustrationRequest = z.infer<typeof BranchIllustrationRequestSchema>;

export const BranchIllustrationResponseSchema = z
  .object({
    plate: GeneratedIllustrationSchema,
    node: FrameTimelineNodeSchema,
    timelineId: SafeSegmentIdSchema,
    tokensUsed: z.number().int().nonnegative(),
    rebootstrappedFromParentWebp: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (
      !data.plate.isBranch ||
      data.plate.epistemicLabel !== SCENARIO_BRANCH_WATERMARK ||
      data.plate.watermarkText !== SCENARIO_BRANCH_WATERMARK
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plate"],
        message: `BranchIllustrationResponse requires branched illustration with "${SCENARIO_BRANCH_WATERMARK}"`,
      });
    }
    if (
      data.node.plate.plateId !== data.plate.plateId ||
      data.plate.timelineId !== data.timelineId ||
      data.plate.rebootstrappedFromParentWebp !== data.rebootstrappedFromParentWebp
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["node"],
        message:
          "BranchIllustrationResponse node, timelineId, and rebootstrappedFromParentWebp must match illustration",
      });
    }
  });

export type BranchIllustrationResponse = z.infer<typeof BranchIllustrationResponseSchema>;

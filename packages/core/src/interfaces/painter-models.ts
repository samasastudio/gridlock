import type { Buffer } from "node:buffer";
import { z } from "zod";
import {
  CANONICAL_MILESTONE_LABEL,
  MAX_SCENARIO_PROMPT_LENGTH,
  SCENARIO_BRANCH_WATERMARK,
} from "./constants.ts";
import { ObservationSchema } from "./filing-models.ts";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

export const EpistemicPlateLabelSchema = z.enum([
  CANONICAL_MILESTONE_LABEL,
  SCENARIO_BRANCH_WATERMARK,
]);

export type EpistemicPlateLabel = z.infer<typeof EpistemicPlateLabelSchema>;

export const VisualPlateSchema = z
  .object({
    plateId: z.string().min(1),
    lineageId: z.string().min(1),
    turnNumber: z.number().int().positive(),
    model: z.string().min(1),
    interactionId: z.string().min(1),
    parentInteractionId: z.string().min(1).nullable(),
    parentPlateId: z.string().min(1).nullable(),
    rebootstrappedFromParentWebp: z.boolean().default(false),
    projectNumbers: z.array(TdlrProjectNumberSchema),
    triggeringObservationIds: z.array(z.string().min(1)),
    sourceArtifactHashes: z.array(Sha256HashSchema),
    prompt: z.string().min(1),
    storageUri: z.string().startsWith("gs://"),
    mimeType: z.literal("image/webp"),
    byteLength: z.number().int().positive(),
    sha256: Sha256HashSchema,
    isBranch: z.boolean(),
    scenarioPrompt: z.string().min(1).max(MAX_SCENARIO_PROMPT_LENGTH).optional(),
    epistemicLabel: EpistemicPlateLabelSchema,
    watermarkText: z.literal(SCENARIO_BRANCH_WATERMARK).nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .superRefine((plate, ctx) => {
    const fail = (field: keyof typeof plate, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });

    if (plate.isBranch) {
      if (plate.epistemicLabel !== SCENARIO_BRANCH_WATERMARK) {
        fail("epistemicLabel", `Branched VisualPlate requires "${SCENARIO_BRANCH_WATERMARK}"`);
      }
      if (plate.watermarkText !== SCENARIO_BRANCH_WATERMARK) {
        fail("watermarkText", `Branched VisualPlate requires "${SCENARIO_BRANCH_WATERMARK}"`);
      }
      if (!plate.storageUri.includes("/branches/ephemeral/")) {
        fail("storageUri", "Branched VisualPlate storageUri must use /branches/ephemeral/");
      }
      if (plate.expiresAt === null) {
        fail("expiresAt", "Branched VisualPlate requires a 90-day expiresAt TTL");
      }
      return;
    }

    if (plate.epistemicLabel !== CANONICAL_MILESTONE_LABEL) {
      fail("epistemicLabel", `Canonical VisualPlate requires "${CANONICAL_MILESTONE_LABEL}"`);
    }
    if (plate.watermarkText !== null) {
      fail("watermarkText", "Canonical VisualPlate requires watermarkText: null");
    }
    if (!plate.storageUri.includes("/plates/") || plate.storageUri.includes("/branches/ephemeral/")) {
      fail("storageUri", "Canonical VisualPlate storageUri must use /plates/");
    }
    if (plate.expiresAt !== null) {
      fail("expiresAt", "Canonical VisualPlate requires permanent expiresAt: null");
    }
    if (plate.scenarioPrompt !== undefined) {
      fail("scenarioPrompt", "Canonical VisualPlate must not set scenarioPrompt");
    }
  });

export type VisualPlate = z.infer<typeof VisualPlateSchema>;

export type PainterErrorCode =
  | "lineage_already_bootstrapped"
  | "invalid_base_canvas"
  | "parent_not_found"
  | "invalid_scenario_prompt"
  | "branch_quota_exceeded"
  | "corrupt_or_empty_image"
  | "interaction_failed";

export type StatefulPainterResult =
  | {
      status: "skipped_no_milestone";
      lineageId: string;
      tokensUsed: 0;
      imageGenerationsAvoided: number;
      activePlate: VisualPlate | null;
    }
  | {
      status: "plate_painted";
      operation: "bootstrapCanvas" | "paintMilestoneDelta" | "branchLineage";
      lineageId: string;
      plate: VisualPlate;
      webpBuffer: Buffer;
      tokensUsed: number;
      rebootstrappedFromParentWebp: boolean;
    }
  | {
      status: "painter_failed";
      lineageId: string;
      reason: string;
      errorCode: PainterErrorCode;
      tokensUsed: number;
      activePlate: VisualPlate | null;
    };

export const LineageSourceCitationSchema = z.object({
  sha256: Sha256HashSchema,
  sourceUrl: z.string().url(),
  connectorId: z.string().min(1),
  capturedAt: z.string().datetime(),
  referencedByMilestone: z.boolean(),
});

export type LineageSourceCitation = z.infer<typeof LineageSourceCitationSchema>;

export const LineageNodeSchema = z
  .object({
    plate: VisualPlateSchema,
    assetPath: z.string().startsWith("/api/plates/assets/").endsWith(".webp"),
    triggeringObservations: z.array(ObservationSchema),
    sourceArtifacts: z.array(LineageSourceCitationSchema),
  })
  .superRefine((node, ctx) => {
    const expectedPath = `/api/plates/assets/${encodeURIComponent(node.plate.plateId)}.webp`;
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
        message: "Observation ID not referenced by plate",
      });
    }
    if (
      node.sourceArtifacts.some(
        (art) => !node.plate.sourceArtifactHashes.includes(art.sha256)
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceArtifacts"],
        message: "SourceArtifact sha256 not referenced by plate",
      });
    }
  });

export type LineageNode = z.infer<typeof LineageNodeSchema>;

export const LineageEdgeSchema = z.object({
  parentInteractionId: z.string().min(1),
  childInteractionId: z.string().min(1),
  parentPlateId: z.string().min(1),
  childPlateId: z.string().min(1),
  isBranch: z.boolean(),
});

export type LineageEdge = z.infer<typeof LineageEdgeSchema>;

export const PlateLineageResponseSchema = z
  .object({
    lineageId: z.string().min(1),
    activeCanonicalPlateId: z.string().min(1).nullable(),
    nodes: z.array(LineageNodeSchema),
    edges: z.array(LineageEdgeSchema),
  })
  .superRefine((data, ctx) => {
    const fail = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (data.nodes.some((node) => node.plate.lineageId !== data.lineageId)) {
      fail(["nodes"], "All LineageNodes must match lineageId");
    }

    const uniquePlateIds = new Set(data.nodes.map((node) => node.plate.plateId));
    const uniqueInteractionIds = new Set(
      data.nodes.map((node) => node.plate.interactionId)
    );
    if (
      uniquePlateIds.size !== data.nodes.length ||
      uniqueInteractionIds.size !== data.nodes.length
    ) {
      fail(["nodes"], "Duplicate plateId or interactionId in LineageNodes");
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
        "LineageEdge endpoints must match active parent-child nodes"
      );
    }
  });

export type PlateLineageResponse = z.infer<typeof PlateLineageResponseSchema>;

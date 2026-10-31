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

export const LineageEdgeSchema = z.object({
  fromInteractionId: z.string().min(1),
  toInteractionId: z.string().min(1),
  fromPlateId: z.string().min(1),
  toPlateId: z.string().min(1),
  isBranch: z.boolean(),
});

export type LineageEdge = z.infer<typeof LineageEdgeSchema>;

export const LineageNodeSchema = z.object({
  plate: VisualPlateSchema,
  observations: z.array(ObservationSchema),
  childInteractionIds: z.array(z.string().min(1)),
});

export type LineageNode = z.infer<typeof LineageNodeSchema>;

export const VisualPlateLineageSchema = z.object({
  lineageId: z.string().min(1),
  rootInteractionId: z.string().min(1).nullable(),
  activeCanonicalPlateId: z.string().min(1).nullable(),
  nodes: z.array(LineageNodeSchema),
  edges: z.array(LineageEdgeSchema),
});

export type VisualPlateLineage = z.infer<typeof VisualPlateLineageSchema>;

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

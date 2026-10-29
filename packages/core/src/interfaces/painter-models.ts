import type { Buffer } from "node:buffer";
import { z } from "zod";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

export const EpistemicPlateLabelSchema = z.enum([
  "Canonical Filing Milestone",
  "Scenario Branch / Unverified Projection",
]);

export type EpistemicPlateLabel = z.infer<typeof EpistemicPlateLabelSchema>;

export const VisualPlateSchema = z.object({
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
  scenarioPrompt: z.string().min(1).optional(),
  epistemicLabel: EpistemicPlateLabelSchema,
  watermarkText: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

export type VisualPlate = z.infer<typeof VisualPlateSchema>;

export type PainterErrorCode =
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

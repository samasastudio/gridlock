import { z } from "zod";
import { Sha256HashSchema } from "./primitives.ts";
import {
  ConnectorStatusSchema,
  TdlrFieldLabelsSchema,
  type ConnectorConfig,
} from "./filing-models.ts";

export const SelectorDiffEntrySchema = z.object({
  field: z.string().min(1),
  before: z.string(),
  after: z.string(),
});

export type SelectorDiffEntry = z.infer<typeof SelectorDiffEntrySchema>;

export const CandidateSelectorPatchSchema = z.object({
  detailContainerSelector: z.string().min(1).optional(),
  definitionListSelector: z.string().min(1).optional(),
  termSelector: z.string().min(1).optional(),
  descriptionSelector: z.string().min(1).optional(),
  fieldLabels: TdlrFieldLabelsSchema.partial().optional(),
  rootCauseSummary: z.string().min(1),
});

export type CandidateSelectorPatch = z.infer<
  typeof CandidateSelectorPatchSchema
>;

export const RepairChangelogEntrySchema = z.object({
  id: z.string().min(1),
  connectorId: z.string().min(1),
  previousVersion: z.number().int().positive(),
  promotedVersion: z.number().int().positive(),
  quarantinedArtifactHash: Sha256HashSchema,
  brokenInvariants: z.array(z.string().min(1)).min(1),
  selectorDiffs: z.array(SelectorDiffEntrySchema).min(1),
  rootCauseSummary: z.string().min(1),
  historicalFixturesTested: z.number().int().positive(),
  historicalFixturesPassed: z.number().int().positive(),
  totalFixturesVerified: z.number().int().positive(),
  anomalyDetectedAt: z.string().datetime(),
  patchPromotedAt: z.string().datetime(),
  mttrMs: z.number().nonnegative(),
  interactionId: z.string().min(1),
  repairTokensUsed: z.number().int().nonnegative(),
  estimatedRepairCostUsd: z.number().nonnegative(),
  subsequentDeterministicRunsServed: z.number().int().nonnegative(),
  expiresAt: z.null(),
});

export type RepairChangelogEntry = z.infer<typeof RepairChangelogEntrySchema>;

export const RepairChangelogResponseSchema = z
  .object({
    connectorId: z.string().min(1),
    connectorStatus: ConnectorStatusSchema,
    activeVersion: z.number().int().positive(),
    entries: z.array(RepairChangelogEntrySchema),
  })
  .superRefine((data, ctx) => {
    const invalidIndex = data.entries.findIndex(
      (entry) =>
        entry.connectorId !== data.connectorId ||
        entry.promotedVersion <= entry.previousVersion ||
        entry.promotedVersion > data.activeVersion
    );
    if (invalidIndex !== -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries", invalidIndex],
        message:
          "RepairChangelogEntry must match connectorId with previousVersion < promotedVersion <= activeVersion",
      });
    }
  });

export type RepairChangelogResponse = z.infer<
  typeof RepairChangelogResponseSchema
>;

export interface SandboxReplayResult {
  passed: boolean;
  candidateConfig: ConnectorConfig;
  selectorDiffs: SelectorDiffEntry[];
  quarantinedPassed: boolean;
  historicalFixturesTested: number;
  historicalFixturesPassed: number;
  totalFixturesVerified: number;
  failureReasons: string[];
}

export type RepairAgentResult =
  | {
      status: "repair_promoted";
      promotedConfig: ConnectorConfig;
      changelogEntry: RepairChangelogEntry;
      replay: SandboxReplayResult;
    }
  | {
      status: "repair_rejected";
      reason: string;
      connectorStatus: "selector_anomaly";
      replay?: SandboxReplayResult;
    };

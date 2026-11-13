import { z } from "zod";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

export const ExecutionModeSchema = z.enum(["deterministic", "agentic"]);

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const TelemetryRunStatusSchema = z.enum([
  "ingested",
  "unchanged_artifact",
  "selector_anomaly",
  "blocked_by_waf",
  "aborted",
  "agentic_completed",
  "agentic_failed",
]);

export type TelemetryRunStatus = z.infer<typeof TelemetryRunStatusSchema>;

export const TelemetryStageSchema = z.enum([
  "tdlr_ingest",
  "tdlr_discovery_sweep",
  "repair_agent",
  "painter_bootstrap",
  "painter_milestone_gate",
  "painter_milestone_delta",
  "painter_branch_lineage",
]);

export type TelemetryStage = z.infer<typeof TelemetryStageSchema>;

export const TelemetrySpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  stage: TelemetryStageSchema,
  execution_mode: ExecutionModeSchema,
  status: TelemetryRunStatusSchema,
  durationMs: z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  naiveTokensAvoided: z.number().int().nonnegative(),
  interactionId: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
    .optional(),
});

export type TelemetrySpan = z.infer<typeof TelemetrySpanSchema>;

export const TelemetryRunSchema = z.object({
  runId: z.string().min(1),
  stage: TelemetryStageSchema,
  connectorId: z.string().min(1).optional(),
  projectNumber: TdlrProjectNumberSchema.optional(),
  sourceArtifactHash: Sha256HashSchema.optional(),
  execution_mode: ExecutionModeSchema,
  status: TelemetryRunStatusSchema,
  durationMs: z.number().nonnegative(),
  rawByteLength: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  naiveTokensAvoided: z.number().int().nonnegative(),
  estimatedCostSavedUsd: z.number().nonnegative(),
  interactionId: z.string().min(1).optional(),
  recordedAt: z.string().datetime(),
  expiresAt: z.null(),
});

export type TelemetryRun = z.infer<typeof TelemetryRunSchema>;

export const EfficiencyLedgerSchema = z.object({
  ledgerId: z.string().min(1),
  deterministicRunsCount: z.number().int().nonnegative(),
  agenticRunsCount: z.number().int().nonnegative(),
  failedOrBlockedRunsCount: z.number().int().nonnegative(),
  totalRunsCount: z.number().int().nonnegative(),
  deterministicExecutionRatio: z.number().min(0).max(1),
  deterministicExecutionPercentage: z.number().min(0).max(100),
  naiveTokensAvoided: z.number().int().nonnegative(),
  actualTokensUsed: z.number().int().nonnegative(),
  tokenReductionPercentage: z.number().min(0).max(100),
  estimatedCostSavedUsd: z.number().nonnegative(),
  actualCostUsd: z.number().nonnegative(),
  imageGenerationsAvoided: z.number().int().nonnegative(),
  visualPlateCacheHits: z.number().int().nonnegative(),
  uncachedImageGenerationsCount: z.number().int().nonnegative().default(0),
  visualPlateCacheEfficiencyPercentage: z.number().min(0).max(100),
  averageRepairMttrMs: z.number().nonnegative(),
  subsequentDeterministicRunsServed: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  expiresAt: z.null(),
  recentRuns: z.array(TelemetryRunSchema),
});

export type EfficiencyLedger = z.infer<typeof EfficiencyLedgerSchema>;

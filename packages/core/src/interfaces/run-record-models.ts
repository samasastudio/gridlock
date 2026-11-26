import { z } from "zod";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

export const ExecutionModeSchema = z.enum(["deterministic", "agentic"]);

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const RunRecordStatusSchema = z.enum([
  "ingested",
  "unchanged_artifact",
  "selector_anomaly",
  "blocked_by_waf",
  "aborted",
  "agentic_completed",
  "agentic_failed",
]);

export type RunRecordStatus = z.infer<typeof RunRecordStatusSchema>;

export const RunStageSchema = z.enum([
  "tdlr_ingest",
  "tdlr_discovery_sweep",
  "repair_agent",
  "painter_bootstrap",
  "painter_milestone_gate",
  "painter_milestone_delta",
  "painter_branch_lineage",
  "ui_orchestration_agent",
]);

export type RunStage = z.infer<typeof RunStageSchema>;

export const RunSpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  stage: RunStageSchema,
  execution_mode: ExecutionModeSchema,
  status: RunRecordStatusSchema,
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

export type RunSpan = z.infer<typeof RunSpanSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  stage: RunStageSchema,
  connectorId: z.string().min(1).optional(),
  projectNumber: TdlrProjectNumberSchema.optional(),
  rawCaptureHash: Sha256HashSchema.optional(),
  execution_mode: ExecutionModeSchema,
  status: RunRecordStatusSchema,
  durationMs: z.number().nonnegative(),
  rawByteLength: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  naiveTokensAvoided: z.number().int().nonnegative(),
  estimatedCostSavedUsd: z.number().nonnegative(),
  interactionId: z.string().min(1).optional(),
  recordedAt: z.string().datetime(),
  expiresAt: z.null(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export const EfficiencyScorecardSchema = z.object({
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
  recentRuns: z.array(RunRecordSchema),
});

export type EfficiencyScorecard = z.infer<typeof EfficiencyScorecardSchema>;

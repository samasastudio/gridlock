import { randomBytes } from "node:crypto";
import {
  EfficiencyLedgerSchema,
  TelemetryRunSchema,
  TelemetrySpanSchema,
  type EfficiencyLedger,
  type ExecutionMode,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
} from "./schemas.ts";

export const NAIVE_COST_PER_TOKEN_USD = 0.0000025;
export const DEFAULT_GCP_PROJECT_ID = "gridlock-civic-atlas";

export type TelemetrySpanSink = (span: TelemetrySpan) => void;

export function calculateNaiveTokensAvoided(rawByteLength: number): number {
  if (!Number.isFinite(rawByteLength) || rawByteLength <= 0) {
    return 0;
  }
  return Math.ceil(rawByteLength / 4);
}

export function calculateEstimatedCostSavedUsd(
  naiveTokensAvoided: number
): number {
  if (!Number.isFinite(naiveTokensAvoided) || naiveTokensAvoided <= 0) {
    return 0;
  }
  return Number((naiveTokensAvoided * NAIVE_COST_PER_TOKEN_USD).toFixed(8));
}

export function createCloudLoggingSpanSink(
  writer: (jsonLine: string) => void = (line) => process.stdout.write(`${line}\n`),
  projectId: string = process.env.GOOGLE_CLOUD_PROJECT ?? DEFAULT_GCP_PROJECT_ID
): TelemetrySpanSink {
  return (span: TelemetrySpan) => {
    const validated = TelemetrySpanSchema.parse(span);
    const isError =
      validated.status === "blocked_by_waf" ||
      validated.status === "selector_anomaly" ||
      validated.status === "aborted" ||
      validated.status === "agentic_failed";

    const cloudLogEntry: Record<string, unknown> = {
      severity: isError ? "WARNING" : "INFO",
      message: `[Gridlock Telemetry] stage=${validated.stage} mode=${validated.execution_mode} status=${validated.status} durationMs=${validated.durationMs} naiveTokensAvoided=${validated.naiveTokensAvoided} tokensUsed=${validated.tokensUsed}`,
      "logging.googleapis.com/trace": `projects/${projectId}/traces/${validated.traceId}`,
      "logging.googleapis.com/spanId": validated.spanId,
      stage: validated.stage,
      status: validated.status,
      execution_mode: validated.execution_mode,
      durationMs: validated.durationMs,
      tokensUsed: validated.tokensUsed,
      naiveTokensAvoided: validated.naiveTokensAvoided,
      startedAt: validated.startedAt,
      endedAt: validated.endedAt,
      ...(validated.interactionId !== undefined
        ? { interactionId: validated.interactionId }
        : {}),
      ...(validated.attributes !== undefined
        ? { attributes: validated.attributes }
        : {}),
    };

    writer(JSON.stringify(cloudLogEntry));
  };
}

export function buildTelemetrySpan(params: {
  stage: string;
  execution_mode: ExecutionMode;
  status: TelemetryRunStatus;
  startedAt: Date;
  endedAt: Date;
  tokensUsed: number;
  naiveTokensAvoided: number;
  interactionId?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, string | number | boolean | null>;
}): TelemetrySpan {
  const durationMs = Math.max(
    0,
    params.endedAt.getTime() - params.startedAt.getTime()
  );
  return TelemetrySpanSchema.parse({
    traceId: params.traceId ?? randomBytes(16).toString("hex"),
    spanId: params.spanId ?? randomBytes(8).toString("hex"),
    stage: params.stage,
    execution_mode: params.execution_mode,
    status: params.status,
    durationMs,
    tokensUsed: params.tokensUsed,
    naiveTokensAvoided: params.naiveTokensAvoided,
    ...(params.interactionId !== undefined
      ? { interactionId: params.interactionId }
      : {}),
    startedAt: params.startedAt.toISOString(),
    endedAt: params.endedAt.toISOString(),
    ...(params.attributes !== undefined
      ? { attributes: params.attributes }
      : {}),
  });
}

export function buildTelemetryRun(params: {
  runId?: string;
  stage: string;
  connectorId?: string;
  projectNumber?: string;
  sourceArtifactHash?: string;
  execution_mode: ExecutionMode;
  status: TelemetryRunStatus;
  durationMs: number;
  rawByteLength: number;
  tokensUsed: number;
  naiveTokensAvoided: number;
  estimatedCostSavedUsd?: number;
  interactionId?: string;
  recordedAt: string;
}): TelemetryRun {
  const estimatedCostSavedUsd =
    params.estimatedCostSavedUsd ??
    calculateEstimatedCostSavedUsd(params.naiveTokensAvoided);
  return TelemetryRunSchema.parse({
    runId:
      params.runId ??
      `run_${params.stage}_${Date.parse(params.recordedAt) || Date.now()}_${randomBytes(4).toString("hex")}`,
    stage: params.stage,
    ...(params.connectorId !== undefined
      ? { connectorId: params.connectorId }
      : {}),
    ...(params.projectNumber !== undefined
      ? { projectNumber: params.projectNumber }
      : {}),
    ...(params.sourceArtifactHash !== undefined
      ? { sourceArtifactHash: params.sourceArtifactHash }
      : {}),
    execution_mode: params.execution_mode,
    status: params.status,
    durationMs: Math.max(0, params.durationMs),
    rawByteLength: Math.max(0, params.rawByteLength),
    tokensUsed: Math.max(0, params.tokensUsed),
    naiveTokensAvoided: Math.max(0, params.naiveTokensAvoided),
    estimatedCostSavedUsd,
    ...(params.interactionId !== undefined
      ? { interactionId: params.interactionId }
      : {}),
    recordedAt: params.recordedAt,
    expiresAt: null,
  });
}

export function applyTelemetryRunToLedger(
  current: EfficiencyLedger,
  run: TelemetryRun,
  recentRuns: TelemetryRun[]
): EfficiencyLedger {
  const isSuccessfulDeterministic =
    run.execution_mode === "deterministic" &&
    (run.status === "ingested" || run.status === "unchanged_artifact");

  const isSuccessfulAgentic =
    run.execution_mode === "agentic" && run.status === "agentic_completed";

  const isFailedOrBlocked = !isSuccessfulDeterministic && !isSuccessfulAgentic;

  const deterministicRunsCount =
    current.deterministicRunsCount + (isSuccessfulDeterministic ? 1 : 0);
  const agenticRunsCount =
    current.agenticRunsCount + (isSuccessfulAgentic ? 1 : 0);
  const failedOrBlockedRunsCount =
    current.failedOrBlockedRunsCount + (isFailedOrBlocked ? 1 : 0);
  const totalRunsCount = current.totalRunsCount + 1;

  const naiveTokensAvoided =
    current.naiveTokensAvoided +
    (isSuccessfulDeterministic ? run.naiveTokensAvoided : 0);
  const actualTokensUsed = current.actualTokensUsed + run.tokensUsed;

  const estimatedCostSavedUsd = Number(
    (
      current.estimatedCostSavedUsd +
      (isSuccessfulDeterministic ? run.estimatedCostSavedUsd : 0)
    ).toFixed(8)
  );
  const actualCostUsd = Number(
    (
      current.actualCostUsd +
      run.tokensUsed * NAIVE_COST_PER_TOKEN_USD
    ).toFixed(8)
  );

  const completedRunsDenom = deterministicRunsCount + agenticRunsCount;
  const deterministicExecutionRatio =
    completedRunsDenom === 0
      ? 1
      : Number((deterministicRunsCount / completedRunsDenom).toFixed(6));
  const deterministicExecutionPercentage = Number(
    (deterministicExecutionRatio * 100).toFixed(2)
  );

  const tokenDenom = naiveTokensAvoided + actualTokensUsed;
  const tokenReductionPercentage =
    tokenDenom === 0
      ? 100
      : Number(((naiveTokensAvoided / tokenDenom) * 100).toFixed(2));

  return EfficiencyLedgerSchema.parse({
    ...current,
    deterministicRunsCount,
    agenticRunsCount,
    failedOrBlockedRunsCount,
    totalRunsCount,
    deterministicExecutionRatio,
    deterministicExecutionPercentage,
    naiveTokensAvoided,
    actualTokensUsed,
    tokenReductionPercentage,
    estimatedCostSavedUsd,
    actualCostUsd,
    updatedAt: run.recordedAt,
    expiresAt: null,
    recentRuns,
  });
}

export async function recordAgenticStageTelemetry(
  input: {
    stage: string;
    connectorId?: string;
    projectNumber?: string;
    sourceArtifactHash?: string;
    status: "agentic_completed" | "agentic_failed";
    tokensUsed: number;
    interactionId?: string;
    rawByteLength?: number;
    startedAt: Date;
    endedAt: Date;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: {
      recordTelemetryRun(run: TelemetryRun): Promise<EfficiencyLedger>;
    };
    spanSink?: TelemetrySpanSink;
  }
): Promise<{ run: TelemetryRun; span: TelemetrySpan; ledger: EfficiencyLedger }> {
  const durationMs = Math.max(
    0,
    input.endedAt.getTime() - input.startedAt.getTime()
  );
  const run = buildTelemetryRun({
    stage: input.stage,
    ...(input.connectorId !== undefined
      ? { connectorId: input.connectorId }
      : {}),
    ...(input.projectNumber !== undefined
      ? { projectNumber: input.projectNumber }
      : {}),
    ...(input.sourceArtifactHash !== undefined
      ? { sourceArtifactHash: input.sourceArtifactHash }
      : {}),
    execution_mode: "agentic",
    status: input.status,
    durationMs,
    rawByteLength: input.rawByteLength ?? 0,
    tokensUsed: input.tokensUsed,
    naiveTokensAvoided: 0,
    estimatedCostSavedUsd: 0,
    ...(input.interactionId !== undefined
      ? { interactionId: input.interactionId }
      : {}),
    recordedAt: input.endedAt.toISOString(),
  });

  const ledger = await deps.repository.recordTelemetryRun(run);
  const span = buildTelemetrySpan({
    stage: input.stage,
    execution_mode: "agentic",
    status: input.status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    tokensUsed: input.tokensUsed,
    naiveTokensAvoided: 0,
    ...(input.interactionId !== undefined
      ? { interactionId: input.interactionId }
      : {}),
    ...(input.attributes !== undefined
      ? { attributes: input.attributes }
      : {}),
  });

  if (deps.spanSink) {
    deps.spanSink(span);
  }

  return { run, span, ledger };
}

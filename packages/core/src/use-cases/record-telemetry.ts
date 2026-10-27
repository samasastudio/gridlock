import {
  type EfficiencyLedger,
  type ExecutionMode,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import {
  buildTelemetryRun,
  buildTelemetrySpan,
} from "./helpers/telemetry-math.ts";

const noopSpanSink: TelemetrySpanSink = () => {};

export async function recordStageTelemetry(
  input: {
    stage: string;
    connectorId?: string;
    projectNumber?: string;
    sourceArtifactHash?: string;
    execution_mode: ExecutionMode;
    status: TelemetryRunStatus;
    rawByteLength: number;
    tokensUsed: number;
    naiveTokensAvoided: number;
    estimatedCostSavedUsd?: number;
    interactionId?: string;
    startedAt: Date;
    endedAt: Date;
    recordedAt?: string;
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
    execution_mode: input.execution_mode,
    status: input.status,
    durationMs,
    rawByteLength: input.rawByteLength,
    tokensUsed: input.tokensUsed,
    naiveTokensAvoided: input.naiveTokensAvoided,
    ...(input.estimatedCostSavedUsd !== undefined
      ? { estimatedCostSavedUsd: input.estimatedCostSavedUsd }
      : {}),
    ...(input.interactionId !== undefined
      ? { interactionId: input.interactionId }
      : {}),
    recordedAt: input.recordedAt ?? input.endedAt.toISOString(),
  });

  const ledger = await deps.repository.recordTelemetryRun(run);
  const span = buildTelemetrySpan({
    stage: input.stage,
    execution_mode: input.execution_mode,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    tokensUsed: input.tokensUsed,
    naiveTokensAvoided: input.naiveTokensAvoided,
    ...(input.interactionId !== undefined
      ? { interactionId: input.interactionId }
      : {}),
    ...(input.attributes !== undefined
      ? { attributes: input.attributes }
      : {}),
  });

  const sink = deps.spanSink ?? noopSpanSink;
  sink(span);

  return { run, span, ledger };
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
  return recordStageTelemetry(
    {
      ...input,
      execution_mode: "agentic",
      rawByteLength: input.rawByteLength ?? 0,
      naiveTokensAvoided: 0,
      estimatedCostSavedUsd: 0,
    },
    deps
  );
}

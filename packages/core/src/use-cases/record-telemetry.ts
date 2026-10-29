import {
  type ConnectorConfig,
  type EfficiencyLedger,
  type ExecutionMode,
  type GridlockRepository,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import {
  applyHealAmortization,
  applyTelemetryRunToLedger,
  buildTelemetryRun,
  buildTelemetrySpan,
} from "./helpers/telemetry-math.ts";

const noopSpanSink: TelemetrySpanSink = () => {};

async function resolveActiveConnectorConfig(
  repository: GridlockRepository,
  connectorId: string | undefined
): Promise<ConnectorConfig | undefined> {
  if (!connectorId) return undefined;
  try {
    return await repository.getActiveConnectorConfig(connectorId);
  } catch {
    return undefined;
  }
}

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
    imageGenerationsAvoidedDelta?: number;
    visualPlateCacheHitsDelta?: number;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: GridlockRepository;
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

  const currentLedger = await deps.repository.getEfficiencyLedger();
  const existingRuns = await deps.repository.listTelemetryRuns();
  const recentSlice = [...existingRuns, run].slice(-50);
  const ledgerAfterRun = applyTelemetryRunToLedger(
    currentLedger,
    run,
    recentSlice,
    {
      ...(input.imageGenerationsAvoidedDelta !== undefined
        ? { imageGenerationsAvoidedDelta: input.imageGenerationsAvoidedDelta }
        : {}),
      ...(input.visualPlateCacheHitsDelta !== undefined
        ? { visualPlateCacheHitsDelta: input.visualPlateCacheHitsDelta }
        : {}),
    }
  );

  const activeConfig = await resolveActiveConnectorConfig(
    deps.repository,
    run.connectorId
  );

  const currentChangelog = await deps.repository.listRepairChangelog();
  const amortized = applyHealAmortization({
    run,
    activeConfig,
    repairChangelog: currentChangelog,
    ledger: ledgerAfterRun,
  });

  const ledger = await deps.repository.recordTelemetryRun(run, {
    updatedLedger: amortized.updatedLedger,
    updatedChangelog: amortized.updatedChangelog,
  });

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
    visualPlateCacheHitsDelta?: number;
    startedAt: Date;
    endedAt: Date;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: GridlockRepository;
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

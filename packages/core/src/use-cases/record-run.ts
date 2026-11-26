import {
  type ConnectorConfig,
  type EfficiencyLedger,
  type ExecutionMode,
  type GridlockRepository,
  type RunPainterDeltas,
  type RunRecord,
  type RunRecordStatus,
  type RunSpan,
  type RunSpanSink,
  type RunStage,
} from "../interfaces/index.ts";
import {
  applyHealAmortization,
  applyRunRecordToLedger,
  buildRunRecord,
  buildRunSpan,
} from "./helpers/scorecard-math.ts";

const noopSpanSink: RunSpanSink = () => {};

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

export async function recordStageRun(
  input: RunPainterDeltas & {
    stage: RunStage;
    connectorId?: string;
    projectNumber?: string;
    rawCaptureHash?: string;
    execution_mode: ExecutionMode;
    status: RunRecordStatus;
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
    repository: GridlockRepository;
    spanSink?: RunSpanSink;
  }
): Promise<{ run: RunRecord; span: RunSpan; ledger: EfficiencyLedger }> {
  const durationMs = Math.max(
    0,
    input.endedAt.getTime() - input.startedAt.getTime()
  );
  const run = buildRunRecord({
    stage: input.stage,
    ...(input.connectorId !== undefined
      ? { connectorId: input.connectorId }
      : {}),
    ...(input.projectNumber !== undefined
      ? { projectNumber: input.projectNumber }
      : {}),
    ...(input.rawCaptureHash !== undefined
      ? { rawCaptureHash: input.rawCaptureHash }
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
  const existingRuns = await deps.repository.listRunRecords();
  const recentSlice = [...existingRuns, run].slice(-50);
  const ledgerAfterRun = applyRunRecordToLedger(
    currentLedger,
    run,
    recentSlice,
    input
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

  const ledger = await deps.repository.recordRunRecord(run, {
    updatedLedger: amortized.updatedLedger,
    updatedChangelog: amortized.updatedChangelog,
  });

  const span = buildRunSpan({
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

export async function recordAgenticStageRun(
  input: {
    stage: RunStage;
    connectorId?: string;
    projectNumber?: string;
    rawCaptureHash?: string;
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
    spanSink?: RunSpanSink;
  }
): Promise<{ run: RunRecord; span: RunSpan; ledger: EfficiencyLedger }> {
  return recordStageRun(
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

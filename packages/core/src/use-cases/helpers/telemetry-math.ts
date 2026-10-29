import { randomBytes } from "node:crypto";
import {
  EfficiencyLedgerSchema,
  NAIVE_COST_PER_TOKEN_USD,
  RepairChangelogEntrySchema,
  SourceArtifactSchema,
  TelemetryRunSchema,
  TelemetrySpanSchema,
  type ConnectorConfig,
  type EfficiencyLedger,
  type ExecutionMode,
  type RepairChangelogEntry,
  type SourceArtifact,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
} from "../../interfaces/index.ts";

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

export function applyHealAmortization(params: {
  run: TelemetryRun;
  activeConfig: ConnectorConfig | undefined;
  repairChangelog: readonly RepairChangelogEntry[];
  ledger: EfficiencyLedger;
}): {
  updatedChangelog: RepairChangelogEntry[];
  updatedLedger: EfficiencyLedger;
} {
  const { run, activeConfig, repairChangelog, ledger } = params;
  const updatedChangelog = repairChangelog.map((entry) =>
    structuredClone(entry)
  );

  if (
    run.execution_mode !== "deterministic" ||
    (run.status !== "ingested" && run.status !== "unchanged_artifact") ||
    !run.connectorId ||
    !activeConfig
  ) {
    return {
      updatedChangelog,
      updatedLedger: structuredClone(ledger),
    };
  }

  const targetIndex = updatedChangelog.reduce(
    (foundIdx, entry, idx) =>
      entry.connectorId === run.connectorId &&
      entry.promotedVersion === activeConfig.version
        ? idx
        : foundIdx,
    -1
  );

  if (targetIndex === -1) {
    return {
      updatedChangelog,
      updatedLedger: structuredClone(ledger),
    };
  }

  const nextChangelog = updatedChangelog.map((entry, idx) =>
    idx === targetIndex
      ? RepairChangelogEntrySchema.parse({
          ...entry,
          subsequentDeterministicRunsServed:
            entry.subsequentDeterministicRunsServed + 1,
        })
      : entry
  );
  const updatedLedger = EfficiencyLedgerSchema.parse({
    ...ledger,
    subsequentDeterministicRunsServed:
      ledger.subsequentDeterministicRunsServed + 1,
  });
  return { updatedChangelog: nextChangelog, updatedLedger };
}

export function applyConnectorPromotion(params: {
  changelogEntry: RepairChangelogEntry;
  allChangelogEntries: readonly RepairChangelogEntry[];
  quarantinedArtifact: SourceArtifact | undefined;
  ledger: EfficiencyLedger;
}): {
  promotedArtifact: SourceArtifact | undefined;
  updatedLedger: EfficiencyLedger;
} {
  const { changelogEntry, allChangelogEntries, quarantinedArtifact, ledger } =
    params;

  const promotedArtifact = quarantinedArtifact
    ? SourceArtifactSchema.parse({
        ...quarantinedArtifact,
        referencedByMilestone: true,
        expiresAt: null,
      })
    : undefined;

  const totalMttrMs = allChangelogEntries.reduce(
    (sum, item) => sum + item.mttrMs,
    0
  );
  const averageRepairMttrMs =
    allChangelogEntries.length > 0
      ? Number((totalMttrMs / allChangelogEntries.length).toFixed(2))
      : 0;

  const updatedLedger = EfficiencyLedgerSchema.parse({
    ...ledger,
    averageRepairMttrMs,
    updatedAt: changelogEntry.patchPromotedAt,
  });

  return { promotedArtifact, updatedLedger };
}

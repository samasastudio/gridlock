import {
  RECENT_RUN_RECORDS_LIMIT,
  type EfficiencyScorecard,
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
  applyRunRecordToScorecard,
  buildRunRecord,
  buildRunSpan,
} from "./helpers/scorecard-math.ts";

const noopSpanSink: RunSpanSink = () => {};

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
): Promise<{ run: RunRecord; span: RunSpan; scorecard: EfficiencyScorecard }> {
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

  const scorecard = await deps.repository.recordRunRecord(
    run,
    ({
      currentScorecard,
      recentRuns,
      activeConfig,
      matchingChangelogEntry,
    }) => {
      const recentSlice = [...recentRuns, run].slice(-RECENT_RUN_RECORDS_LIMIT);
      const scorecardAfterRun = applyRunRecordToScorecard(
        currentScorecard,
        run,
        recentSlice,
        input
      );
      const amortized = applyHealAmortization({
        run,
        activeConfig,
        matchingEntry: matchingChangelogEntry,
        scorecard: scorecardAfterRun,
      });
      return {
        updatedScorecard: amortized.updatedScorecard,
        updatedChangelogEntry: amortized.updatedEntry,
      };
    }
  );

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

  return { run, span, scorecard };
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
    illustrationCacheHitsDelta?: number;
    startedAt: Date;
    endedAt: Date;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: GridlockRepository;
    spanSink?: RunSpanSink;
  }
): Promise<{ run: RunRecord; span: RunSpan; scorecard: EfficiencyScorecard }> {
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

import {
  DEFAULT_LINEAGE_ID,
  type GridlockRepository,
  type Observation,
  type StatefulPainterResult,
  type TelemetrySpanSink,
  type VisualPlate,
} from "../interfaces/index.ts";
import { selectActiveCanonicalPlate } from "./helpers/painter-helpers.ts";
import { recordStageTelemetry } from "./record-telemetry.ts";

export interface PainterTurnContext {
  lineageId: string;
  activePlate: VisualPlate | null;
  now: Date;
  repository: GridlockRepository;
  spanSink?: TelemetrySpanSink;
}

export async function preparePainterTurn(
  input: { lineageId?: string; now?: Date },
  deps: { repository: GridlockRepository; spanSink?: TelemetrySpanSink }
): Promise<{ ctx: PainterTurnContext; existingPlates: VisualPlate[] }> {
  const lineageId = input.lineageId ?? DEFAULT_LINEAGE_ID;
  const now = input.now ?? new Date();
  const existingPlates = await deps.repository.listVisualPlatesByLineage(lineageId);
  const activePlate = selectActiveCanonicalPlate(existingPlates);
  return {
    ctx: {
      lineageId,
      activePlate,
      now,
      repository: deps.repository,
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    },
    existingPlates,
  };
}

function telemetryDeps(ctx: PainterTurnContext) {
  return {
    repository: ctx.repository,
    ...(ctx.spanSink !== undefined ? { spanSink: ctx.spanSink } : {}),
  };
}

function observationTelemetryRef(observations: readonly Observation[]) {
  const firstObs = observations[0];
  return firstObs !== undefined
    ? {
        projectNumber: firstObs.projectNumber,
        sourceArtifactHash: firstObs.sourceArtifactHash,
      }
    : {};
}

export async function recordMilestoneSkip(
  ctx: PainterTurnContext,
  observations: readonly Observation[]
): Promise<StatefulPainterResult> {
  const { ledger } = await recordStageTelemetry(
    {
      stage: "painter_milestone_gate",
      ...observationTelemetryRef(observations),
      execution_mode: "deterministic",
      status: "unchanged_artifact",
      rawByteLength: 0,
      tokensUsed: 0,
      naiveTokensAvoided: 0,
      estimatedCostSavedUsd: 0,
      imageGenerationsAvoidedDelta: 1,
      startedAt: ctx.now,
      endedAt: ctx.now,
      recordedAt: ctx.now.toISOString(),
      attributes: {
        lineageId: ctx.lineageId,
        candidateObservationsCount: observations.length,
      },
    },
    telemetryDeps(ctx)
  );
  return {
    status: "skipped_no_milestone",
    lineageId: ctx.lineageId,
    tokensUsed: 0,
    imageGenerationsAvoided: ledger.imageGenerationsAvoided,
    activePlate: ctx.activePlate,
  };
}

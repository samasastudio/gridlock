import { createHash } from "node:crypto";
import {
  DEFAULT_LINEAGE_ID,
  PAINTER_AGENT_MODEL,
  SCENARIO_BRANCH_WATERMARK,
  SourceArtifactSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type Observation,
  type PainterErrorCode,
  type PainterImageEncoder,
  type StatefulPainterResult,
  type TelemetrySpanSink,
  type VisualPlate,
} from "../interfaces/index.ts";
import {
  buildVisualPlateRecord,
  buildWebpMultimodalInput,
  classifyNonCompletedInteraction,
  classifyThrownPainterError,
  evaluateMilestoneObservations,
  isExpiredOrRejectedPreviousInteraction,
  selectActiveCanonicalPlate,
  type PainterCompletedTurn,
  type PainterInteractionFailure,
  type PainterStage,
  type PainterTurnAttemptResult,
  type VisualPlateTurnSpec,
} from "./helpers/painter-helpers.ts";
import {
  applyScenarioBranchWatermarkToWebp,
  defaultPainterImageEncoder,
  isWebpBuffer,
} from "./helpers/webp-codec.ts";
import { recordAgenticStageTelemetry, recordStageTelemetry } from "./record-telemetry.ts";

export interface PainterTurnContext {
  lineageId: string;
  activePlate: VisualPlate | null;
  now: Date;
  startedWallMs: number;
  repository: GridlockRepository;
  imageEncoder: PainterImageEncoder;
  spanSink?: TelemetrySpanSink;
}

export type PainterMilestoneGateOutcome =
  | { shouldPaint: false; result: StatefulPainterResult }
  | {
      shouldPaint: true;
      ctx: PainterTurnContext;
      existingPlates: VisualPlate[];
      milestoneObservations: Observation[];
    };

export async function preparePainterTurn(
  input: { lineageId?: string; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder?: PainterImageEncoder; spanSink?: TelemetrySpanSink }
): Promise<{ ctx: PainterTurnContext; existingPlates: VisualPlate[] }> {
  const startedWallMs = Date.now();
  const lineageId = input.lineageId ?? DEFAULT_LINEAGE_ID;
  const now = input.now ?? new Date();
  const existingPlates = await deps.repository.listVisualPlatesByLineage(lineageId);
  const activePlate = selectActiveCanonicalPlate(existingPlates);
  return {
    ctx: {
      lineageId,
      activePlate,
      now,
      startedWallMs,
      repository: deps.repository,
      imageEncoder: deps.imageEncoder ?? defaultPainterImageEncoder,
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    },
    existingPlates,
  };
}

export async function loadObservationsByIdForPlates(
  repository: GridlockRepository,
  plates: readonly VisualPlate[]
): Promise<Map<string, Observation>> {
  const projectNumbers = Array.from(new Set(plates.flatMap((plate) => plate.projectNumbers)));
  const lists = await Promise.all(projectNumbers.map((pn) => repository.listObservationsByProject(pn)));
  return new Map(lists.flat().map((obs) => [obs.id, obs]));
}

function turnEndedAt(ctx: PainterTurnContext): Date {
  return new Date(ctx.now.getTime() + Math.max(0, Date.now() - ctx.startedWallMs));
}

function telemetryDeps(ctx: PainterTurnContext) {
  return { repository: ctx.repository, ...(ctx.spanSink !== undefined ? { spanSink: ctx.spanSink } : {}) };
}

function observationTelemetryRef(observations: readonly Observation[]) {
  const firstObs = observations[0];
  return firstObs !== undefined
    ? { projectNumber: firstObs.projectNumber, sourceArtifactHash: firstObs.sourceArtifactHash }
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
      endedAt: turnEndedAt(ctx),
      recordedAt: ctx.now.toISOString(),
      attributes: { lineageId: ctx.lineageId, candidateObservationsCount: observations.length },
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

export async function evaluatePainterMilestoneGate(
  input: { lineageId?: string; observations: readonly Observation[]; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder?: PainterImageEncoder; spanSink?: TelemetrySpanSink }
): Promise<PainterMilestoneGateOutcome> {
  const { ctx, existingPlates } = await preparePainterTurn(input, deps);
  const milestoneObservations = evaluateMilestoneObservations(input.observations, existingPlates);
  if (milestoneObservations.length === 0) {
    return { shouldPaint: false, result: await recordMilestoneSkip(ctx, input.observations) };
  }
  return { shouldPaint: true, ctx, existingPlates, milestoneObservations };
}

export async function tryCreatePainterInteraction(
  geminiClient: GeminiInteractionsClient,
  request: GeminiInteractionCreateRequest
): Promise<PainterTurnAttemptResult> {
  try {
    const interaction = await geminiClient.interactions.create(request);
    const tokensUsed = Math.max(0, interaction.usage?.total_tokens ?? 0);
    const trimmedId = interaction.id?.trim();
    if (interaction.status !== "completed") {
      return classifyNonCompletedInteraction(interaction, tokensUsed, trimmedId);
    }
    return trimmedId
      ? { ok: true, turn: { interaction: { ...interaction, id: trimmedId }, rebootstrappedFromParentWebp: false, priorTokensUsed: 0 } }
      : { ok: false, kind: "missing_id", reason: "Gemini painter interaction missing required interaction.id", diagnosticMessage: "", tokensUsed, errorCodes: [] };
  } catch (error) {
    return classifyThrownPainterError(error);
  }
}

export async function requestChainedOrFallbackPainterInteraction(params: {
  geminiClient: GeminiInteractionsClient;
  repository: GridlockRepository;
  parentPlate: VisualPlate;
  prompt: string;
}): Promise<PainterTurnAttemptResult> {
  const primary = await tryCreatePainterInteraction(params.geminiClient, {
    model: PAINTER_AGENT_MODEL,
    store: true,
    previous_interaction_id: params.parentPlate.interactionId,
    input: params.prompt,
  });
  if (primary.ok || !isExpiredOrRejectedPreviousInteraction(primary)) return primary;

  const cachedParentWebp = await params.repository.readVisualPlateWebp(params.parentPlate.plateId);
  if (!cachedParentWebp || !isWebpBuffer(cachedParentWebp)) return primary;

  const fallbackPrompt = `${params.prompt}\n[Re-bootstrapped from cached parent Visual Plate ${params.parentPlate.plateId} after previous_interaction_id ${params.parentPlate.interactionId} expired]`;
  const fallback = await tryCreatePainterInteraction(params.geminiClient, {
    model: PAINTER_AGENT_MODEL,
    store: true,
    input: buildWebpMultimodalInput(fallbackPrompt, cachedParentWebp),
  });
  if (!fallback.ok) return { ...fallback, tokensUsed: primary.tokensUsed + fallback.tokensUsed };
  return { ok: true, turn: { interaction: fallback.turn.interaction, rebootstrappedFromParentWebp: true, priorTokensUsed: primary.tokensUsed } };
}

export async function failClosedPainter(
  ctx: PainterTurnContext,
  params: { stage: PainterStage; reason: string; errorCode: PainterErrorCode; tokensUsed: number; interactionId?: string; observations: readonly Observation[] }
): Promise<StatefulPainterResult> {
  await recordAgenticStageTelemetry(
    {
      stage: params.stage,
      ...observationTelemetryRef(params.observations),
      status: "agentic_failed",
      tokensUsed: params.tokensUsed,
      ...(params.interactionId !== undefined ? { interactionId: params.interactionId } : {}),
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { lineageId: ctx.lineageId, errorCode: params.errorCode },
    },
    telemetryDeps(ctx)
  );
  return { status: "painter_failed", lineageId: ctx.lineageId, reason: params.reason, errorCode: params.errorCode, tokensUsed: params.tokensUsed, activePlate: ctx.activePlate };
}

export async function failClosedInteraction(
  ctx: PainterTurnContext,
  stage: PainterStage,
  failure: PainterInteractionFailure,
  observations: readonly Observation[]
): Promise<StatefulPainterResult> {
  return failClosedPainter(ctx, {
    stage,
    reason: failure.reason,
    errorCode: "interaction_failed",
    tokensUsed: failure.tokensUsed,
    ...(failure.interactionId !== undefined ? { interactionId: failure.interactionId } : {}),
    observations,
  });
}

async function pinMilestoneSourceArtifacts(repository: GridlockRepository, hashes: readonly string[]): Promise<void> {
  await Promise.all(
    hashes.map(async (sha256) => {
      const existing = await repository.getSourceArtifactByHash(sha256);
      if (!existing || existing.storageUri.includes("/quarantine/") || (existing.expiresAt === null && existing.referencedByMilestone)) return;
      const gz = await repository.readArtifactGzip(sha256);
      if (gz) await repository.saveSourceArtifact(SourceArtifactSchema.parse({ ...existing, referencedByMilestone: true, expiresAt: null }), gz);
    })
  );
}

export async function finalizePaintedPlateTurn(
  ctx: PainterTurnContext,
  params: VisualPlateTurnSpec & {
    operation: "bootstrapCanvas" | "paintMilestoneDelta" | "branchLineage";
    stage: PainterStage;
    turn: PainterCompletedTurn;
  }
): Promise<StatefulPainterResult> {
  const { interaction, rebootstrappedFromParentWebp, priorTokensUsed } = params.turn;
  const tokensUsed = priorTokensUsed + Math.max(0, interaction.usage?.total_tokens ?? 0);
  const interactionId = interaction.id?.trim();
  if (!interactionId) {
    return failClosedPainter(ctx, { stage: params.stage, reason: "Gemini painter interaction missing required interaction.id", errorCode: "interaction_failed", tokensUsed, observations: params.observations });
  }
  const encoded = ctx.imageEncoder(interaction.output_image);
  if (!encoded.ok) {
    return failClosedPainter(ctx, { stage: params.stage, reason: encoded.reason, errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  const finalWebp = params.isBranch
    ? applyScenarioBranchWatermarkToWebp(encoded.webpBuffer, SCENARIO_BRANCH_WATERMARK)
    : encoded.webpBuffer;
  const finalSha256 = params.isBranch ? createHash("sha256").update(finalWebp).digest("hex") : encoded.sha256;
  const plate = buildVisualPlateRecord({ ...params, rebootstrappedFromParentWebp, lineageId: ctx.lineageId, interactionId, webpBuffer: finalWebp, sha256: finalSha256, createdAt: ctx.now.toISOString() });
  await ctx.repository.saveVisualPlate(plate, finalWebp);
  if (!params.isBranch) await pinMilestoneSourceArtifacts(ctx.repository, plate.sourceArtifactHashes);
  await recordAgenticStageTelemetry(
    {
      stage: params.stage,
      ...observationTelemetryRef(params.observations),
      status: "agentic_completed",
      tokensUsed,
      interactionId,
      rawByteLength: finalWebp.byteLength,
      ...(rebootstrappedFromParentWebp ? { visualPlateCacheHitsDelta: 1 } : {}),
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { lineageId: ctx.lineageId, plateId: plate.plateId, turnNumber: plate.turnNumber, isBranch: plate.isBranch },
    },
    telemetryDeps(ctx)
  );
  return { status: "plate_painted", operation: params.operation, lineageId: ctx.lineageId, plate, webpBuffer: finalWebp, tokensUsed, rebootstrappedFromParentWebp };
}

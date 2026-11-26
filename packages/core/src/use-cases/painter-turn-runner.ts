import {
  DEFAULT_LINEAGE_ID,
  PAINTER_AGENT_MODEL,
  SCENARIO_BRANCH_WATERMARK,
  RawCaptureSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionsClient,
  type GeneratedIllustration,
  type GridlockRepository,
  type Observation,
  type PainterErrorCode,
  type PainterImageEncoder,
  type StatefulPainterResult,
  type RunSpanSink,
} from "../interfaces/index.ts";
import {
  buildGeneratedIllustrationRecord,
  buildWebpMultimodalInput,
  classifyNonCompletedInteraction,
  classifyThrownPainterError,
  evaluateMilestoneObservations,
  isExpiredOrRejectedPreviousInteraction,
  prepareFinalIllustrationWebp,
  selectActiveCanonicalIllustration,
  type GeneratedIllustrationTurnSpec,
  type PainterCompletedTurn,
  type PainterInteractionFailure,
  type PainterStage,
  type PainterTurnAttemptResult,
} from "./helpers/painter-helpers.ts";
import {
  defaultPainterImageEncoder,
  isWebpBuffer,
} from "./helpers/webp-codec.ts";
import { recordAgenticStageRun, recordStageRun } from "./record-run.ts";

export interface PainterTurnContext {
  lineageId: string;
  activeIllustration: GeneratedIllustration | null;
  now: Date;
  startedWallMs: number;
  repository: GridlockRepository;
  imageEncoder: PainterImageEncoder;
  spanSink?: RunSpanSink;
}

export type PainterMilestoneGateOutcome =
  | { shouldPaint: false; result: StatefulPainterResult }
  | {
      shouldPaint: true;
      ctx: PainterTurnContext;
      existingPlates: GeneratedIllustration[];
      milestoneObservations: Observation[];
    };

export async function preparePainterTurn(
  input: { lineageId?: string; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder?: PainterImageEncoder; spanSink?: RunSpanSink }
): Promise<{ ctx: PainterTurnContext; existingPlates: GeneratedIllustration[] }> {
  const startedWallMs = Date.now();
  const lineageId = input.lineageId ?? DEFAULT_LINEAGE_ID;
  const now = input.now ?? new Date();
  const existingPlates = await deps.repository.listGeneratedIllustrationsByTimeline(lineageId);
  const activeIllustration = selectActiveCanonicalIllustration(existingPlates);
  return {
    ctx: {
      lineageId,
      activeIllustration,
      now,
      startedWallMs,
      repository: deps.repository,
      imageEncoder: deps.imageEncoder ?? defaultPainterImageEncoder,
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    },
    existingPlates,
  };
}

function turnEndedAt(ctx: PainterTurnContext): Date {
  return new Date(ctx.now.getTime() + Math.max(0, Date.now() - ctx.startedWallMs));
}

function runRecordDeps(ctx: PainterTurnContext) {
  return { repository: ctx.repository, ...(ctx.spanSink !== undefined ? { spanSink: ctx.spanSink } : {}) };
}

function observationRunRef(observations: readonly Observation[]) {
  const firstObs = observations[0];
  return firstObs !== undefined
    ? { projectNumber: firstObs.projectNumber, rawCaptureHash: firstObs.rawCaptureHash }
    : {};
}

async function recordMilestoneSkip(
  ctx: PainterTurnContext,
  observations: readonly Observation[]
): Promise<StatefulPainterResult> {
  const { scorecard } = await recordStageRun(
    {
      stage: "painter_milestone_gate",
      ...observationRunRef(observations),
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
    runRecordDeps(ctx)
  );
  return {
    status: "skipped_no_milestone",
    lineageId: ctx.lineageId,
    tokensUsed: 0,
    imageGenerationsAvoided: scorecard.imageGenerationsAvoided,
    activeIllustration: ctx.activeIllustration,
  };
}

export async function evaluatePainterMilestoneGate(
  input: { lineageId?: string; observations: readonly Observation[]; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder?: PainterImageEncoder; spanSink?: RunSpanSink }
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
    const interaction = await geminiClient.interactions.create({
      ...request,
      response_format: request.response_format ?? { type: "image" },
    });
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
  parentPlate: GeneratedIllustration;
  prompt: string;
}): Promise<PainterTurnAttemptResult> {
  const primary = await tryCreatePainterInteraction(params.geminiClient, {
    model: PAINTER_AGENT_MODEL,
    store: true,
    previous_interaction_id: params.parentPlate.interactionId,
    input: params.prompt,
  });
  if (primary.ok || !isExpiredOrRejectedPreviousInteraction(primary)) return primary;

  const cachedParentWebp = await params.repository.readGeneratedIllustrationWebp(params.parentPlate.plateId);
  if (!cachedParentWebp || !isWebpBuffer(cachedParentWebp)) return primary;

  const fallbackPrompt = `${params.prompt}\n[Re-bootstrapped from cached parent Generated Illustration ${params.parentPlate.plateId} after previous_interaction_id ${params.parentPlate.interactionId} expired]`;
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
  await recordAgenticStageRun(
    {
      stage: params.stage,
      ...observationRunRef(params.observations),
      status: "agentic_failed",
      tokensUsed: params.tokensUsed,
      ...(params.interactionId !== undefined ? { interactionId: params.interactionId } : {}),
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { lineageId: ctx.lineageId, errorCode: params.errorCode },
    },
    runRecordDeps(ctx)
  );
  return { status: "painter_failed", lineageId: ctx.lineageId, reason: params.reason, errorCode: params.errorCode, tokensUsed: params.tokensUsed, activeIllustration: ctx.activeIllustration };
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

async function pinMilestoneRawCaptures(repository: GridlockRepository, hashes: readonly string[]): Promise<void> {
  await Promise.all(
    hashes.map(async (sha256) => {
      const existing = await repository.getRawCaptureByHash(sha256);
      if (!existing || existing.storageUri.includes("/quarantine/") || (existing.expiresAt === null && existing.referencedByMilestone)) return;
      const gz = await repository.readArtifactGzip(sha256);
      if (gz) await repository.saveRawCapture(RawCaptureSchema.parse({ ...existing, referencedByMilestone: true, expiresAt: null }), gz);
    })
  );
}

export async function finalizePaintedIllustrationTurn(
  ctx: PainterTurnContext,
  params: GeneratedIllustrationTurnSpec & {
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
  const encoded = await ctx.imageEncoder(interaction.output_image, {
    isBranch: params.isBranch,
    watermarkText: params.isBranch ? SCENARIO_BRANCH_WATERMARK : null,
  });
  if (!encoded.ok) {
    return failClosedPainter(ctx, { stage: params.stage, reason: encoded.reason, errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  const finalized = prepareFinalIllustrationWebp(encoded, params.isBranch);
  if (!isWebpBuffer(finalized.webpBuffer)) {
    return failClosedPainter(ctx, { stage: params.stage, reason: "Encoded Generated Illustration failed RIFF/WEBP bitstream validation", errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  const plate = buildGeneratedIllustrationRecord({ ...params, rebootstrappedFromParentWebp, lineageId: ctx.lineageId, interactionId, webpBuffer: finalized.webpBuffer, sha256: finalized.sha256, createdAt: ctx.now.toISOString() });
  await ctx.repository.saveGeneratedIllustration(plate, finalized.webpBuffer);
  if (finalized.pinCanonicalArtifacts) await pinMilestoneRawCaptures(ctx.repository, plate.rawCaptureHashes);
  await recordAgenticStageRun(
    {
      stage: params.stage,
      ...observationRunRef(params.observations),
      status: "agentic_completed",
      tokensUsed,
      interactionId,
      rawByteLength: finalized.webpBuffer.byteLength,
      ...(rebootstrappedFromParentWebp ? { illustrationCacheHitsDelta: 1 } : {}),
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { lineageId: ctx.lineageId, plateId: plate.plateId, turnNumber: plate.turnNumber, isBranch: plate.isBranch },
    },
    runRecordDeps(ctx)
  );
  return { status: "illustration_painted", operation: params.operation, lineageId: ctx.lineageId, illustration: plate, webpBuffer: finalized.webpBuffer, tokensUsed, rebootstrappedFromParentWebp };
}

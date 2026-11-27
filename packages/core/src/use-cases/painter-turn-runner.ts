import type { Buffer } from "node:buffer";
import {
  DEFAULT_TIMELINE_ID,
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
  hasScenarioBranchRightsXmp,
  isExpiredOrRejectedPreviousInteraction,
  selectActiveCanonicalIllustration,
  type GeneratedIllustrationTurnSpec,
  type PainterCompletedTurn,
  type PainterInteractionFailure,
  type PainterStage,
  type PainterTurnAttemptResult,
} from "./helpers/painter-helpers.ts";
import { isWebpBuffer } from "./helpers/webp-codec.ts";
import { recordAgenticStageRun, recordStageRun } from "./record-run.ts";

export interface PainterTurnContext {
  timelineId: string;
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

export function createPainterTurnContext(
  params: { timelineId: string; existingPlates: readonly GeneratedIllustration[]; now: Date; startedWallMs?: number },
  deps: { repository: GridlockRepository; imageEncoder: PainterImageEncoder; spanSink?: RunSpanSink }
): PainterTurnContext {
  return {
    timelineId: params.timelineId,
    activeIllustration: selectActiveCanonicalIllustration(params.existingPlates),
    now: params.now,
    startedWallMs: params.startedWallMs ?? Date.now(),
    repository: deps.repository,
    imageEncoder: deps.imageEncoder,
    ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
  };
}

export async function preparePainterTurn(
  input: { timelineId?: string; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder: PainterImageEncoder; spanSink?: RunSpanSink }
): Promise<{ ctx: PainterTurnContext; existingPlates: GeneratedIllustration[] }> {
  const startedWallMs = Date.now();
  const timelineId = input.timelineId ?? DEFAULT_TIMELINE_ID;
  const now = input.now ?? new Date();
  const existingPlates = await deps.repository.listGeneratedIllustrationsByTimeline(timelineId);
  return {
    ctx: createPainterTurnContext({ timelineId, existingPlates, now, startedWallMs }, deps),
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
      attributes: { timelineId: ctx.timelineId, candidateObservationsCount: observations.length },
    },
    runRecordDeps(ctx)
  );
  return {
    status: "skipped_no_milestone",
    timelineId: ctx.timelineId,
    tokensUsed: 0,
    imageGenerationsAvoided: scorecard.imageGenerationsAvoided,
    activeIllustration: ctx.activeIllustration,
  };
}

export async function evaluatePainterMilestoneGate(
  input: { timelineId?: string; observations: readonly Observation[]; now?: Date },
  deps: { repository: GridlockRepository; imageEncoder: PainterImageEncoder; spanSink?: RunSpanSink }
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

  const cachedParentWebp = await params.repository.readGeneratedIllustrationWebp(params.parentPlate.illustrationId);
  if (!cachedParentWebp || !isWebpBuffer(cachedParentWebp)) return primary;

  const fallbackPrompt = `${params.prompt}\n[Re-bootstrapped from cached parent Generated Illustration ${params.parentPlate.illustrationId} after previous_interaction_id ${params.parentPlate.interactionId} expired]`;
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
      attributes: { timelineId: ctx.timelineId, errorCode: params.errorCode },
    },
    runRecordDeps(ctx)
  );
  return { status: "painter_failed", timelineId: ctx.timelineId, reason: params.reason, errorCode: params.errorCode, tokensUsed: params.tokensUsed, activeIllustration: ctx.activeIllustration };
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

async function pinMilestoneRawCaptures(
  repository: GridlockRepository,
  hashes: readonly string[]
): Promise<void> {
  await Promise.all(
    hashes.map((sha256) =>
      repository.updateRawCaptureMetadata(sha256, (existing) => {
        if (
          existing.storageUri.includes("/quarantine/") ||
          (existing.expiresAt === null && existing.referencedByMilestone)
        ) {
          return null;
        }
        return RawCaptureSchema.parse({
          ...existing,
          referencedByMilestone: true,
          expiresAt: null,
        });
      })
    )
  );
}

export async function finalizePaintedIllustrationTurn(
  ctx: PainterTurnContext,
  params: GeneratedIllustrationTurnSpec & {
    operation: "bootstrapCanvas" | "paintMilestoneDelta" | "branchTimeline";
    stage: PainterStage;
    turn: PainterCompletedTurn;
    onCommitIllustration?: (plate: GeneratedIllustration, webpBuffer: Buffer) => Promise<void>;
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
  if (!isWebpBuffer(encoded.webpBuffer)) {
    return failClosedPainter(ctx, { stage: params.stage, reason: "Encoded Generated Illustration failed RIFF/WEBP bitstream validation", errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  if (params.isBranch && !hasScenarioBranchRightsXmp(encoded.webpBuffer)) {
    return failClosedPainter(ctx, { stage: params.stage, reason: "Encoded Scenario Branch illustration missing required XMP rights watermark metadata", errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  const plate = buildGeneratedIllustrationRecord({ ...params, rebootstrappedFromParentWebp, timelineId: ctx.timelineId, interactionId, webpBuffer: encoded.webpBuffer, sha256: encoded.sha256, createdAt: ctx.now.toISOString() });
  await (params.onCommitIllustration
    ? params.onCommitIllustration(plate, encoded.webpBuffer)
    : ctx.repository.saveGeneratedIllustration(plate, encoded.webpBuffer));
  if (!params.isBranch) await pinMilestoneRawCaptures(ctx.repository, plate.rawCaptureHashes);
  await recordAgenticStageRun(
    {
      stage: params.stage,
      ...observationRunRef(params.observations),
      status: "agentic_completed",
      tokensUsed,
      interactionId,
      rawByteLength: encoded.webpBuffer.byteLength,
      ...(rebootstrappedFromParentWebp ? { illustrationCacheHitsDelta: 1 } : {}),
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { timelineId: ctx.timelineId, illustrationId: plate.illustrationId, turnNumber: plate.turnNumber, isBranch: plate.isBranch },
    },
    runRecordDeps(ctx)
  );
  return { status: "illustration_painted", operation: params.operation, timelineId: ctx.timelineId, illustration: plate, webpBuffer: encoded.webpBuffer, tokensUsed, rebootstrappedFromParentWebp };
}

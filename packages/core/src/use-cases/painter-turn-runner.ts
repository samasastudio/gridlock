import {
  DEFAULT_LINEAGE_ID,
  SourceArtifactSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
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
  evaluateMilestoneObservations,
  selectActiveCanonicalPlate,
  type VisualPlateTurnSpec,
} from "./helpers/painter-helpers.ts";
import { defaultPainterImageEncoder } from "./helpers/webp-codec.ts";
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
): Promise<
  | { ok: true; interaction: GeminiInteractionResponse }
  | { ok: false; reason: string; tokensUsed: number; interactionId?: string }
> {
  try {
    const interaction = await geminiClient.interactions.create(request);
    const tokensUsed = Math.max(0, interaction.usage?.total_tokens ?? 0);
    const trimmedId = interaction.id?.trim();
    const idProp = trimmedId ? { interactionId: trimmedId } : {};
    if (interaction.status !== "completed") {
      return { ok: false, reason: `Gemini painter interaction returned non-completed status "${interaction.status ?? "missing"}"`, tokensUsed, ...idProp };
    }
    return trimmedId
      ? { ok: true, interaction: { ...interaction, id: trimmedId } }
      : { ok: false, reason: "Gemini painter interaction missing required interaction.id", tokensUsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Gemini painter interaction failed", tokensUsed: 0 };
  }
}

export async function failClosedPainter(
  ctx: PainterTurnContext,
  params: { stage: string; reason: string; errorCode: PainterErrorCode; tokensUsed: number; interactionId?: string; observations: readonly Observation[] }
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
  params: VisualPlateTurnSpec & { operation: "bootstrapCanvas" | "paintMilestoneDelta" | "branchLineage"; stage: string; interaction: GeminiInteractionResponse }
): Promise<StatefulPainterResult> {
  const tokensUsed = Math.max(0, params.interaction.usage?.total_tokens ?? 0);
  const interactionId = params.interaction.id?.trim();
  if (!interactionId) {
    return failClosedPainter(ctx, { stage: params.stage, reason: "Gemini painter interaction missing required interaction.id", errorCode: "interaction_failed", tokensUsed, observations: params.observations });
  }
  const encoded = ctx.imageEncoder(params.interaction.output_image);
  if (!encoded.ok) {
    return failClosedPainter(ctx, { stage: params.stage, reason: encoded.reason, errorCode: "corrupt_or_empty_image", tokensUsed, interactionId, observations: params.observations });
  }
  const plate = buildVisualPlateRecord({ ...params, lineageId: ctx.lineageId, interactionId, webpBuffer: encoded.webpBuffer, sha256: encoded.sha256, createdAt: ctx.now.toISOString() });
  await ctx.repository.saveVisualPlate(plate, encoded.webpBuffer);
  await pinMilestoneSourceArtifacts(ctx.repository, plate.sourceArtifactHashes);
  await recordAgenticStageTelemetry(
    {
      stage: params.stage,
      ...observationTelemetryRef(params.observations),
      status: "agentic_completed",
      tokensUsed,
      interactionId,
      rawByteLength: encoded.webpBuffer.byteLength,
      startedAt: ctx.now,
      endedAt: turnEndedAt(ctx),
      attributes: { lineageId: ctx.lineageId, plateId: plate.plateId, turnNumber: plate.turnNumber },
    },
    telemetryDeps(ctx)
  );
  return { status: "plate_painted", operation: params.operation, lineageId: ctx.lineageId, plate, webpBuffer: encoded.webpBuffer, tokensUsed, rebootstrappedFromParentWebp: false };
}

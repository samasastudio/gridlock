import type { Buffer } from "node:buffer";
import {
  PAINTER_AGENT_MODEL,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type Observation,
  type PainterImageEncoder,
  type StatefulPainterResult,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import {
  buildWebpMultimodalInput,
  synthesizeBootstrapPrompt,
  synthesizeMilestoneDeltaPrompt,
} from "./helpers/painter-helpers.ts";
import { createCorridorBaseCanvasWebp, isWebpBuffer } from "./helpers/webp-codec.ts";
import {
  evaluatePainterMilestoneGate,
  failClosedInteraction,
  failClosedPainter,
  finalizePaintedPlateTurn,
  requestChainedOrFallbackPainterInteraction,
  tryCreatePainterInteraction,
} from "./painter-turn-runner.ts";

export interface PainterDeps {
  repository: GridlockRepository;
  geminiClient: GeminiInteractionsClient;
  imageEncoder?: PainterImageEncoder;
  spanSink?: TelemetrySpanSink;
}

export interface BootstrapCanvasInput {
  lineageId?: string;
  observations: readonly Observation[];
  baseCanvasWebp?: Buffer;
  prompt?: string;
  now?: Date;
}

export interface PaintMilestoneDeltaInput {
  lineageId?: string;
  observations: readonly Observation[];
  prompt?: string;
  now?: Date;
}

export async function bootstrapCanvas(input: BootstrapCanvasInput, deps: PainterDeps): Promise<StatefulPainterResult> {
  const gate = await evaluatePainterMilestoneGate(input, deps);
  if (!gate.shouldPaint) return gate.result;

  const { ctx, milestoneObservations } = gate;
  if (ctx.activePlate !== null) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: `Lineage "${ctx.lineageId}" is already bootstrapped (${ctx.activePlate.plateId})`,
      errorCode: "lineage_already_bootstrapped",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const baseCanvas = input.baseCanvasWebp ?? createCorridorBaseCanvasWebp(ctx.lineageId);
  if (!isWebpBuffer(baseCanvas)) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: "Invalid baseCanvasWebp: expected a valid RIFF/WEBP image bitstream",
      errorCode: "invalid_base_canvas",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const prompt = input.prompt ?? synthesizeBootstrapPrompt(ctx.lineageId, milestoneObservations);
  const outcome = await tryCreatePainterInteraction(deps.geminiClient, {
    model: PAINTER_AGENT_MODEL,
    store: true,
    input: buildWebpMultimodalInput(prompt, baseCanvas),
  });
  if (!outcome.ok) return failClosedInteraction(ctx, "painter_bootstrap", outcome, milestoneObservations);

  return finalizePaintedPlateTurn(ctx, {
    operation: "bootstrapCanvas",
    stage: "painter_bootstrap",
    turn: outcome.turn,
    turnNumber: 1,
    parentInteractionId: null,
    parentPlateId: null,
    observations: milestoneObservations,
    prompt,
  });
}

export async function paintMilestoneDelta(
  input: PaintMilestoneDeltaInput,
  deps: PainterDeps
): Promise<StatefulPainterResult> {
  const gate = await evaluatePainterMilestoneGate(input, deps);
  if (!gate.shouldPaint) return gate.result;

  const { ctx, milestoneObservations } = gate;
  const parentPlate = ctx.activePlate;
  if (!parentPlate) {
    return failClosedPainter(ctx, {
      stage: "painter_milestone_delta",
      reason: `Canonical parent VisualPlate not found for lineage "${ctx.lineageId}"`,
      errorCode: "parent_not_found",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const prompt = input.prompt ?? synthesizeMilestoneDeltaPrompt(ctx.lineageId, parentPlate, milestoneObservations);
  const outcome = await requestChainedOrFallbackPainterInteraction({
    geminiClient: deps.geminiClient,
    repository: deps.repository,
    parentPlate,
    prompt,
  });
  if (!outcome.ok) return failClosedInteraction(ctx, "painter_milestone_delta", outcome, milestoneObservations);

  return finalizePaintedPlateTurn(ctx, {
    operation: "paintMilestoneDelta",
    stage: "painter_milestone_delta",
    turn: outcome.turn,
    turnNumber: parentPlate.turnNumber + 1,
    parentInteractionId: parentPlate.interactionId,
    parentPlateId: parentPlate.plateId,
    observations: milestoneObservations,
    prompt,
  });
}

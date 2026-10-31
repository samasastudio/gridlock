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
import { synthesizeBootstrapPrompt } from "./helpers/painter-helpers.ts";
import { createCorridorBaseCanvasWebp, isWebpBuffer } from "./helpers/webp-codec.ts";
import {
  evaluatePainterMilestoneGate,
  failClosedPainter,
  finalizePaintedPlateTurn,
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
    input: [
      { type: "text", text: prompt },
      { type: "image", mime_type: "image/webp", data: baseCanvas.toString("base64") },
    ],
  });
  if (!outcome.ok) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: outcome.reason,
      errorCode: "interaction_failed",
      tokensUsed: outcome.tokensUsed,
      ...(outcome.interactionId !== undefined ? { interactionId: outcome.interactionId } : {}),
      observations: milestoneObservations,
    });
  }

  return finalizePaintedPlateTurn(ctx, {
    operation: "bootstrapCanvas",
    stage: "painter_bootstrap",
    turnNumber: 1,
    parentInteractionId: null,
    parentPlateId: null,
    interaction: outcome.interaction,
    observations: milestoneObservations,
    prompt,
  });
}

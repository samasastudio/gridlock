import type { Buffer } from "node:buffer";
import {
  DEFAULT_LINEAGE_ID,
  DEFAULT_MAX_BRANCHES_PER_LINEAGE,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  PAINTER_AGENT_MODEL,
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
  buildWebpMultimodalInput,
  isVisualPlateActiveAt,
  synthesizeBootstrapPrompt,
  synthesizeMilestoneDeltaPrompt,
  synthesizeScenarioBranchPrompt,
} from "./helpers/painter-helpers.ts";
import { createCorridorBaseCanvasWebp, isWebpBuffer } from "./helpers/webp-codec.ts";
import {
  evaluatePainterMilestoneGate,
  failClosedInteraction,
  failClosedPainter,
  finalizePaintedPlateTurn,
  preparePainterTurn,
  requestChainedOrFallbackPainterInteraction,
  tryCreatePainterInteraction,
  type PainterTurnContext,
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

export interface BranchLineageInput {
  parentInteractionId: string;
  scenarioPrompt: string;
  lineageId?: string;
  maxBranchesPerLineage?: number;
  now?: Date;
}

async function loadObservationsForPlate(repository: GridlockRepository, plate: VisualPlate): Promise<Observation[]> {
  const lists = await Promise.all(plate.projectNumbers.map((pn) => repository.listObservationsByProject(pn)));
  const byId = new Map(lists.flat().map((obs) => [obs.id, obs]));
  return plate.triggeringObservationIds.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
}

function rejectBranchPrecondition(
  ctx: PainterTurnContext,
  errorCode: PainterErrorCode,
  reason: string
): StatefulPainterResult {
  return {
    status: "painter_failed",
    lineageId: ctx.lineageId,
    reason,
    errorCode,
    tokensUsed: 0,
    activePlate: ctx.activePlate,
  };
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
    parentPlate: null,
    isBranch: false,
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
    parentPlate,
    isBranch: false,
    observations: milestoneObservations,
    prompt,
  });
}

export async function branchLineage(input: BranchLineageInput, deps: PainterDeps): Promise<StatefulPainterResult> {
  const trimmedScenario = input.scenarioPrompt.trim();
  const parentPlate = await deps.repository.getVisualPlateByInteractionId(input.parentInteractionId);
  const lineageId = input.lineageId ?? parentPlate?.lineageId ?? DEFAULT_LINEAGE_ID;
  const { ctx, existingPlates } = await preparePainterTurn(
    { lineageId, ...(input.now !== undefined ? { now: input.now } : {}) },
    deps
  );

  if (trimmedScenario.length === 0 || trimmedScenario.length > MAX_SCENARIO_PROMPT_LENGTH) {
    return rejectBranchPrecondition(
      ctx,
      "invalid_scenario_prompt",
      `scenarioPrompt must be between 1 and ${MAX_SCENARIO_PROMPT_LENGTH} characters`
    );
  }

  if (!parentPlate || parentPlate.lineageId !== lineageId || !isVisualPlateActiveAt(parentPlate, ctx.now)) {
    return rejectBranchPrecondition(
      ctx,
      "parent_not_found",
      `Unknown or expired parent interactionId "${input.parentInteractionId}" for lineage "${lineageId}"`
    );
  }

  const maxBranches = input.maxBranchesPerLineage ?? DEFAULT_MAX_BRANCHES_PER_LINEAGE;
  const activeBranchesCount = existingPlates.filter((p) => p.isBranch && isVisualPlateActiveAt(p, ctx.now)).length;
  if (activeBranchesCount >= maxBranches) {
    return rejectBranchPrecondition(
      ctx,
      "branch_quota_exceeded",
      `Branch quota exceeded for lineage "${lineageId}" (max ${maxBranches})`
    );
  }

  const parentObservations = await loadObservationsForPlate(deps.repository, parentPlate);
  const prompt = synthesizeScenarioBranchPrompt(parentPlate, trimmedScenario);
  const outcome = await requestChainedOrFallbackPainterInteraction({
    geminiClient: deps.geminiClient,
    repository: deps.repository,
    parentPlate,
    prompt,
  });
  if (!outcome.ok) return failClosedInteraction(ctx, "painter_branch_lineage", outcome, parentObservations);

  return finalizePaintedPlateTurn(ctx, {
    operation: "branchLineage",
    stage: "painter_branch_lineage",
    turn: outcome.turn,
    parentPlate,
    observations: parentObservations,
    prompt,
    isBranch: true,
    scenarioPrompt: trimmedScenario,
    expiresAt: new Date(ctx.now.getTime() + NINETY_DAYS_MS).toISOString(),
  });
}

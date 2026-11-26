import type { Buffer } from "node:buffer";
import {
  DEFAULT_MAX_BRANCHES_PER_TIMELINE,
  DEFAULT_TIMELINE_ID,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  PAINTER_AGENT_MODEL,
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
  buildWebpMultimodalInput,
  isGeneratedIllustrationActiveAt,
  synthesizeBootstrapPrompt,
  synthesizeMilestoneDeltaPrompt,
  synthesizeScenarioBranchPrompt,
} from "./helpers/painter-helpers.ts";
import { createCorridorBaseCanvasWebp, isWebpBuffer } from "./helpers/webp-codec.ts";
import {
  countOccupiedBranchSlots,
  withTimelineBranchAdmission,
  wrapRepositoryWithBranchSlot,
} from "./timeline-branch-slots.ts";
import {
  evaluatePainterMilestoneGate,
  failClosedInteraction,
  failClosedPainter,
  finalizePaintedIllustrationTurn,
  preparePainterTurn,
  requestChainedOrFallbackPainterInteraction,
  tryCreatePainterInteraction,
  type PainterTurnContext,
} from "./painter-turn-runner.ts";

export interface PainterDeps {
  repository: GridlockRepository;
  geminiClient: GeminiInteractionsClient;
  imageEncoder?: PainterImageEncoder;
  spanSink?: RunSpanSink;
}

export interface BootstrapCanvasInput {
  timelineId?: string;
  observations: readonly Observation[];
  baseCanvasWebp?: Buffer;
  prompt?: string;
  now?: Date;
}

export interface PaintMilestoneDeltaInput {
  timelineId?: string;
  observations: readonly Observation[];
  prompt?: string;
  now?: Date;
}

export interface BranchTimelineInput {
  parentInteractionId: string;
  scenarioPrompt: string;
  timelineId?: string;
  maxBranchesPerTimeline?: number;
  now?: Date;
}

async function loadObservationsForPlate(repository: GridlockRepository, plate: GeneratedIllustration): Promise<Observation[]> {
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
    timelineId: ctx.timelineId,
    reason,
    errorCode,
    tokensUsed: 0,
    activeIllustration: ctx.activeIllustration,
  };
}

export async function bootstrapCanvas(input: BootstrapCanvasInput, deps: PainterDeps): Promise<StatefulPainterResult> {
  const gate = await evaluatePainterMilestoneGate(input, deps);
  if (!gate.shouldPaint) return gate.result;

  const { ctx, milestoneObservations } = gate;
  if (ctx.activeIllustration !== null) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: `Timeline "${ctx.timelineId}" is already bootstrapped (${ctx.activeIllustration.plateId})`,
      errorCode: "timeline_already_bootstrapped",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const baseCanvas = input.baseCanvasWebp ?? createCorridorBaseCanvasWebp(ctx.timelineId);
  if (!isWebpBuffer(baseCanvas)) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: "Invalid baseCanvasWebp: expected a valid RIFF/WEBP image bitstream",
      errorCode: "invalid_base_canvas",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const prompt = input.prompt ?? synthesizeBootstrapPrompt(ctx.timelineId, milestoneObservations);
  const outcome = await tryCreatePainterInteraction(deps.geminiClient, {
    model: PAINTER_AGENT_MODEL,
    store: true,
    input: buildWebpMultimodalInput(prompt, baseCanvas),
  });
  if (!outcome.ok) return failClosedInteraction(ctx, "painter_bootstrap", outcome, milestoneObservations);

  return finalizePaintedIllustrationTurn(ctx, {
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
  const parentPlate = ctx.activeIllustration;
  if (!parentPlate) {
    return failClosedPainter(ctx, {
      stage: "painter_milestone_delta",
      reason: `Canonical parent GeneratedIllustration not found for timeline "${ctx.timelineId}"`,
      errorCode: "parent_not_found",
      tokensUsed: 0,
      observations: milestoneObservations,
    });
  }

  const prompt = input.prompt ?? synthesizeMilestoneDeltaPrompt(ctx.timelineId, parentPlate, milestoneObservations);
  const outcome = await requestChainedOrFallbackPainterInteraction({
    geminiClient: deps.geminiClient,
    repository: deps.repository,
    parentPlate,
    prompt,
  });
  if (!outcome.ok) return failClosedInteraction(ctx, "painter_milestone_delta", outcome, milestoneObservations);

  return finalizePaintedIllustrationTurn(ctx, {
    operation: "paintMilestoneDelta",
    stage: "painter_milestone_delta",
    turn: outcome.turn,
    parentPlate,
    isBranch: false,
    observations: milestoneObservations,
    prompt,
  });
}

export async function branchTimeline(input: BranchTimelineInput, deps: PainterDeps): Promise<StatefulPainterResult> {
  const trimmedScenario = input.scenarioPrompt.trim();
  const parentPlate = await deps.repository.getGeneratedIllustrationByInteractionId(input.parentInteractionId);
  const timelineId = input.timelineId ?? parentPlate?.timelineId ?? DEFAULT_TIMELINE_ID;
  const maxBranches = input.maxBranchesPerTimeline ?? DEFAULT_MAX_BRANCHES_PER_TIMELINE;

  const admission = await withTimelineBranchAdmission(deps.repository, timelineId, async (reserve) => {
    const { ctx, existingPlates } = await preparePainterTurn(
      { timelineId, ...(input.now !== undefined ? { now: input.now } : {}) },
      deps
    );
    if (trimmedScenario.length === 0 || trimmedScenario.length > MAX_SCENARIO_PROMPT_LENGTH) {
      return {
        admitted: false as const,
        result: rejectBranchPrecondition(
          ctx,
          "invalid_scenario_prompt",
          `scenarioPrompt must be between 1 and ${MAX_SCENARIO_PROMPT_LENGTH} characters`
        ),
      };
    }
    if (!parentPlate || parentPlate.timelineId !== timelineId || !isGeneratedIllustrationActiveAt(parentPlate, ctx.now)) {
      return {
        admitted: false as const,
        result: rejectBranchPrecondition(
          ctx,
          "parent_not_found",
          `Unknown or expired parent interactionId "${input.parentInteractionId}" for timeline "${timelineId}"`
        ),
      };
    }
    if (countOccupiedBranchSlots(existingPlates, deps.repository, timelineId, ctx.now) >= maxBranches) {
      return {
        admitted: false as const,
        result: rejectBranchPrecondition(
          ctx,
          "branch_quota_exceeded",
          `Branch quota exceeded for timeline "${timelineId}" (max ${maxBranches})`
        ),
      };
    }
    return { admitted: true as const, ctx, validParent: parentPlate, slot: reserve() };
  });
  if (!admission.admitted) return admission.result;

  try {
    const parentObservations = await loadObservationsForPlate(deps.repository, admission.validParent);
    const prompt = synthesizeScenarioBranchPrompt(admission.validParent, trimmedScenario);
    const outcome = await requestChainedOrFallbackPainterInteraction({
      geminiClient: deps.geminiClient,
      repository: deps.repository,
      parentPlate: admission.validParent,
      prompt,
    });
    if (!outcome.ok) {
      await admission.slot.release();
      return failClosedInteraction(admission.ctx, "painter_branch_timeline", outcome, parentObservations);
    }

    return await finalizePaintedIllustrationTurn(
      { ...admission.ctx, repository: wrapRepositoryWithBranchSlot(deps.repository, admission.slot) },
      {
        operation: "branchTimeline",
        stage: "painter_branch_timeline",
        turn: outcome.turn,
        parentPlate: admission.validParent,
        observations: parentObservations,
        prompt,
        isBranch: true,
        scenarioPrompt: trimmedScenario,
        expiresAt: new Date(admission.ctx.now.getTime() + NINETY_DAYS_MS).toISOString(),
      }
    );
  } finally {
    await admission.slot.release();
  }
}

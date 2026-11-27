import type { Buffer } from "node:buffer";
import {
  DEFAULT_MAX_BRANCHES_PER_TIMELINE,
  DEFAULT_TIMELINE_ID,
  GeneratedIllustrationSchema,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  PAINTER_AGENT_MODEL,
  type BranchIllustrationRequest,
  type GeminiInteractionsClient,
  type GeneratedIllustration,
  type GridlockRepository,
  type Observation,
  type PainterErrorCode,
  type PainterImageEncoder,
  type StatefulPainterResult,
  type RunSpanSink,
} from "../interfaces/index.ts";
import { hydrateTimelineNodes } from "./get-frame-timeline.ts";
import {
  branchIllustrationError,
  buildBranchIllustrationResult,
  buildWebpMultimodalInput,
  isGeneratedIllustrationActiveAt,
  mapBranchPainterFailure,
  synthesizeBootstrapPrompt,
  synthesizeMilestoneDeltaPrompt,
  synthesizeScenarioBranchPrompt,
  type BranchIllustrationError,
  type BranchIllustrationResult,
} from "./helpers/painter-helpers.ts";
export type { BranchIllustrationError };
import { createCorridorBaseCanvasWebp, isWebpBuffer } from "./helpers/webp-codec.ts";
import {
  DEFAULT_TIMELINE_BRANCH_SLOT_TRACKER,
  type BranchSlotHandle,
  type TimelineBranchSlotTracker,
} from "./timeline-branch-slots.ts";
import {
  createPainterTurnContext,
  evaluatePainterMilestoneGate,
  failClosedInteraction,
  failClosedPainter,
  finalizePaintedIllustrationTurn,
  preparePainterTurn,
  requestChainedOrFallbackPainterInteraction,
  tryCreatePainterInteraction,
  type PainterTurnContext,
} from "./painter-turn-runner.ts";

export interface PainterUseCaseDeps {
  repository: GridlockRepository;
  geminiClient: GeminiInteractionsClient;
  imageEncoder: PainterImageEncoder;
  spanSink?: RunSpanSink;
  branchSlotTracker?: TimelineBranchSlotTracker;
}

export interface BranchIllustrationDeps {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  imageEncoder: PainterImageEncoder;
  spanSink?: RunSpanSink;
  branchSlotTracker?: TimelineBranchSlotTracker;
  maxBranchesPerTimeline?: number;
  now?: () => Date;
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

async function executeAdmittedBranchTurn(params: {
  ctx: PainterTurnContext;
  geminiClient: GeminiInteractionsClient;
  validParent: GeneratedIllustration;
  parentObservations: readonly Observation[];
  trimmedScenario: string;
  slot: BranchSlotHandle;
}): Promise<StatefulPainterResult> {
  try {
    const prompt = synthesizeScenarioBranchPrompt(params.validParent, params.trimmedScenario);
    const outcome = await requestChainedOrFallbackPainterInteraction({
      geminiClient: params.geminiClient,
      repository: params.ctx.repository,
      parentPlate: params.validParent,
      prompt,
    });
    if (!outcome.ok) {
      await params.slot.release();
      return failClosedInteraction(params.ctx, "painter_branch_timeline", outcome, params.parentObservations);
    }

    return await finalizePaintedIllustrationTurn(params.ctx, {
      operation: "branchTimeline",
      stage: "painter_branch_timeline",
      turn: outcome.turn,
      parentPlate: params.validParent,
      observations: params.parentObservations,
      prompt,
      isBranch: true,
      scenarioPrompt: params.trimmedScenario,
      expiresAt: new Date(params.ctx.now.getTime() + NINETY_DAYS_MS).toISOString(),
      onCommitIllustration: async (plate, webpBuffer) => {
        params.slot.markPersisting(plate.illustrationId);
        try {
          await params.ctx.repository.saveGeneratedIllustration(plate, webpBuffer);
        } finally {
          await params.slot.release();
        }
      },
    });
  } finally {
    await params.slot.release();
  }
}

export async function bootstrapCanvas(input: BootstrapCanvasInput, deps: PainterUseCaseDeps): Promise<StatefulPainterResult> {
  const gate = await evaluatePainterMilestoneGate(input, deps);
  if (!gate.shouldPaint) return gate.result;

  const { ctx, milestoneObservations } = gate;
  if (ctx.activeIllustration !== null) {
    return failClosedPainter(ctx, {
      stage: "painter_bootstrap",
      reason: `Timeline "${ctx.timelineId}" is already bootstrapped (${ctx.activeIllustration.illustrationId})`,
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
  deps: PainterUseCaseDeps
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

function checkBranchPreconditions(params: {
  trimmedScenario: string;
  parentInteractionId: string;
  parentPlate: GeneratedIllustration | null;
  timelineId: string;
  existingPlates: readonly GeneratedIllustration[];
  maxBranches: number;
  now: Date;
  slotTracker: TimelineBranchSlotTracker;
}): { ok: true; validParent: GeneratedIllustration } | { ok: false; errorCode: PainterErrorCode; reason: string } {
  if (params.trimmedScenario.length === 0 || params.trimmedScenario.length > MAX_SCENARIO_PROMPT_LENGTH) {
    return {
      ok: false,
      errorCode: "invalid_scenario_prompt",
      reason: `scenarioPrompt must be between 1 and ${MAX_SCENARIO_PROMPT_LENGTH} characters`,
    };
  }
  if (
    !params.parentPlate ||
    params.parentPlate.timelineId !== params.timelineId ||
    !isGeneratedIllustrationActiveAt(params.parentPlate, params.now)
  ) {
    return {
      ok: false,
      errorCode: "parent_not_found",
      reason: `Unknown or expired parent interactionId "${params.parentInteractionId}" for timeline "${params.timelineId}"`,
    };
  }
  if (params.slotTracker.countOccupiedBranchSlots(params.existingPlates, params.timelineId, params.now) >= params.maxBranches) {
    return {
      ok: false,
      errorCode: "branch_quota_exceeded",
      reason: `Branch quota exceeded for timeline "${params.timelineId}" (max ${params.maxBranches})`,
    };
  }
  return { ok: true, validParent: params.parentPlate };
}

export async function branchTimeline(input: BranchTimelineInput, deps: PainterUseCaseDeps): Promise<StatefulPainterResult> {
  const trimmedScenario = input.scenarioPrompt.trim();
  const parentPlate = await deps.repository.getGeneratedIllustrationByInteractionId(input.parentInteractionId);
  const timelineId = input.timelineId ?? parentPlate?.timelineId ?? DEFAULT_TIMELINE_ID;
  const maxBranches = input.maxBranchesPerTimeline ?? DEFAULT_MAX_BRANCHES_PER_TIMELINE;
  const slotTracker = deps.branchSlotTracker ?? DEFAULT_TIMELINE_BRANCH_SLOT_TRACKER;

  const admission = await slotTracker.withTimelineBranchAdmission(timelineId, async (reserve) => {
    const { ctx, existingPlates } = await preparePainterTurn(
      { timelineId, ...(input.now !== undefined ? { now: input.now } : {}) },
      deps
    );
    const check = checkBranchPreconditions({
      trimmedScenario,
      parentInteractionId: input.parentInteractionId,
      parentPlate,
      timelineId,
      existingPlates,
      maxBranches,
      now: ctx.now,
      slotTracker,
    });
    if (!check.ok) {
      return { admitted: false as const, result: rejectBranchPrecondition(ctx, check.errorCode, check.reason) };
    }
    return { admitted: true as const, ctx, validParent: check.validParent, slot: reserve() };
  });
  if (!admission.admitted) return admission.result;

  try {
    const parentObservations = await loadObservationsForPlate(deps.repository, admission.validParent);
    return await executeAdmittedBranchTurn({
      ctx: admission.ctx,
      geminiClient: deps.geminiClient,
      validParent: admission.validParent,
      parentObservations,
      trimmedScenario,
      slot: admission.slot,
    });
  } finally {
    await admission.slot.release();
  }
}

export async function branchIllustration(
  input: BranchIllustrationRequest,
  deps: BranchIllustrationDeps
): Promise<BranchIllustrationResult> {
  try {
    const startedWallMs = Date.now();
    const trimmedScenario = input.scenarioPrompt.trim();
    const parentCandidate = await deps.repository.getGeneratedIllustrationByInteractionId(input.interactionId);
    const parsedParent =
      parentCandidate !== null && parentCandidate !== undefined
        ? GeneratedIllustrationSchema.safeParse(parentCandidate)
        : null;
    if (parsedParent !== null && (!parsedParent.success || parsedParent.data.interactionId !== input.interactionId)) {
      return branchIllustrationError("illustration_branch_error", "Stored parent GeneratedIllustration failed runtime schema validation");
    }

    const candidateParent = parsedParent?.success ? parsedParent.data : null;
    const timelineId = input.timelineId ?? candidateParent?.timelineId ?? DEFAULT_TIMELINE_ID;
    const maxBranches = deps.maxBranchesPerTimeline ?? DEFAULT_MAX_BRANCHES_PER_TIMELINE;
    const now = deps.now ? deps.now() : new Date();
    const slotTracker = deps.branchSlotTracker ?? DEFAULT_TIMELINE_BRANCH_SLOT_TRACKER;

    const admission = await slotTracker.withTimelineBranchAdmission(timelineId, async (reserve) => {
      const rawTimelineIllustrations = await deps.repository.listGeneratedIllustrationsByTimeline(timelineId);
      if (!Array.isArray(rawTimelineIllustrations)) {
        return { admitted: false as const, response: branchIllustrationError("illustration_branch_error", "Stored GeneratedIllustration timeline list failed runtime schema validation") };
      }
      const parsedTimelineIllustrations = rawTimelineIllustrations.map((plate) => GeneratedIllustrationSchema.safeParse(plate));
      if (parsedTimelineIllustrations.some((result) => !result.success || result.data.timelineId !== timelineId)) {
        return { admitted: false as const, response: branchIllustrationError("illustration_branch_error", "Stored GeneratedIllustration timeline record failed runtime schema validation") };
      }
      const validTimelineIllustrations = parsedTimelineIllustrations.flatMap((result) => (result.success ? [result.data] : []));
      const check = checkBranchPreconditions({
        trimmedScenario,
        parentInteractionId: input.interactionId,
        parentPlate: candidateParent,
        timelineId,
        existingPlates: validTimelineIllustrations,
        maxBranches,
        now,
        slotTracker,
      });
      if (!check.ok) {
        return { admitted: false as const, response: mapBranchPainterFailure(check.errorCode, check.reason) };
      }
      const parentHydrated = await hydrateTimelineNodes([check.validParent], deps.repository, now);
      if (!parentHydrated.ok || !parentHydrated.nodes[0]) {
        return {
          admitted: false as const,
          response: branchIllustrationError("illustration_branch_error", parentHydrated.ok ? "Failed to hydrate parent FrameTimelineNode" : parentHydrated.message),
        };
      }
      if (!deps.geminiClient) {
        return { admitted: false as const, response: branchIllustrationError("painter_unavailable", "Stateful Painter Agent Gemini client is not configured") };
      }
      const ctx = createPainterTurnContext({ timelineId, existingPlates: validTimelineIllustrations, now, startedWallMs }, deps);
      return { admitted: true as const, ctx, validParent: check.validParent, parentNode: parentHydrated.nodes[0], geminiClient: deps.geminiClient, slot: reserve() };
    });
    if (!admission.admitted) return admission.response;

    const painterResult = await executeAdmittedBranchTurn({
      ctx: admission.ctx,
      geminiClient: admission.geminiClient,
      validParent: admission.validParent,
      parentObservations: admission.parentNode.triggeringObservations,
      trimmedScenario,
      slot: admission.slot,
    });
    return buildBranchIllustrationResult(painterResult, admission.parentNode);
  } catch (error) {
    return branchIllustrationError("illustration_branch_error", error instanceof Error ? error.message : "Failed to branch GeneratedIllustration");
  }
}

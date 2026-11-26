import {
  BranchIllustrationResponseSchema,
  DEFAULT_MAX_BRANCHES_PER_TIMELINE,
  DEFAULT_TIMELINE_ID,
  FrameTimelineNodeSchema,
  GeneratedIllustrationSchema,
  type BranchIllustrationRequest,
  type BranchIllustrationResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type PainterErrorCode,
  type PainterImageEncoder,
  type RunSpanSink,
} from "../interfaces/index.ts";
import { hydrateTimelineNodes } from "./get-frame-timeline.ts";
import { isGeneratedIllustrationActiveAt } from "./helpers/painter-helpers.ts";
import { countOccupiedBranchSlots } from "./timeline-branch-slots.ts";
import { branchTimeline } from "./run-painter-agent.ts";

export interface BranchIllustrationDeps {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  imageEncoder?: PainterImageEncoder;
  spanSink?: RunSpanSink;
  maxBranchesPerLineage?: number;
  now?: () => Date;
}

type BranchPlateError =
  | "invalid_request_body"
  | "parent_illustration_not_found"
  | "branch_quota_exceeded"
  | "painter_unavailable"
  | "painter_upstream_error"
  | "illustration_branch_error";

export type BranchIllustrationResult =
  | { ok: true; status: 201; response: BranchIllustrationResponse }
  | {
      ok: false;
      status: 400 | 404 | 429 | 500 | 502 | 503;
      error: BranchPlateError;
      message: string;
    };

const branchErr = (
  status: 400 | 404 | 429 | 500 | 502 | 503,
  error: BranchPlateError,
  message: string
): BranchIllustrationResult => ({ ok: false, status, error, message });

function mapPainterFailure(
  errorCode: PainterErrorCode,
  reason: string
): BranchIllustrationResult {
  if (
    errorCode === "interaction_failed" ||
    errorCode === "corrupt_or_empty_image"
  ) {
    return branchErr(502, "painter_upstream_error", reason);
  }
  if (errorCode === "parent_not_found") {
    return branchErr(404, "parent_illustration_not_found", reason);
  }
  if (errorCode === "branch_quota_exceeded") {
    return branchErr(429, "branch_quota_exceeded", reason);
  }
  if (errorCode === "invalid_scenario_prompt") {
    return branchErr(400, "invalid_request_body", reason);
  }
  return branchErr(500, "illustration_branch_error", reason);
}

export async function branchIllustration(
  input: BranchIllustrationRequest,
  deps: BranchIllustrationDeps
): Promise<BranchIllustrationResult> {
  try {
    const parentCandidate =
      await deps.repository.getGeneratedIllustrationByInteractionId(input.interactionId);
    const parsedParent =
      parentCandidate !== null && parentCandidate !== undefined
        ? GeneratedIllustrationSchema.safeParse(parentCandidate)
        : null;
    if (
      parsedParent !== null &&
      (!parsedParent.success ||
        parsedParent.data.interactionId !== input.interactionId)
    ) {
      return branchErr(
        500,
        "illustration_branch_error",
        "Stored parent GeneratedIllustration failed runtime schema validation"
      );
    }

    const validParent = parsedParent?.success ? parsedParent.data : null;
    const lineageId =
      input.lineageId ?? validParent?.lineageId ?? DEFAULT_TIMELINE_ID;
    const rawLineagePlates =
      await deps.repository.listGeneratedIllustrationsByTimeline(lineageId);
    if (!Array.isArray(rawLineagePlates)) {
      return branchErr(
        500,
        "illustration_branch_error",
        "Stored GeneratedIllustration timeline list failed runtime schema validation"
      );
    }

    const parsedLineage = rawLineagePlates.map((plate) =>
      GeneratedIllustrationSchema.safeParse(plate)
    );
    if (
      parsedLineage.some(
        (result) => !result.success || result.data.lineageId !== lineageId
      )
    ) {
      return branchErr(
        500,
        "illustration_branch_error",
        "Stored GeneratedIllustration timeline record failed runtime schema validation"
      );
    }

    const validLineagePlates = parsedLineage.flatMap((result) =>
      result.success ? [result.data] : []
    );
    const now = deps.now ? deps.now() : new Date();
    if (
      !validParent ||
      validParent.lineageId !== lineageId ||
      !isGeneratedIllustrationActiveAt(validParent, now)
    ) {
      return branchErr(
        404,
        "parent_illustration_not_found",
        `Unknown or expired parent interactionId "${input.interactionId}" for timeline "${lineageId}"`
      );
    }

    const maxBranches =
      deps.maxBranchesPerLineage ?? DEFAULT_MAX_BRANCHES_PER_TIMELINE;
    if (
      countOccupiedBranchSlots(validLineagePlates, deps.repository, lineageId, now) >=
      maxBranches
    ) {
      return branchErr(
        429,
        "branch_quota_exceeded",
        `Branch quota exceeded for timeline "${lineageId}" (max ${maxBranches})`
      );
    }

    const parentHydrated = await hydrateTimelineNodes(
      [validParent],
      deps.repository,
      now
    );
    if (!parentHydrated.ok || !parentHydrated.nodes[0]) {
      return branchErr(
        500,
        "illustration_branch_error",
        parentHydrated.ok
          ? "Failed to hydrate parent FrameTimelineNode"
          : parentHydrated.message
      );
    }
    if (!deps.geminiClient) {
      return branchErr(
        503,
        "painter_unavailable",
        "Stateful Painter Agent Gemini client is not configured"
      );
    }

    const painterResult = await branchTimeline(
      {
        parentInteractionId: input.interactionId,
        scenarioPrompt: input.scenarioPrompt,
        lineageId,
        ...(deps.maxBranchesPerLineage !== undefined
          ? { maxBranchesPerLineage: deps.maxBranchesPerLineage }
          : {}),
        now,
      },
      {
        repository: deps.repository,
        geminiClient: deps.geminiClient,
        ...(deps.imageEncoder !== undefined
          ? { imageEncoder: deps.imageEncoder }
          : {}),
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
    if (painterResult.status === "painter_failed") {
      return mapPainterFailure(painterResult.errorCode, painterResult.reason);
    }
    if (painterResult.status !== "illustration_painted") {
      return branchErr(
        500,
        "illustration_branch_error",
        "Unexpected Stateful Painter Agent branch state"
      );
    }

    const parentNode = parentHydrated.nodes[0];
    const branchedNode = FrameTimelineNodeSchema.safeParse({
      plate: painterResult.illustration,
      assetPath: `/api/illustrations/assets/${encodeURIComponent(painterResult.illustration.plateId)}.webp`,
      triggeringObservations: parentNode.triggeringObservations.filter((obs) =>
        painterResult.illustration.triggeringObservationIds.includes(obs.id)
      ),
      rawCaptures: parentNode.rawCaptures.filter((art) =>
        painterResult.illustration.rawCaptureHashes.includes(art.sha256)
      ),
    });
    if (!branchedNode.success) {
      return branchErr(
        500,
        "illustration_branch_error",
        "Failed to hydrate branched FrameTimelineNode"
      );
    }

    const validated = BranchIllustrationResponseSchema.safeParse({
      plate: painterResult.illustration,
      node: branchedNode.data,
      lineageId: painterResult.lineageId,
      tokensUsed: painterResult.tokensUsed,
      rebootstrappedFromParentWebp: painterResult.rebootstrappedFromParentWebp,
    });
    if (!validated.success) {
      return branchErr(
        500,
        "illustration_branch_error",
        "Branched GeneratedIllustration response failed runtime schema validation"
      );
    }

    return { ok: true, status: 201, response: validated.data };
  } catch (error) {
    return branchErr(
      500,
      "illustration_branch_error",
      error instanceof Error ? error.message : "Failed to branch GeneratedIllustration"
    );
  }
}

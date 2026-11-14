import {
  BranchPlateResponseSchema,
  DEFAULT_LINEAGE_ID,
  DEFAULT_MAX_BRANCHES_PER_LINEAGE,
  LineageNodeSchema,
  VisualPlateSchema,
  type BranchPlateRequest,
  type BranchPlateResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type PainterErrorCode,
  type PainterImageEncoder,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import { hydrateLineageNodes } from "./get-plate-lineage.ts";
import { isVisualPlateActiveAt } from "./helpers/painter-helpers.ts";
import { countOccupiedBranchSlots } from "./lineage-branch-slots.ts";
import { branchLineage } from "./run-painter-agent.ts";

export interface BranchPlateDeps {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  imageEncoder?: PainterImageEncoder;
  spanSink?: TelemetrySpanSink;
  maxBranchesPerLineage?: number;
  now?: () => Date;
}

type BranchPlateError =
  | "invalid_request_body"
  | "parent_plate_not_found"
  | "branch_quota_exceeded"
  | "painter_unavailable"
  | "painter_upstream_error"
  | "plate_branch_error";

export type BranchPlateResult =
  | { ok: true; status: 201; response: BranchPlateResponse }
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
): BranchPlateResult => ({ ok: false, status, error, message });

function mapPainterFailure(
  errorCode: PainterErrorCode,
  reason: string
): BranchPlateResult {
  if (
    errorCode === "interaction_failed" ||
    errorCode === "corrupt_or_empty_image"
  ) {
    return branchErr(502, "painter_upstream_error", reason);
  }
  if (errorCode === "parent_not_found") {
    return branchErr(404, "parent_plate_not_found", reason);
  }
  if (errorCode === "branch_quota_exceeded") {
    return branchErr(429, "branch_quota_exceeded", reason);
  }
  if (errorCode === "invalid_scenario_prompt") {
    return branchErr(400, "invalid_request_body", reason);
  }
  return branchErr(500, "plate_branch_error", reason);
}

export async function branchPlate(
  input: BranchPlateRequest,
  deps: BranchPlateDeps
): Promise<BranchPlateResult> {
  try {
    const parentCandidate =
      await deps.repository.getVisualPlateByInteractionId(input.interactionId);
    const parsedParent =
      parentCandidate !== null && parentCandidate !== undefined
        ? VisualPlateSchema.safeParse(parentCandidate)
        : null;
    if (
      parsedParent !== null &&
      (!parsedParent.success ||
        parsedParent.data.interactionId !== input.interactionId)
    ) {
      return branchErr(
        500,
        "plate_branch_error",
        "Stored parent VisualPlate failed runtime schema validation"
      );
    }

    const validParent = parsedParent?.success ? parsedParent.data : null;
    const lineageId =
      input.lineageId ?? validParent?.lineageId ?? DEFAULT_LINEAGE_ID;
    const rawLineagePlates =
      await deps.repository.listVisualPlatesByLineage(lineageId);
    if (!Array.isArray(rawLineagePlates)) {
      return branchErr(
        500,
        "plate_branch_error",
        "Stored VisualPlate lineage list failed runtime schema validation"
      );
    }

    const parsedLineage = rawLineagePlates.map((plate) =>
      VisualPlateSchema.safeParse(plate)
    );
    if (
      parsedLineage.some(
        (result) => !result.success || result.data.lineageId !== lineageId
      )
    ) {
      return branchErr(
        500,
        "plate_branch_error",
        "Stored VisualPlate lineage record failed runtime schema validation"
      );
    }

    const validLineagePlates = parsedLineage.flatMap((result) =>
      result.success ? [result.data] : []
    );
    const now = deps.now ? deps.now() : new Date();
    if (
      !validParent ||
      validParent.lineageId !== lineageId ||
      !isVisualPlateActiveAt(validParent, now)
    ) {
      return branchErr(
        404,
        "parent_plate_not_found",
        `Unknown or expired parent interactionId "${input.interactionId}" for lineage "${lineageId}"`
      );
    }

    const maxBranches =
      deps.maxBranchesPerLineage ?? DEFAULT_MAX_BRANCHES_PER_LINEAGE;
    if (
      countOccupiedBranchSlots(validLineagePlates, deps.repository, lineageId, now) >=
      maxBranches
    ) {
      return branchErr(
        429,
        "branch_quota_exceeded",
        `Branch quota exceeded for lineage "${lineageId}" (max ${maxBranches})`
      );
    }

    const parentHydrated = await hydrateLineageNodes(
      [validParent],
      deps.repository,
      now
    );
    if (!parentHydrated.ok || !parentHydrated.nodes[0]) {
      return branchErr(
        500,
        "plate_branch_error",
        parentHydrated.ok
          ? "Failed to hydrate parent LineageNode"
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

    const painterResult = await branchLineage(
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
    if (painterResult.status !== "plate_painted") {
      return branchErr(
        500,
        "plate_branch_error",
        "Unexpected Stateful Painter Agent branch state"
      );
    }

    const parentNode = parentHydrated.nodes[0];
    const branchedNode = LineageNodeSchema.safeParse({
      plate: painterResult.plate,
      assetPath: `/api/plates/assets/${encodeURIComponent(painterResult.plate.plateId)}.webp`,
      triggeringObservations: parentNode.triggeringObservations.filter((obs) =>
        painterResult.plate.triggeringObservationIds.includes(obs.id)
      ),
      sourceArtifacts: parentNode.sourceArtifacts.filter((art) =>
        painterResult.plate.sourceArtifactHashes.includes(art.sha256)
      ),
    });
    if (!branchedNode.success) {
      return branchErr(
        500,
        "plate_branch_error",
        "Failed to hydrate branched LineageNode"
      );
    }

    const validated = BranchPlateResponseSchema.safeParse({
      plate: painterResult.plate,
      node: branchedNode.data,
      lineageId: painterResult.lineageId,
      tokensUsed: painterResult.tokensUsed,
      rebootstrappedFromParentWebp: painterResult.rebootstrappedFromParentWebp,
    });
    if (!validated.success) {
      return branchErr(
        500,
        "plate_branch_error",
        "Branched VisualPlate response failed runtime schema validation"
      );
    }

    return { ok: true, status: 201, response: validated.data };
  } catch (error) {
    return branchErr(
      500,
      "plate_branch_error",
      error instanceof Error ? error.message : "Failed to branch VisualPlate"
    );
  }
}

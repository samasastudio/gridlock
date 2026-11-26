import {
  INVESTIGATION_PLANNER_MODEL,
  InvestigatePlanResponseSchema,
  PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type InvestigatePlanResponse,
  type RunSpanSink,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";
import {
  buildInvestigationPlannerPrompt,
  mapHydrationErrorToPlannerStatus,
  validatePlannerInteractionOutput,
  validatePlannerRequestInput,
  type PlannerInteractionValidationResult,
} from "./helpers/investigate-planner-prompt.ts";
import { hydrateInvestigationWorkspace } from "./hydrate-investigation-workspace.ts";
import { loadPlannerGroundingCatalog } from "./load-investigation-catalog.ts";
import { recordAgenticStageRun } from "./record-run.ts";

export type InvestigationPlannerErrorCode =
  | "invalid_request_body"
  | "planner_unavailable"
  | "planner_upstream_error"
  | "planner_unresolvable_plan"
  | "investigate_plan_error";

export interface InvestigationPlannerInput {
  query: string;
  currentAst?: UiWorkspaceAst;
  now?: Date;
}

export interface InvestigationPlannerDeps {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  spanSink?: RunSpanSink;
}

export type InvestigationPlannerResult =
  | { ok: true; status: 200; response: InvestigatePlanResponse }
  | {
      ok: false;
      status: 400 | 422 | 500 | 502 | 503;
      error: InvestigationPlannerErrorCode;
      message: string;
    };

const plannerErr = (
  status: 400 | 422 | 500 | 502 | 503,
  error: InvestigationPlannerErrorCode,
  message: string
): InvestigationPlannerResult => ({ ok: false, status, error, message });

async function executePlannerGeminiTurn(
  geminiClient: GeminiInteractionsClient,
  prompt: string
): Promise<PlannerInteractionValidationResult> {
  try {
    const interaction = await geminiClient.interactions.create({
      model: INVESTIGATION_PLANNER_MODEL,
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
      },
    });
    return validatePlannerInteractionOutput(interaction);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Gemini planner interaction request failed",
      tokensUsed: 0,
    };
  }
}

export async function runInvestigationPlanner(
  input: InvestigationPlannerInput,
  deps: InvestigationPlannerDeps
): Promise<InvestigationPlannerResult> {
  const parsedRequest = validatePlannerRequestInput(input);
  if (!parsedRequest.ok) {
    return plannerErr(400, "invalid_request_body", parsedRequest.message);
  }

  const startedWallMs = Date.now();
  const startedAt = parsedRequest.now ?? new Date();
  const catalogResult = await loadPlannerGroundingCatalog(deps.repository, startedAt);
  if (!catalogResult.ok) {
    return plannerErr(500, "investigate_plan_error", catalogResult.message);
  }

  if (!deps.geminiClient) {
    return plannerErr(
      503,
      "planner_unavailable",
      "Investigation Planner Gemini client is not configured"
    );
  }

  const hasCurrentAst = Boolean(parsedRequest.request.currentAst);
  const recordRun = async (params: {
    status: "agentic_completed" | "agentic_failed";
    tokensUsed: number;
    interactionId?: string;
    attributes: Record<string, string | number | boolean | null>;
  }): Promise<void> => {
    await recordAgenticStageRun(
      {
        stage: "investigation_planner",
        ...params,
        startedAt,
        endedAt: new Date(startedAt.getTime() + Math.max(0, Date.now() - startedWallMs)),
      },
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
  };

  const failTurn = async (params: {
    status: 422 | 500 | 502;
    error: InvestigationPlannerErrorCode;
    message: string;
    tokensUsed: number;
    interactionId?: string;
    hydrateError?: HydrateWorkspaceErrorCode;
  }): Promise<InvestigationPlannerResult> => {
    try {
      await recordRun({
        status: "agentic_failed",
        tokensUsed: params.tokensUsed,
        ...(params.interactionId !== undefined ? { interactionId: params.interactionId } : {}),
        attributes: {
          errorCode: params.error,
          ...(params.hydrateError !== undefined ? { hydrateError: params.hydrateError } : {}),
          hasCurrentAst,
        },
      });
    } catch {
      // Preserve planner error response if repository run-record persistence fails.
    }
    return plannerErr(params.status, params.error, params.message);
  };

  const prompt = buildInvestigationPlannerPrompt({
    query: parsedRequest.request.query,
    catalog: catalogResult.catalog,
    ...(parsedRequest.request.currentAst !== undefined
      ? { currentAst: parsedRequest.request.currentAst }
      : {}),
  });
  const validated = await executePlannerGeminiTurn(deps.geminiClient, prompt);
  if (!validated.ok) {
    return failTurn({
      status: 502,
      error: "planner_upstream_error",
      message: validated.message,
      tokensUsed: validated.tokensUsed,
      ...(validated.interactionId !== undefined ? { interactionId: validated.interactionId } : {}),
    });
  }

  const hydrated = await hydrateInvestigationWorkspace(
    validated.spec,
    { repository: deps.repository },
    { now: startedAt }
  );
  if (!hydrated.ok) {
    return failTurn({
      ...mapHydrationErrorToPlannerStatus(hydrated.error),
      message: hydrated.message,
      tokensUsed: validated.tokensUsed,
      interactionId: validated.interactionId,
      hydrateError: hydrated.error,
    });
  }

  const parsedResponse = InvestigatePlanResponseSchema.safeParse({
    workspace: hydrated.workspace,
    interactionId: validated.interactionId,
    tokensUsed: validated.tokensUsed,
  });
  if (!parsedResponse.success) {
    return failTurn({
      status: 500,
      error: "investigate_plan_error",
      message: "InvestigatePlanResponse failed runtime schema validation",
      tokensUsed: validated.tokensUsed,
      interactionId: validated.interactionId,
    });
  }

  try {
    await recordRun({
      status: "agentic_completed",
      tokensUsed: validated.tokensUsed,
      interactionId: validated.interactionId,
      attributes: {
        nodeCount: parsedResponse.data.workspace.nodes.length,
        isEmpty: parsedResponse.data.workspace.isEmpty,
        hasCurrentAst,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return plannerErr(
      500,
      "investigate_plan_error",
      `Failed to persist investigation_planner run record: ${detail}`
    );
  }

  return { ok: true, status: 200, response: parsedResponse.data };
}

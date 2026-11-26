import {
  InvestigatePlanResponseSchema,
  ORCHESTRATION_LAYOUT_SPEC_JSON_SCHEMA,
  UI_ORCHESTRATION_AGENT_MODEL,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type InvestigatePlanResponse,
  type RunSpanSink,
  type WorkspaceLayout,
} from "../interfaces/index.ts";
import {
  buildUiOrchestrationPrompt,
  mapHydrationErrorToOrchestrationStatus,
  validateOrchestrationInteractionOutput,
  validateOrchestrationRequestInput,
  type OrchestrationInteractionValidationResult,
} from "./helpers/investigate-orchestration-prompt.ts";
import { hydrateInvestigationWorkspace } from "./hydrate-investigation-workspace.ts";
import { loadOrchestrationGroundingCatalog } from "./load-investigation-catalog.ts";
import { recordAgenticStageRun } from "./record-run.ts";

export type UiOrchestrationAgentErrorCode =
  | "invalid_request_body"
  | "orchestration_unavailable"
  | "orchestration_upstream_error"
  | "orchestration_unresolvable_layout"
  | "investigate_plan_error";

export interface UiOrchestrationAgentInput {
  query: string;
  currentLayout?: WorkspaceLayout;
  now?: Date;
}

export interface UiOrchestrationAgentDeps {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  spanSink?: RunSpanSink;
}

export type UiOrchestrationAgentResult =
  | { ok: true; status: 200; response: InvestigatePlanResponse }
  | {
      ok: false;
      status: 400 | 422 | 500 | 502 | 503;
      error: UiOrchestrationAgentErrorCode;
      message: string;
    };

const orchestrationErr = (
  status: 400 | 422 | 500 | 502 | 503,
  error: UiOrchestrationAgentErrorCode,
  message: string
): UiOrchestrationAgentResult => ({ ok: false, status, error, message });

async function executeOrchestrationGeminiTurn(
  geminiClient: GeminiInteractionsClient,
  prompt: string
): Promise<OrchestrationInteractionValidationResult> {
  try {
    const interaction = await geminiClient.interactions.create({
      model: UI_ORCHESTRATION_AGENT_MODEL,
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: ORCHESTRATION_LAYOUT_SPEC_JSON_SCHEMA,
      },
    });
    return validateOrchestrationInteractionOutput(interaction);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Gemini UI orchestration interaction request failed",
      tokensUsed: 0,
    };
  }
}

export async function runUiOrchestrationAgent(
  input: UiOrchestrationAgentInput,
  deps: UiOrchestrationAgentDeps
): Promise<UiOrchestrationAgentResult> {
  const parsedRequest = validateOrchestrationRequestInput(input);
  if (!parsedRequest.ok) {
    return orchestrationErr(400, "invalid_request_body", parsedRequest.message);
  }

  const startedWallMs = Date.now();
  const startedAt = parsedRequest.now ?? new Date();
  const catalogResult = await loadOrchestrationGroundingCatalog(deps.repository, startedAt);
  if (!catalogResult.ok) {
    return orchestrationErr(500, "investigate_plan_error", catalogResult.message);
  }

  if (!deps.geminiClient) {
    return orchestrationErr(
      503,
      "orchestration_unavailable",
      "UI Orchestration Agent Gemini client is not configured"
    );
  }

  const hasCurrentLayout = Boolean(parsedRequest.request.currentLayout);
  const recordRun = async (params: {
    status: "agentic_completed" | "agentic_failed";
    tokensUsed: number;
    interactionId?: string;
    attributes: Record<string, string | number | boolean | null>;
  }): Promise<void> => {
    await recordAgenticStageRun(
      {
        stage: "ui_orchestration_agent",
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
    error: UiOrchestrationAgentErrorCode;
    message: string;
    tokensUsed: number;
    interactionId?: string;
    hydrateError?: HydrateWorkspaceErrorCode;
  }): Promise<UiOrchestrationAgentResult> => {
    try {
      await recordRun({
        status: "agentic_failed",
        tokensUsed: params.tokensUsed,
        ...(params.interactionId !== undefined ? { interactionId: params.interactionId } : {}),
        attributes: {
          errorCode: params.error,
          ...(params.hydrateError !== undefined ? { hydrateError: params.hydrateError } : {}),
          hasCurrentLayout,
        },
      });
    } catch {
      // Preserve orchestration error response if repository run-record persistence fails.
    }
    return orchestrationErr(params.status, params.error, params.message);
  };

  const prompt = buildUiOrchestrationPrompt({
    query: parsedRequest.request.query,
    catalog: catalogResult.catalog,
    ...(parsedRequest.request.currentLayout !== undefined
      ? { currentLayout: parsedRequest.request.currentLayout }
      : {}),
  });
  const validated = await executeOrchestrationGeminiTurn(deps.geminiClient, prompt);
  if (!validated.ok) {
    return failTurn({
      status: 502,
      error: "orchestration_upstream_error",
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
      ...mapHydrationErrorToOrchestrationStatus(hydrated.error),
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
        hasCurrentLayout,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return orchestrationErr(
      500,
      "investigate_plan_error",
      `Failed to persist ui_orchestration_agent run record: ${detail}`
    );
  }

  return { ok: true, status: 200, response: parsedResponse.data };
}

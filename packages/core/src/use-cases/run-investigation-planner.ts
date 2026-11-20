import {
  INVESTIGATION_PLANNER_MODEL,
  InvestigatePlanResponseSchema,
  PLANNER_LAYOUT_SPEC_JSON_SCHEMA,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type InvestigatePlanResponse,
  type TelemetrySpanSink,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";
import {
  buildInvestigationPlannerPrompt,
  validatePlannerInteractionOutput,
  validatePlannerRequestInput,
  type InitialPlannerProjectCatalog,
  type PlannerInteractionValidationResult,
} from "./helpers/investigate-planner-prompt.ts";
import { sanitizeAstProse } from "./helpers/investigate-provenance.ts";
import { hydrateInvestigationWorkspace } from "./hydrate-investigation-workspace.ts";
import { recordAgenticStageTelemetry } from "./record-telemetry.ts";

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
  spanSink?: TelemetrySpanSink;
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

async function loadInitialProjectCatalog(
  repository: GridlockRepository
): Promise<InitialPlannerProjectCatalog> {
  const projects = await repository.listProjects();
  return {
    projects: projects.map((project) => ({
      projectNumber: project.projectNumber,
      projectName: sanitizeAstProse(project.projectName),
      facilityName: sanitizeAstProse(project.facilityName),
      ownerName: sanitizeAstProse(project.ownerName),
      county: sanitizeAstProse(project.county),
      currentStatus: sanitizeAstProse(project.currentStatus),
      estimatedCostUsd: project.estimatedCostUsd,
      squareFootage: project.squareFootage,
      updatedAt: project.updatedAt,
    })),
  };
}

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

  if (!deps.geminiClient) {
    return plannerErr(
      503,
      "planner_unavailable",
      "Investigation Planner Gemini client is not configured"
    );
  }

  const startedWallMs = Date.now();
  const startedAt = parsedRequest.now ?? new Date();
  const catalog = await loadInitialProjectCatalog(deps.repository);
  const prompt = buildInvestigationPlannerPrompt({
    query: parsedRequest.request.query,
    catalog,
  });

  const validated = await executePlannerGeminiTurn(deps.geminiClient, prompt);
  if (!validated.ok) {
    return plannerErr(502, "planner_upstream_error", validated.message);
  }

  const hydrated = await hydrateInvestigationWorkspace(
    validated.spec,
    { repository: deps.repository },
    { now: startedAt }
  );
  if (!hydrated.ok) {
    return plannerErr(422, "planner_unresolvable_plan", hydrated.message);
  }

  const parsedResponse = InvestigatePlanResponseSchema.parse({
    workspace: hydrated.workspace,
    interactionId: validated.interactionId,
    tokensUsed: validated.tokensUsed,
  });

  await recordAgenticStageTelemetry(
    {
      stage: "investigation_planner",
      status: "agentic_completed",
      tokensUsed: validated.tokensUsed,
      interactionId: validated.interactionId,
      attributes: {
        nodeCount: parsedResponse.workspace.nodes.length,
        isEmpty: parsedResponse.workspace.isEmpty,
        hasCurrentAst: Boolean(parsedRequest.request.currentAst),
      },
      startedAt,
      endedAt: new Date(startedAt.getTime() + Math.max(0, Date.now() - startedWallMs)),
    },
    {
      repository: deps.repository,
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    }
  );

  return { ok: true, status: 200, response: parsedResponse };
}

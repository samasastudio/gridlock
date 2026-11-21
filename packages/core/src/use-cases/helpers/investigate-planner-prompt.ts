import {
  InvestigatePlanRequestSchema,
  MAX_PROJECTS_PER_CARD,
  MAX_WORKSPACE_NODES,
  PlannerLayoutSpecSchema,
  type GeminiInteractionResponse,
  type InvestigatePlanRequest,
  type PlannerLayoutSpec,
} from "../../interfaces/index.ts";
import type { PlannerGroundingCatalog } from "./investigate-planner-catalog.ts";

export type PlannerInteractionValidationResult =
  | { ok: true; spec: PlannerLayoutSpec; interactionId: string; tokensUsed: number }
  | { ok: false; message: string; tokensUsed: number; interactionId?: string };

function tryParseJsonPayload(
  rawText: string
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch {
    return { ok: false, message: "Malformed JSON returned from Investigation Planner" };
  }
}

export function validatePlannerRequestInput(
  input: unknown
):
  | { ok: true; request: InvestigatePlanRequest; now?: Date }
  | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "Invalid investigation plan request" };
  }
  const { now: rawNow, ...requestFields } = input as Record<string, unknown>;
  const parsed = InvestigatePlanRequestSchema.safeParse(requestFields);
  if (!parsed.success) {
    return { ok: false, message: "Invalid investigation plan request" };
  }
  return {
    ok: true,
    request: parsed.data,
    ...(rawNow instanceof Date ? { now: rawNow } : {}),
  };
}

export function buildInvestigationPlannerPrompt(input: {
  query: string;
  catalog: PlannerGroundingCatalog;
}): string {
  return JSON.stringify({
    task: "Plan a bounded Gridlock UI AST workspace layout matching the civic researcher query.",
    rules: [
      `Emit JSON matching { "nodes": [...] } with 0 to ${MAX_WORKSPACE_NODES} unique nodeId strings.`,
      `Component keys: ProjectDossierCard requires projectNumber; ObservationTimeline and MetricComparisonTable require 1 to ${MAX_PROJECTS_PER_CARD} unique projectNumbers; VisualPlateScrubber requires lineageId and optional initialPlateId; ConnectorHealthCard requires connectorId.`,
      "Reference only verified identifiers present in catalog; select ObservationTimeline only for projects with timelineHydratable === true.",
      'Return { "nodes": [] } when no catalog records match query.',
    ],
    query: input.query,
    catalog: input.catalog,
  });
}

export function validatePlannerInteractionOutput(
  interaction: GeminiInteractionResponse
): PlannerInteractionValidationResult {
  const rawTokens = interaction.usage?.total_tokens;
  const tokensUsed =
    typeof rawTokens === "number" && Number.isFinite(rawTokens)
      ? Math.max(0, Math.trunc(rawTokens))
      : 0;
  const trimmedId = interaction.id?.trim();

  if (
    (interaction.status !== undefined && interaction.status !== "completed") ||
    !trimmedId ||
    !interaction.output_text ||
    interaction.output_text.trim().length === 0
  ) {
    return {
      ok: false,
      message: "Gemini planner interaction did not return a completed JSON payload",
      tokensUsed,
      ...(trimmedId ? { interactionId: trimmedId } : {}),
    };
  }

  const parsedJson = tryParseJsonPayload(interaction.output_text);
  if (!parsedJson.ok) {
    return { ok: false, message: parsedJson.message, tokensUsed, interactionId: trimmedId };
  }

  const parsedSpec = PlannerLayoutSpecSchema.safeParse(parsedJson.value);
  if (!parsedSpec.success) {
    return {
      ok: false,
      message: "PlannerLayoutSpec failed schema validation",
      tokensUsed,
      interactionId: trimmedId,
    };
  }

  return { ok: true, spec: parsedSpec.data, interactionId: trimmedId, tokensUsed };
}

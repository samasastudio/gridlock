import {
  InvestigatePlanRequestSchema,
  MAX_PROJECTS_PER_CARD,
  MAX_WORKSPACE_NODES,
  OrchestrationLayoutSpecSchema,
  type GeminiInteractionResponse,
  type HydrateWorkspaceErrorCode,
  type InvestigatePlanRequest,
  type OrchestrationLayoutSpec,
  type WorkspaceCardNode,
  type WorkspaceLayout,
} from "../../interfaces/index.ts";
import type { OrchestrationGroundingCatalog } from "./investigate-orchestration-catalog.ts";

type CompactWorkspaceNodeSummary =
  | {
      nodeId: string;
      component: "ProjectDossierCard";
      projectNumber: string;
    }
  | {
      nodeId: string;
      component: "ObservationTimeline";
      projectNumbers: readonly string[];
    }
  | {
      nodeId: string;
      component: "MetricComparisonTable";
      projectNumbers: readonly string[];
    }
  | {
      nodeId: string;
      component: "FrameTimelineScrubber";
      lineageId: string;
      initialPlateId?: string;
    }
  | {
      nodeId: string;
      component: "ConnectorHealthCard";
      connectorId: string;
    };

interface CompactWorkspaceSummary {
  isEmpty: boolean;
  nodes: readonly CompactWorkspaceNodeSummary[];
}

export type OrchestrationInteractionValidationResult =
  | { ok: true; spec: OrchestrationLayoutSpec; interactionId: string; tokensUsed: number }
  | { ok: false; message: string; tokensUsed: number; interactionId?: string };

function tryParseJsonPayload(
  rawText: string
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch {
    return { ok: false, message: "Malformed JSON returned from UI Orchestration Agent" };
  }
}

export function validateOrchestrationRequestInput(
  input: unknown
):
  | { ok: true; request: InvestigatePlanRequest; now?: Date }
  | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      message: "Invalid investigation plan request: expected an object",
    };
  }
  const { now: rawNow, ...requestFields } = input as Record<string, unknown>;
  if (
    rawNow !== undefined &&
    (!(rawNow instanceof Date) || Number.isNaN(rawNow.getTime()))
  ) {
    return {
      ok: false,
      message: "Invalid investigation plan request: now must be a valid Date",
    };
  }
  const parsed = InvestigatePlanRequestSchema.safeParse(requestFields);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue ? `: ${firstIssue.message}` : "";
    return { ok: false, message: `Invalid investigation plan request${detail}` };
  }
  return {
    ok: true,
    request: parsed.data,
    ...(rawNow instanceof Date ? { now: rawNow } : {}),
  };
}

export function mapHydrationErrorToOrchestrationStatus(error: HydrateWorkspaceErrorCode): {
  status: 422 | 500 | 502;
  error:
    | "orchestration_upstream_error"
    | "orchestration_unresolvable_layout"
    | "investigate_plan_error";
} {
  if (error === "invalid_layout_spec") {
    return { status: 502, error: "orchestration_upstream_error" };
  }
  if (error === "entity_not_found" || error === "unresolvable_provenance") {
    return { status: 422, error: "orchestration_unresolvable_layout" };
  }
  return { status: 500, error: "investigate_plan_error" };
}

function summarizeWorkspaceNode(node: WorkspaceCardNode): CompactWorkspaceNodeSummary {
  switch (node.component) {
    case "ProjectDossierCard":
      return {
        nodeId: node.nodeId,
        component: node.component,
        projectNumber: node.citedProject.project.projectNumber,
      };
    case "ObservationTimeline":
      return {
        nodeId: node.nodeId,
        component: node.component,
        projectNumbers: node.projectNumbers,
      };
    case "MetricComparisonTable":
      return {
        nodeId: node.nodeId,
        component: node.component,
        projectNumbers: node.rows.map((row) => row.project.projectNumber),
      };
    case "FrameTimelineScrubber":
      return {
        nodeId: node.nodeId,
        component: node.component,
        lineageId: node.timeline.lineageId,
        ...(node.initialPlateId !== undefined
          ? { initialPlateId: node.initialPlateId }
          : {}),
      };
    case "ConnectorHealthCard":
      return {
        nodeId: node.nodeId,
        component: node.component,
        connectorId: node.changelog.connectorId,
      };
  }
}

function summarizeCurrentWorkspaceLayout(
  currentLayout: WorkspaceLayout
): CompactWorkspaceSummary {
  return {
    isEmpty: currentLayout.isEmpty,
    nodes: currentLayout.nodes.map(summarizeWorkspaceNode),
  };
}

export function buildUiOrchestrationPrompt(input: {
  query: string;
  catalog: OrchestrationGroundingCatalog;
  currentLayout?: WorkspaceLayout;
}): string {
  const refinementRules =
    input.currentLayout !== undefined
      ? [
          "Refine currentWorkspace in place: preserve existing nodeId values for retained or updated cards, add, remove, reorder, or filter nodes as requested by query, and drop any entity no longer present in catalog.",
        ]
      : [];
  return JSON.stringify({
    task: "Plan a bounded Gridlock Workspace Layout matching the civic researcher query.",
    rules: [
      `Emit JSON matching { "nodes": [...] } with 0 to ${MAX_WORKSPACE_NODES} unique nodeId strings.`,
      `Component keys: ProjectDossierCard requires projectNumber; ObservationTimeline and MetricComparisonTable require 1 to ${MAX_PROJECTS_PER_CARD} unique projectNumbers; FrameTimelineScrubber requires lineageId and optional initialPlateId; ConnectorHealthCard requires connectorId.`,
      "Reference only verified identifiers present in catalog; select ObservationTimeline only for projects with timelineHydratable === true.",
      'Return { "nodes": [] } when no catalog records match query.',
      ...refinementRules,
    ],
    query: input.query,
    ...(input.currentLayout !== undefined
      ? { currentWorkspace: summarizeCurrentWorkspaceLayout(input.currentLayout) }
      : {}),
    catalog: input.catalog,
  });
}

export function validateOrchestrationInteractionOutput(
  interaction: GeminiInteractionResponse
): OrchestrationInteractionValidationResult {
  const rawTokens = interaction.usage?.total_tokens;
  const tokensUsed =
    typeof rawTokens === "number" && Number.isFinite(rawTokens)
      ? Math.max(0, Math.trunc(rawTokens))
      : 0;
  const trimmedId = interaction.id?.trim();
  const idPatch = trimmedId ? { interactionId: trimmedId } : {};

  if (interaction.status !== undefined && interaction.status !== "completed") {
    const diagnostic = (interaction.errors ?? [])
      .flatMap((err) => (err.message ? [err.message] : []))
      .join("; ");
    const suffix = diagnostic.length > 0 ? `: ${diagnostic}` : "";
    return {
      ok: false,
      message: `Gemini UI orchestration interaction returned non-completed status "${interaction.status}"${suffix}`,
      tokensUsed,
      ...idPatch,
    };
  }

  if (!trimmedId) {
    return {
      ok: false,
      message: "Gemini UI orchestration interaction returned missing or empty interaction id",
      tokensUsed,
    };
  }

  if (!interaction.output_text || interaction.output_text.trim().length === 0) {
    return {
      ok: false,
      message: "Gemini UI orchestration interaction returned empty output_text",
      tokensUsed,
      interactionId: trimmedId,
    };
  }

  const parsedJson = tryParseJsonPayload(interaction.output_text);
  if (!parsedJson.ok) {
    return { ok: false, message: parsedJson.message, tokensUsed, interactionId: trimmedId };
  }

  const parsedSpec = OrchestrationLayoutSpecSchema.safeParse(parsedJson.value);
  if (!parsedSpec.success) {
    const firstIssue = parsedSpec.error.issues[0];
    const detail = firstIssue ? `: ${firstIssue.message}` : "";
    return {
      ok: false,
      message: `OrchestrationLayoutSpec failed schema validation${detail}`,
      tokensUsed,
      interactionId: trimmedId,
    };
  }

  return { ok: true, spec: parsedSpec.data, interactionId: trimmedId, tokensUsed };
}

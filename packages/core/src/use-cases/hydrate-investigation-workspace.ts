import {
  PlannerLayoutSpecSchema,
  UiWorkspaceAstSchema,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";

export interface HydrateInvestigationWorkspaceOptions {
  now?: Date;
}

export interface HydrateInvestigationWorkspaceDeps {
  repository: Pick<
    GridlockRepository,
    | "getProjectByNumber"
    | "getSourceArtifactByHash"
    | "listObservationsByProject"
    | "listVisualPlatesByLineage"
    | "getActiveConnectorConfig"
    | "listRepairChangelog"
    | "getEfficiencyLedger"
  >;
}

export type HydrateWorkspaceResult =
  | { ok: true; workspace: UiWorkspaceAst }
  | { ok: false; error: HydrateWorkspaceErrorCode; message: string };

export async function hydrateInvestigationWorkspace(
  layoutInput: unknown,
  _deps: HydrateInvestigationWorkspaceDeps,
  options: HydrateInvestigationWorkspaceOptions = {}
): Promise<HydrateWorkspaceResult> {
  const now = options.now ?? new Date();
  const parsedSpec = PlannerLayoutSpecSchema.safeParse(layoutInput);
  if (!parsedSpec.success) {
    const firstIssue = parsedSpec.error.issues[0];
    const detail = firstIssue ? `: ${firstIssue.message}` : "";
    return {
      ok: false,
      error: "invalid_layout_spec",
      message: `PlannerLayoutSpec failed schema validation${detail}`,
    };
  }

  if (parsedSpec.data.nodes.length === 0) {
    const emptyParsed = UiWorkspaceAstSchema.safeParse({
      version: 1,
      generatedAt: now.toISOString(),
      isEmpty: true,
      nodes: [],
    });
    return emptyParsed.success
      ? { ok: true, workspace: emptyParsed.data }
      : {
          ok: false,
          error: "repository_integrity_error",
          message: "Empty UiWorkspaceAst failed runtime schema validation",
        };
  }

  return {
    ok: false,
    error: "invalid_layout_spec",
    message: `Unsupported card component "${parsedSpec.data.nodes[0]?.component ?? "unknown"}"`,
  };
}

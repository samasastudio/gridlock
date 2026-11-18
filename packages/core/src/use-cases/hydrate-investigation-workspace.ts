import {
  PlannerLayoutSpecSchema,
  UiWorkspaceAstSchema,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";
import {
  buildCitedProjectsByNumber,
  buildProjectDossierCardNode,
} from "./helpers/investigate-hydrator.ts";
import {
  stepFailure,
  validateStoredArtifacts,
  validateStoredProjects,
} from "./helpers/investigate-provenance.ts";

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
  deps: HydrateInvestigationWorkspaceDeps,
  options: HydrateInvestigationWorkspaceOptions = {}
): Promise<HydrateWorkspaceResult> {
  const now = options.now ?? new Date();
  const parsedSpec = PlannerLayoutSpecSchema.safeParse(layoutInput);
  if (!parsedSpec.success) {
    const firstIssue = parsedSpec.error.issues[0];
    const detail = firstIssue ? `: ${firstIssue.message}` : "";
    return stepFailure(
      "invalid_layout_spec",
      `PlannerLayoutSpec failed schema validation${detail}`
    );
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
      : stepFailure(
          "repository_integrity_error",
          "Empty UiWorkspaceAst failed runtime schema validation"
        );
  }

  const unsupported = parsedSpec.data.nodes.find(
    (node) => node.component !== "ProjectDossierCard"
  );
  if (unsupported) {
    return stepFailure(
      "invalid_layout_spec",
      `Unsupported card component "${unsupported.component}"`
    );
  }

  try {
    const dossierNodes = parsedSpec.data.nodes.flatMap((node) =>
      node.component === "ProjectDossierCard" ? [node] : []
    );
    const uniqueProjectNumbers = Array.from(
      new Set(dossierNodes.map((node) => node.projectNumber))
    );

    const rawProjects = await Promise.all(
      uniqueProjectNumbers.map(async (projectNumber) => ({
        projectNumber,
        raw: await deps.repository.getProjectByNumber(projectNumber),
      }))
    );

    const projectsResult = validateStoredProjects(rawProjects);
    if (!projectsResult.ok) {
      return projectsResult;
    }

    const uniqueArtifactHashes = Array.from(
      new Set(
        uniqueProjectNumbers.flatMap((projectNumber) => {
          const project = projectsResult.projectsByNumber.get(projectNumber);
          return project ? [project.latestSourceArtifactHash] : [];
        })
      )
    );

    const rawArtifacts = await Promise.all(
      uniqueArtifactHashes.map(async (sha256) => ({
        sha256,
        raw: await deps.repository.getSourceArtifactByHash(sha256),
      }))
    );

    const artifactsResult = validateStoredArtifacts(rawArtifacts);
    if (!artifactsResult.ok) {
      return artifactsResult;
    }

    const citedResult = buildCitedProjectsByNumber(
      uniqueProjectNumbers,
      projectsResult.projectsByNumber,
      artifactsResult.artifactsByHash,
      now.getTime()
    );
    if (!citedResult.ok) {
      return citedResult;
    }

    const nodeOutcomes = dossierNodes.map((specNode) =>
      buildProjectDossierCardNode(
        specNode.nodeId,
        specNode.projectNumber,
        citedResult.citedByNumber
      )
    );
    const failedNode = nodeOutcomes.find((outcome) => !outcome.ok);
    if (failedNode && !failedNode.ok) {
      return failedNode;
    }

    const parsedWorkspace = UiWorkspaceAstSchema.safeParse({
      version: 1,
      generatedAt: now.toISOString(),
      isEmpty: false,
      nodes: nodeOutcomes.flatMap((outcome) =>
        outcome.ok ? [outcome.node] : []
      ),
    });
    return parsedWorkspace.success
      ? { ok: true, workspace: parsedWorkspace.data }
      : stepFailure(
          "repository_integrity_error",
          "Hydrated UiWorkspaceAst failed runtime schema validation"
        );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return stepFailure(
      "repository_integrity_error",
      `Repository lookup failed during UI AST hydration: ${detail}`
    );
  }
}

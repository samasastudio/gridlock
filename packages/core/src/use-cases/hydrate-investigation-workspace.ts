import {
  PlannerLayoutSpecSchema,
  UiWorkspaceAstSchema,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type UiWidgetNode,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";
import {
  buildCitedProjectsByNumber,
  buildMetricComparisonTableNode,
  buildObservationTimelineNode,
  buildProjectDossierCardNode,
  collectReferencedArtifactHashes,
} from "./helpers/investigate-hydrator.ts";
import {
  stepFailure,
  validateStoredArtifacts,
  validateStoredObservationsByProject,
  validateStoredProjects,
  type HydratorStepFailure,
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
    (node) =>
      node.component === "VisualPlateScrubber" ||
      node.component === "ConnectorHealthCard"
  );
  if (unsupported) {
    return stepFailure(
      "invalid_layout_spec",
      `Unsupported card component "${unsupported.component}"`
    );
  }

  try {
    const uniqueCitedProjectNumbers = Array.from(
      new Set(
        parsedSpec.data.nodes.flatMap((node) => {
          if (node.component === "ProjectDossierCard") {
            return [node.projectNumber];
          }
          if (node.component === "MetricComparisonTable") {
            return node.projectNumbers;
          }
          return [];
        })
      )
    );
    const uniqueTimelineProjectNumbers = Array.from(
      new Set(
        parsedSpec.data.nodes.flatMap((node) =>
          node.component === "ObservationTimeline" ? node.projectNumbers : []
        )
      )
    );
    const uniqueProjectNumbers = Array.from(
      new Set([...uniqueCitedProjectNumbers, ...uniqueTimelineProjectNumbers])
    );

    const [rawProjects, rawObservationsByProject] = await Promise.all([
      Promise.all(
        uniqueProjectNumbers.map(async (projectNumber) => ({
          projectNumber,
          raw: await deps.repository.getProjectByNumber(projectNumber),
        }))
      ),
      Promise.all(
        uniqueTimelineProjectNumbers.map(async (projectNumber) => ({
          projectNumber,
          raw: await deps.repository.listObservationsByProject(projectNumber),
        }))
      ),
    ]);

    const projectsResult = validateStoredProjects(rawProjects);
    if (!projectsResult.ok) {
      return projectsResult;
    }

    const observationsResult = validateStoredObservationsByProject(
      rawObservationsByProject
    );
    if (!observationsResult.ok) {
      return observationsResult;
    }

    const uniqueArtifactHashes = collectReferencedArtifactHashes(
      uniqueCitedProjectNumbers,
      projectsResult.projectsByNumber,
      observationsResult.observationsByProject
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

    const nowMs = now.getTime();
    const citedResult = buildCitedProjectsByNumber(
      uniqueCitedProjectNumbers,
      projectsResult.projectsByNumber,
      artifactsResult.artifactsByHash,
      nowMs
    );
    if (!citedResult.ok) {
      return citedResult;
    }

    const nodeOutcomes: Array<{ ok: true; node: UiWidgetNode } | HydratorStepFailure> =
      parsedSpec.data.nodes.map((specNode) => {
        if (specNode.component === "ProjectDossierCard") {
          return buildProjectDossierCardNode(
            specNode.nodeId,
            specNode.projectNumber,
            citedResult.citedByNumber
          );
        }
        if (specNode.component === "ObservationTimeline") {
          return buildObservationTimelineNode(
            specNode.nodeId,
            specNode.projectNumbers,
            observationsResult.observationsByProject,
            artifactsResult.artifactsByHash,
            nowMs
          );
        }
        if (specNode.component === "MetricComparisonTable") {
          return buildMetricComparisonTableNode(
            specNode.nodeId,
            specNode.projectNumbers,
            citedResult.citedByNumber
          );
        }
        return stepFailure(
          "invalid_layout_spec",
          `Unsupported card component "${specNode.component}"`
        );
      });

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

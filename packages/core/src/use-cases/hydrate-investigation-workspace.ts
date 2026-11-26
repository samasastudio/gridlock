import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  PlannerLayoutSpecSchema,
  UiWorkspaceAstSchema,
  type GridlockRepository,
  type HydrateWorkspaceErrorCode,
  type UiWorkspaceAst,
} from "../interfaces/index.ts";
import { getEfficiencyScorecard } from "./get-efficiency-scorecard.ts";
import { getPlateLineage } from "./get-plate-lineage.ts";
import { getRepairChangelog } from "./get-repair-changelog.ts";
import {
  buildCitedProjectsByNumber,
  collectReferencedArtifactHashes,
} from "./helpers/investigate-hydrator.ts";
import {
  stepFailure,
  validateStoredArtifacts,
  validateStoredObservationsByProject,
  validateStoredProjects,
} from "./helpers/investigate-provenance.ts";
import {
  extractWorkspaceLookupKeys,
  hydrateWorkspaceNodes,
} from "./helpers/investigate-seam-hydrator.ts";

export interface HydrateInvestigationWorkspaceOptions {
  now?: Date;
}

export interface HydrateInvestigationWorkspaceDeps {
  repository: Pick<
    GridlockRepository,
    | "getProjectByNumber"
    | "getRawCaptureByHash"
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

  try {
    const {
      uniqueProjectNumbers,
      uniqueCitedProjectNumbers,
      uniqueTimelineProjectNumbers,
      uniqueLineageIds,
      uniqueConnectorIds,
    } = extractWorkspaceLookupKeys(parsedSpec.data.nodes);

    const [
      rawProjects,
      rawObservationsByProject,
      lineageEntries,
      changelogEntries,
      scorecardResult,
    ] = await Promise.all([
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
      Promise.all(
        uniqueLineageIds.map(async (lineageId) => ({
          lineageId,
          result: await getPlateLineage(
            { lineageId, now },
            { repository: deps.repository }
          ),
        }))
      ),
      Promise.all(
        uniqueConnectorIds.map(async (connectorId) => ({
          connectorId,
          result: await getRepairChangelog(
            { connectorId, format: "json" },
            { repository: deps.repository }
          ),
        }))
      ),
      uniqueConnectorIds.length > 0
        ? getEfficiencyScorecard(
            { limit: CONNECTOR_HEALTH_RECENT_RUNS_LIMIT },
            { repository: deps.repository }
          )
        : Promise.resolve(null),
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

    const failedLineage = lineageEntries.find((entry) => !entry.result.ok);
    if (failedLineage && !failedLineage.result.ok) {
      return stepFailure(
        "repository_integrity_error",
        failedLineage.result.message
      );
    }

    const failedChangelog = changelogEntries.find((entry) => !entry.result.ok);
    if (failedChangelog && !failedChangelog.result.ok) {
      return stepFailure(
        failedChangelog.result.error === "connector_not_found"
          ? "entity_not_found"
          : "repository_integrity_error",
        failedChangelog.result.message
      );
    }

    if (scorecardResult !== null && !scorecardResult.ok) {
      return stepFailure("repository_integrity_error", scorecardResult.message);
    }

    const uniqueArtifactHashes = collectReferencedArtifactHashes(
      uniqueCitedProjectNumbers,
      projectsResult.projectsByNumber,
      observationsResult.observationsByProject
    );

    const rawArtifacts = await Promise.all(
      uniqueArtifactHashes.map(async (sha256) => ({
        sha256,
        raw: await deps.repository.getRawCaptureByHash(sha256),
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

    const lineageById = new Map(
      lineageEntries.flatMap(({ lineageId, result }) =>
        result.ok ? [[lineageId, result.lineage] as const] : []
      )
    );
    const changelogByConnector = new Map(
      changelogEntries.flatMap(({ connectorId, result }) =>
        result.ok ? [[connectorId, result.changelog] as const] : []
      )
    );
    const compactLedger =
      scorecardResult !== null && scorecardResult.ok
        ? scorecardResult.ledger
        : null;

    const hydratedNodes = hydrateWorkspaceNodes(parsedSpec.data.nodes, {
      citedByNumber: citedResult.citedByNumber,
      observationsByProject: observationsResult.observationsByProject,
      artifactsByHash: artifactsResult.artifactsByHash,
      lineageById,
      changelogByConnector,
      compactLedger,
      nowMs,
    });
    if (!hydratedNodes.ok) {
      return hydratedNodes;
    }

    const parsedWorkspace = UiWorkspaceAstSchema.safeParse({
      version: 1,
      generatedAt: now.toISOString(),
      isEmpty: false,
      nodes: hydratedNodes.nodes,
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

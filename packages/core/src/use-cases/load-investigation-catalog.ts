import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  type GridlockRepository,
  type PlateLineageResponse,
  type RawCapture,
  type RunRecord,
} from "../interfaces/index.ts";
import { getEfficiencyScorecard } from "./get-efficiency-scorecard.ts";
import { getPlateLineage } from "./get-plate-lineage.ts";
import { getRepairChangelog } from "./get-repair-changelog.ts";
import {
  buildFilingCatalogEntries,
  extractUnseenObservationHashes,
  selectCitableCatalogProjects,
  validateCatalogProjectList,
  type PlannerGroundingCatalog,
} from "./helpers/investigate-planner-catalog.ts";
import {
  buildConnectorCatalogEntries,
  buildLineageCatalogEntries,
  extractValidatedChangelogConnectorIds,
  extractValidatedLineageIds,
} from "./helpers/investigate-planner-seam-catalog.ts";

function collectCandidateConnectorIds(
  changelogConnectorIds: readonly string[],
  artifactsByHash: ReadonlyMap<string, RawCapture | null>,
  recentRuns: readonly RunRecord[],
  validLineages: readonly PlateLineageResponse[]
): string[] {
  return Array.from(
    new Set([
      DEFAULT_TDLR_CONNECTOR_CONFIG.connectorId,
      ...changelogConnectorIds,
      ...Array.from(artifactsByHash.values()).flatMap((artifact) =>
        artifact ? [artifact.connectorId] : []
      ),
      ...recentRuns.flatMap((run) => (run.connectorId ? [run.connectorId] : [])),
      ...validLineages.flatMap((lineage) =>
        lineage.nodes.flatMap((node) =>
          node.rawCaptures.map((artifact) => artifact.connectorId)
        )
      ),
    ])
  ).sort((left, right) => left.localeCompare(right));
}

export async function loadPlannerGroundingCatalog(
  repository: GridlockRepository,
  now: Date
): Promise<{ ok: true; catalog: PlannerGroundingCatalog } | { ok: false; message: string }> {
  try {
    const [rawProjects, rawAllPlates, rawChangelogEntries, scorecardResult] = await Promise.all([
      repository.listProjects(),
      repository.listVisualPlatesByLineage(),
      repository.listRepairChangelog(),
      getEfficiencyScorecard({ limit: CONNECTOR_HEALTH_RECENT_RUNS_LIMIT }, { repository }),
    ]);

    const validatedProjects = validateCatalogProjectList(rawProjects);
    if (!validatedProjects.ok) {
      return { ok: false, message: validatedProjects.message };
    }

    const validatedLineages = extractValidatedLineageIds(rawAllPlates);
    if (!validatedLineages.ok) {
      return { ok: false, message: validatedLineages.message };
    }

    const validatedChangelogs = extractValidatedChangelogConnectorIds(rawChangelogEntries);
    if (!validatedChangelogs.ok) {
      return { ok: false, message: validatedChangelogs.message };
    }

    if (!scorecardResult.ok) {
      return { ok: false, message: scorecardResult.message };
    }

    const projectHashes = Array.from(
      new Set(validatedProjects.projects.map((project) => project.latestRawCaptureHash))
    );
    const rawProjectArtifacts = await Promise.all(
      projectHashes.map(async (sha256) => ({
        sha256,
        raw: await repository.getRawCaptureByHash(sha256),
      }))
    );

    const nowMs = now.getTime();
    const citable = selectCitableCatalogProjects(
      validatedProjects.projects,
      rawProjectArtifacts,
      nowMs
    );
    if (!citable.ok) {
      return { ok: false, message: citable.message };
    }

    const rawObservationsByProject = await Promise.all(
      citable.selected.map(async (project) => ({
        projectNumber: project.projectNumber,
        raw: await repository.listObservationsByProject(project.projectNumber),
      }))
    );

    const unseenHashes = extractUnseenObservationHashes(
      rawObservationsByProject,
      citable.artifactsByHash
    );
    const extraRawArtifacts = await Promise.all(
      unseenHashes.map(async (sha256) => ({
        sha256,
        raw: await repository.getRawCaptureByHash(sha256),
      }))
    );

    const filingEntries = buildFilingCatalogEntries(
      citable.selected,
      citable.artifactsByHash,
      rawObservationsByProject,
      extraRawArtifacts,
      nowMs
    );
    if (!filingEntries.ok) {
      return { ok: false, message: filingEntries.message };
    }

    const lineageResults = await Promise.all(
      validatedLineages.lineageIds.map((lineageId) =>
        getPlateLineage({ lineageId, now }, { repository })
      )
    );
    const failedLineage = lineageResults.find((result) => !result.ok);
    if (failedLineage && !failedLineage.ok) {
      return { ok: false, message: failedLineage.message };
    }
    const validLineages = lineageResults.flatMap((result) =>
      result.ok ? [result.lineage] : []
    );

    const candidateConnectorIds = collectCandidateConnectorIds(
      validatedChangelogs.connectorIds,
      filingEntries.artifactsByHash,
      scorecardResult.ledger.recentRuns,
      validLineages
    );
    const changelogResults = await Promise.all(
      candidateConnectorIds.map((connectorId) =>
        getRepairChangelog({ connectorId, format: "json" }, { repository })
      )
    );
    const failedChangelog = changelogResults.find(
      (result) => !result.ok && result.error === "repair_changelog_error"
    );
    if (failedChangelog && !failedChangelog.ok) {
      return { ok: false, message: failedChangelog.message };
    }
    const validChangelogs = changelogResults.flatMap((result) =>
      result.ok ? [result.changelog] : []
    );

    const lineageCatalogResult = buildLineageCatalogEntries(validLineages);
    if (!lineageCatalogResult.ok) {
      return { ok: false, message: lineageCatalogResult.message };
    }

    return {
      ok: true,
      catalog: {
        projects: filingEntries.projects,
        lineages: lineageCatalogResult.lineages,
        connectors: buildConnectorCatalogEntries(validChangelogs),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Repository lookup failed during Investigation Planner grounding: ${detail}`,
    };
  }
}

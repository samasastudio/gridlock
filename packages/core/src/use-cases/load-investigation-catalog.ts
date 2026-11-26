import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  type FrameTimelineResponse,
  type GridlockRepository,
  type RawCapture,
  type RunRecord,
} from "../interfaces/index.ts";
import { getEfficiencyScorecard } from "./get-efficiency-scorecard.ts";
import { getFrameTimeline } from "./get-frame-timeline.ts";
import { getRepairChangelog } from "./get-repair-changelog.ts";
import {
  buildFilingCatalogEntries,
  extractUnseenObservationHashes,
  selectCitableCatalogProjects,
  validateCatalogProjectList,
  type OrchestrationGroundingCatalog,
} from "./helpers/investigate-orchestration-catalog.ts";
import {
  buildConnectorCatalogEntries,
  buildTimelineCatalogEntries,
  extractValidatedChangelogConnectorIds,
  extractValidatedTimelineIds,
} from "./helpers/investigate-orchestration-seam-catalog.ts";

function collectCandidateConnectorIds(
  changelogConnectorIds: readonly string[],
  artifactsByHash: ReadonlyMap<string, RawCapture | null>,
  recentRuns: readonly RunRecord[],
  validTimelines: readonly FrameTimelineResponse[]
): string[] {
  return Array.from(
    new Set([
      DEFAULT_TDLR_CONNECTOR_CONFIG.connectorId,
      ...changelogConnectorIds,
      ...Array.from(artifactsByHash.values()).flatMap((artifact) =>
        artifact ? [artifact.connectorId] : []
      ),
      ...recentRuns.flatMap((run) => (run.connectorId ? [run.connectorId] : [])),
      ...validTimelines.flatMap((timeline) =>
        timeline.nodes.flatMap((node) =>
          node.rawCaptures.map((artifact) => artifact.connectorId)
        )
      ),
    ])
  ).sort((left, right) => left.localeCompare(right));
}

export async function loadOrchestrationGroundingCatalog(
  repository: GridlockRepository,
  now: Date
): Promise<{ ok: true; catalog: OrchestrationGroundingCatalog } | { ok: false; message: string }> {
  try {
    const [rawProjects, rawAllPlates, rawChangelogEntries, scorecardResult] = await Promise.all([
      repository.listProjects(),
      repository.listGeneratedIllustrationsByTimeline(),
      repository.listRepairChangelog(),
      getEfficiencyScorecard({ limit: CONNECTOR_HEALTH_RECENT_RUNS_LIMIT }, { repository }),
    ]);

    const validatedProjects = validateCatalogProjectList(rawProjects);
    if (!validatedProjects.ok) {
      return { ok: false, message: validatedProjects.message };
    }

    const validatedTimelines = extractValidatedTimelineIds(rawAllPlates);
    if (!validatedTimelines.ok) {
      return { ok: false, message: validatedTimelines.message };
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

    const timelineResults = await Promise.all(
      validatedTimelines.timelineIds.map((timelineId) =>
        getFrameTimeline({ timelineId, now }, { repository })
      )
    );
    const failedTimeline = timelineResults.find((result) => !result.ok);
    if (failedTimeline && !failedTimeline.ok) {
      return { ok: false, message: failedTimeline.message };
    }
    const validTimelines = timelineResults.flatMap((result) =>
      result.ok ? [result.timeline] : []
    );

    const candidateConnectorIds = collectCandidateConnectorIds(
      validatedChangelogs.connectorIds,
      filingEntries.artifactsByHash,
      scorecardResult.scorecard.recentRuns,
      validTimelines
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

    const timelineCatalogResult = buildTimelineCatalogEntries(validTimelines);
    if (!timelineCatalogResult.ok) {
      return { ok: false, message: timelineCatalogResult.message };
    }

    return {
      ok: true,
      catalog: {
        projects: filingEntries.projects,
        timelines: timelineCatalogResult.timelines,
        connectors: buildConnectorCatalogEntries(validChangelogs),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Repository lookup failed during UI Orchestration Agent grounding: ${detail}`,
    };
  }
}

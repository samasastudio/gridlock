import {
  MAX_PLANNER_CATALOG_PROJECTS,
  ProjectSchema,
  Sha256HashSchema,
  type Project,
  type SourceArtifact,
} from "../../interfaces/index.ts";
import {
  resolveLiveCitation,
  stepFailure,
  validateStoredArtifacts,
  validateStoredObservationsByProject,
  validateStoredProjects,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";
import type { PlannerCatalogLineageEntry } from "./investigate-planner-seam-catalog.ts";

export interface PlannerCatalogProjectEntry {
  projectNumber: string;
  projectName: string;
  facilityName: string;
  ownerName: string;
  county: string;
  currentStatus: string;
  estimatedCostUsd: number;
  squareFootage: number;
  updatedAt: string;
  timelineHydratable: boolean;
  observationCount: number;
  hasMilestone: boolean;
}

export interface PlannerGroundingCatalog {
  projects: readonly PlannerCatalogProjectEntry[];
  lineages: readonly PlannerCatalogLineageEntry[];
}

function compareCatalogProjects(left: Project, right: Project): number {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.projectNumber.localeCompare(right.projectNumber)
  );
}

export function validateCatalogProjectList(
  rawProjects: unknown
): { ok: true; projects: Project[] } | HydratorStepFailure {
  if (!Array.isArray(rawProjects)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored project list failed runtime schema validation"
    );
  }

  const parsedItems = rawProjects.map((item) => ProjectSchema.safeParse(item));
  if (parsedItems.some((parsed) => !parsed.success)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored Project failed runtime schema validation"
    );
  }

  const parsedProjects = parsedItems.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const uniqueNumbers = new Set(parsedProjects.map((p) => p.projectNumber));
  if (uniqueNumbers.size !== parsedProjects.length) {
    return stepFailure(
      "repository_integrity_error",
      "Duplicate projectNumber found in stored project list"
    );
  }

  const sanitized = validateStoredProjects(
    parsedProjects.map((project) => ({ projectNumber: project.projectNumber, raw: project }))
  );
  if (!sanitized.ok) {
    return sanitized;
  }

  return { ok: true, projects: Array.from(sanitized.projectsByNumber.values()) };
}

export function selectCitableCatalogProjects(
  projects: readonly Project[],
  rawArtifacts: ReadonlyArray<{ sha256: string; raw: unknown }>,
  nowMs: number
):
  | { ok: true; selected: Project[]; artifactsByHash: Map<string, SourceArtifact | null> }
  | HydratorStepFailure {
  const artifactsResult = validateStoredArtifacts(rawArtifacts);
  if (!artifactsResult.ok) {
    return artifactsResult;
  }

  const selected = projects
    .filter(
      (project) =>
        resolveLiveCitation(
          project.latestSourceArtifactHash,
          artifactsResult.artifactsByHash,
          nowMs
        ).ok
    )
    .sort(compareCatalogProjects)
    .slice(0, MAX_PLANNER_CATALOG_PROJECTS);

  return { ok: true, selected, artifactsByHash: artifactsResult.artifactsByHash };
}

export function extractUnseenObservationHashes(
  rawObservationsByProject: ReadonlyArray<{ raw: unknown }>,
  knownHashes: ReadonlyMap<string, unknown>
): string[] {
  return Array.from(
    new Set(
      rawObservationsByProject.flatMap(({ raw }) =>
        Array.isArray(raw)
          ? raw.flatMap((item) => {
              const rawHash =
                typeof item === "object" && item !== null
                  ? (item as Record<string, unknown>).sourceArtifactHash
                  : undefined;
              const parsedHash = Sha256HashSchema.safeParse(rawHash);
              return parsedHash.success && !knownHashes.has(parsedHash.data)
                ? [parsedHash.data]
                : [];
            })
          : []
      )
    )
  );
}

export function buildFilingCatalogEntries(
  selected: readonly Project[],
  baseArtifactsByHash: ReadonlyMap<string, SourceArtifact | null>,
  rawObservationsByProject: ReadonlyArray<{ projectNumber: string; raw: unknown }>,
  extraRawArtifacts: ReadonlyArray<{ sha256: string; raw: unknown }>,
  nowMs: number
):
  | {
      ok: true;
      projects: PlannerCatalogProjectEntry[];
      artifactsByHash: Map<string, SourceArtifact | null>;
    }
  | HydratorStepFailure {
  const observationsResult = validateStoredObservationsByProject(rawObservationsByProject);
  if (!observationsResult.ok) {
    return observationsResult;
  }

  const allObservations = Array.from(
    observationsResult.observationsByProject.values()
  ).flat();
  const uniqueObservationIds = new Set(allObservations.map((obs) => obs.id));
  if (uniqueObservationIds.size !== allObservations.length) {
    return stepFailure(
      "repository_integrity_error",
      "Duplicate observation.id found in stored observations"
    );
  }

  const extraArtifactsResult = validateStoredArtifacts(extraRawArtifacts);
  if (!extraArtifactsResult.ok) {
    return extraArtifactsResult;
  }

  const artifactsByHash = new Map<string, SourceArtifact | null>([
    ...baseArtifactsByHash,
    ...extraArtifactsResult.artifactsByHash,
  ]);

  const projects = selected.map((project): PlannerCatalogProjectEntry => {
    const observations = observationsResult.observationsByProject.get(project.projectNumber) ?? [];
    const resolved = observations.map((obs) => ({
      obs,
      citation: resolveLiveCitation(obs.sourceArtifactHash, artifactsByHash, nowMs),
    }));
    const timelineHydratable = resolved.every(
      ({ obs, citation }) => citation.ok || (citation.reason === "expired" && !obs.isMilestone)
    );
    const liveObservations = resolved.flatMap(({ obs, citation }) => (citation.ok ? [obs] : []));
    return {
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      facilityName: project.facilityName,
      ownerName: project.ownerName,
      county: project.county,
      currentStatus: project.currentStatus,
      estimatedCostUsd: project.estimatedCostUsd,
      squareFootage: project.squareFootage,
      updatedAt: project.updatedAt,
      timelineHydratable,
      observationCount: liveObservations.length,
      hasMilestone: liveObservations.some((obs) => obs.isMilestone),
    };
  });

  return { ok: true, projects, artifactsByHash };
}

import {
  CitedObservationSchema,
  CitedProjectSchema,
  MetricComparisonTableNodeSchema,
  ObservationTimelineNodeSchema,
  ProjectDossierCardNodeSchema,
  type CitedObservation,
  type CitedProject,
  type MetricComparisonTableNode,
  type Observation,
  type ObservationTimelineNode,
  type Project,
  type ProjectDossierCardNode,
  type SourceArtifact,
  type TdlrProjectNumber,
} from "../../interfaces/index.ts";
import {
  resolveLiveCitation,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

function compareCitedObservations(
  left: CitedObservation,
  right: CitedObservation
): number {
  const timeDiff =
    Date.parse(left.observation.observedAt) -
    Date.parse(right.observation.observedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  const projectDiff = left.observation.projectNumber.localeCompare(
    right.observation.projectNumber
  );
  if (projectDiff !== 0) {
    return projectDiff;
  }
  return left.observation.id.localeCompare(right.observation.id);
}

export function collectReferencedArtifactHashes(
  citedProjectNumbers: readonly string[],
  projectsByNumber: ReadonlyMap<string, Project>,
  observationsByProject: ReadonlyMap<string, Observation[]>
): string[] {
  const citedProjectHashes = citedProjectNumbers.flatMap((projectNumber) => {
    const project = projectsByNumber.get(projectNumber);
    return project ? [project.latestSourceArtifactHash] : [];
  });
  const observationHashes = Array.from(observationsByProject.values()).flatMap(
    (observations) => observations.map((obs) => obs.sourceArtifactHash)
  );
  return Array.from(new Set([...citedProjectHashes, ...observationHashes]));
}

export function buildCitedProjectsByNumber(
  projectNumbers: readonly string[],
  projectsByNumber: ReadonlyMap<string, Project>,
  artifactsByHash: ReadonlyMap<string, SourceArtifact | null>,
  nowMs: number
): { ok: true; citedByNumber: Map<string, CitedProject> } | HydratorStepFailure {
  const outcomes = projectNumbers.map((projectNumber) => {
    const project = projectsByNumber.get(projectNumber);
    if (!project) {
      return stepFailure(
        "entity_not_found",
        `Project "${projectNumber}" was not found in GridlockRepository`
      );
    }
    const citationResult = resolveLiveCitation(
      project.latestSourceArtifactHash,
      artifactsByHash,
      nowMs
    );
    if (!citationResult.ok) {
      return stepFailure("unresolvable_provenance", citationResult.message);
    }
    const parsedCited = CitedProjectSchema.safeParse({
      project,
      citation: citationResult.citation,
    });
    if (!parsedCited.success) {
      return stepFailure(
        "repository_integrity_error",
        `CitedProject for "${projectNumber}" failed runtime schema validation`
      );
    }
    return {
      ok: true as const,
      projectNumber,
      citedProject: parsedCited.data,
    };
  });

  const failure = outcomes.find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    return failure;
  }

  return {
    ok: true,
    citedByNumber: new Map(
      outcomes.flatMap((outcome) =>
        outcome.ok ? [[outcome.projectNumber, outcome.citedProject] as const] : []
      )
    ),
  };
}

export function buildProjectDossierCardNode(
  nodeId: string,
  projectNumber: string,
  citedByNumber: ReadonlyMap<string, CitedProject>
): { ok: true; node: ProjectDossierCardNode } | HydratorStepFailure {
  const citedProject = citedByNumber.get(projectNumber);
  if (!citedProject) {
    return stepFailure(
      "entity_not_found",
      `Project "${projectNumber}" was not found in GridlockRepository`
    );
  }
  const parsedNode = ProjectDossierCardNodeSchema.safeParse({
    nodeId,
    component: "ProjectDossierCard",
    citedProject,
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `ProjectDossierCardNode "${nodeId}" failed runtime schema validation`
    );
  }
  return { ok: true, node: parsedNode.data };
}

export function buildObservationTimelineNode(
  nodeId: string,
  projectNumbers: readonly TdlrProjectNumber[],
  observationsByProject: ReadonlyMap<string, Observation[]>,
  artifactsByHash: ReadonlyMap<string, SourceArtifact | null>,
  nowMs: number
): { ok: true; node: ObservationTimelineNode } | HydratorStepFailure {
  const allObservations = projectNumbers.flatMap(
    (projectNumber) => observationsByProject.get(projectNumber) ?? []
  );

  const outcomes = allObservations.map((observation) => {
    const citationResult = resolveLiveCitation(
      observation.sourceArtifactHash,
      artifactsByHash,
      nowMs
    );
    if (!citationResult.ok) {
      if (citationResult.reason === "expired" && !observation.isMilestone) {
        return { ok: true as const, citedObservation: null };
      }
      return stepFailure("unresolvable_provenance", citationResult.message);
    }
    const parsedCited = CitedObservationSchema.safeParse({
      observation,
      citation: citationResult.citation,
    });
    if (!parsedCited.success) {
      return stepFailure(
        "repository_integrity_error",
        `CitedObservation "${observation.id}" failed runtime schema validation`
      );
    }
    return { ok: true as const, citedObservation: parsedCited.data };
  });

  const failure = outcomes.find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    return failure;
  }

  const sortedObservations = outcomes
    .flatMap((outcome) =>
      outcome.ok && outcome.citedObservation !== null
        ? [outcome.citedObservation]
        : []
    )
    .sort(compareCitedObservations);

  const parsedNode = ObservationTimelineNodeSchema.safeParse({
    nodeId,
    component: "ObservationTimeline",
    projectNumbers: [...projectNumbers],
    observations: sortedObservations,
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `ObservationTimelineNode "${nodeId}" failed runtime schema validation`
    );
  }
  return { ok: true, node: parsedNode.data };
}

export function buildMetricComparisonTableNode(
  nodeId: string,
  projectNumbers: readonly TdlrProjectNumber[],
  citedByNumber: ReadonlyMap<string, CitedProject>
): { ok: true; node: MetricComparisonTableNode } | HydratorStepFailure {
  const rowOutcomes = projectNumbers.map((projectNumber) => {
    const citedProject = citedByNumber.get(projectNumber);
    return citedProject
      ? { ok: true as const, citedProject }
      : stepFailure(
          "entity_not_found",
          `Project "${projectNumber}" was not found in GridlockRepository`
        );
  });

  const failure = rowOutcomes.find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    return failure;
  }

  const parsedNode = MetricComparisonTableNodeSchema.safeParse({
    nodeId,
    component: "MetricComparisonTable",
    rows: rowOutcomes.flatMap((outcome) =>
      outcome.ok ? [outcome.citedProject] : []
    ),
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `MetricComparisonTableNode "${nodeId}" failed runtime schema validation`
    );
  }
  return { ok: true, node: parsedNode.data };
}

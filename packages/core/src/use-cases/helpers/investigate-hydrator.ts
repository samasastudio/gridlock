import {
  CitedProjectSchema,
  ProjectDossierCardNodeSchema,
  type CitedProject,
  type Project,
  type ProjectDossierCardNode,
  type SourceArtifact,
} from "../../interfaces/index.ts";
import {
  resolveLiveCitation,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

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

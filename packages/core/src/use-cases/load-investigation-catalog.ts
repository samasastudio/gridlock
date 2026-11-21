import type { GridlockRepository } from "../interfaces/index.ts";
import {
  buildFilingCatalogEntries,
  extractUnseenObservationHashes,
  selectCitableCatalogProjects,
  validateCatalogProjectList,
  type PlannerGroundingCatalog,
} from "./helpers/investigate-planner-catalog.ts";

export async function loadPlannerGroundingCatalog(
  repository: GridlockRepository,
  now: Date
): Promise<{ ok: true; catalog: PlannerGroundingCatalog } | { ok: false; message: string }> {
  try {
    const rawProjects = await repository.listProjects();
    const validatedProjects = validateCatalogProjectList(rawProjects);
    if (!validatedProjects.ok) {
      return { ok: false, message: validatedProjects.message };
    }

    const projectHashes = Array.from(
      new Set(validatedProjects.projects.map((project) => project.latestSourceArtifactHash))
    );
    const rawProjectArtifacts = await Promise.all(
      projectHashes.map(async (sha256) => ({
        sha256,
        raw: await repository.getSourceArtifactByHash(sha256),
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
        raw: await repository.getSourceArtifactByHash(sha256),
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

    return {
      ok: true,
      catalog: {
        projects: filingEntries.projects,
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

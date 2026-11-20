import {
  VisualPlateSchema,
  type EpistemicPlateLabel,
  type LineageNode,
  type PlateLineageResponse,
} from "../../interfaces/index.ts";
import { SafeAstIdSchema } from "../../interfaces/investigate-ast-models.ts";
import {
  sanitizeAstProse,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

export interface PlannerCatalogPlateSummary {
  plateId: string;
  turnNumber: number;
  isBranch: boolean;
  epistemicLabel: EpistemicPlateLabel;
  projectNumbers: readonly string[];
  scenarioPrompt?: string;
}

export interface PlannerCatalogLineageEntry {
  lineageId: string;
  activeCanonicalPlateId: string | null;
  plates: readonly PlannerCatalogPlateSummary[];
}

function isLineageNodeHydratable(node: LineageNode): boolean {
  const expectedCitationCount = new Set(node.plate.sourceArtifactHashes).size;
  const expectedObservationCount = new Set(node.plate.triggeringObservationIds).size;
  const allHttpUrls = node.sourceArtifacts.every((artifact) =>
    /^https?:\/\//i.test(artifact.sourceUrl)
  );
  return (
    SafeAstIdSchema.safeParse(node.plate.plateId).success &&
    expectedCitationCount > 0 &&
    allHttpUrls &&
    node.sourceArtifacts.length === expectedCitationCount &&
    node.triggeringObservations.length === expectedObservationCount
  );
}

function isPlateLineageHydratable(lineage: PlateLineageResponse): boolean {
  return (
    SafeAstIdSchema.safeParse(lineage.lineageId).success &&
    lineage.nodes.length > 0 &&
    lineage.nodes.every(isLineageNodeHydratable)
  );
}

export function extractValidatedLineageIds(
  rawAllPlates: unknown
): { ok: true; lineageIds: string[] } | HydratorStepFailure {
  if (!Array.isArray(rawAllPlates)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored VisualPlate list failed runtime schema validation"
    );
  }

  const parsedItems = rawAllPlates.map((item) => VisualPlateSchema.safeParse(item));
  if (parsedItems.some((parsed) => !parsed.success)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored VisualPlate failed runtime schema validation"
    );
  }

  const parsedPlates = parsedItems.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const uniquePlateIds = new Set(parsedPlates.map((plate) => plate.plateId));
  if (uniquePlateIds.size !== parsedPlates.length) {
    return stepFailure(
      "repository_integrity_error",
      "Duplicate plateId found in stored VisualPlate list"
    );
  }

  const hasBlankPlateProse = parsedPlates.some(
    (plate) =>
      sanitizeAstProse(plate.prompt).length === 0 ||
      (plate.scenarioPrompt !== undefined &&
        sanitizeAstProse(plate.scenarioPrompt).length === 0)
  );
  if (hasBlankPlateProse) {
    return stepFailure(
      "repository_integrity_error",
      "Sanitized VisualPlate prompt failed runtime schema validation"
    );
  }

  const lineageIds = Array.from(new Set(parsedPlates.map((plate) => plate.lineageId))).sort(
    (left, right) => left.localeCompare(right)
  );
  return { ok: true, lineageIds };
}

export function buildLineageCatalogEntries(
  lineages: readonly PlateLineageResponse[]
): { ok: true; lineages: PlannerCatalogLineageEntry[] } | HydratorStepFailure {
  const hasBlankLineageObservationProse = lineages.some((lineage) =>
    lineage.nodes.some((node) =>
      node.triggeringObservations.some(
        (obs) =>
          sanitizeAstProse(obs.status).length === 0 ||
          sanitizeAstProse(obs.scopeOfWork).length === 0
      )
    )
  );
  if (hasBlankLineageObservationProse) {
    return stepFailure(
      "repository_integrity_error",
      "Sanitized lineage Observation prose failed runtime schema validation"
    );
  }

  return {
    ok: true,
    lineages: lineages
      .filter(isPlateLineageHydratable)
      .sort((left, right) => left.lineageId.localeCompare(right.lineageId))
      .map((lineage) => ({
        lineageId: lineage.lineageId,
        activeCanonicalPlateId: lineage.activeCanonicalPlateId,
        plates: lineage.nodes.map((node): PlannerCatalogPlateSummary => ({
          plateId: node.plate.plateId,
          turnNumber: node.plate.turnNumber,
          isBranch: node.plate.isBranch,
          epistemicLabel: node.plate.epistemicLabel,
          projectNumbers: node.plate.projectNumbers,
          ...(node.plate.scenarioPrompt !== undefined
            ? { scenarioPrompt: sanitizeAstProse(node.plate.scenarioPrompt) }
            : {}),
        })),
      })),
  };
}

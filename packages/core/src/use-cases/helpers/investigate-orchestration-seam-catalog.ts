import {
  GeneratedIllustrationSchema,
  RepairChangelogEntrySchema,
  type EpistemicIllustrationLabel,
  type LineageNode,
  type PlateLineageResponse,
  type RepairChangelogResponse,
} from "../../interfaces/index.ts";
import { SafeLayoutIdSchema } from "../../interfaces/workspace-layout-models.ts";
import {
  sanitizeWorkspaceProse,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

export interface OrchestrationCatalogPlateSummary {
  plateId: string;
  turnNumber: number;
  isBranch: boolean;
  epistemicLabel: EpistemicIllustrationLabel;
  projectNumbers: readonly string[];
  scenarioPrompt?: string;
}

export interface OrchestrationCatalogLineageEntry {
  lineageId: string;
  activeCanonicalPlateId: string | null;
  plates: readonly OrchestrationCatalogPlateSummary[];
}

export interface OrchestrationCatalogConnectorEntry {
  connectorId: string;
  status: RepairChangelogResponse["connectorStatus"];
  activeVersion: number;
  repairCount: number;
}

function isLineageNodeHydratable(node: LineageNode): boolean {
  const expectedCitationCount = new Set(node.plate.rawCaptureHashes).size;
  const expectedObservationCount = new Set(node.plate.triggeringObservationIds).size;
  const allHttpUrls = node.rawCaptures.every((artifact) =>
    /^https?:\/\//i.test(artifact.sourceUrl)
  );
  return (
    SafeLayoutIdSchema.safeParse(node.plate.plateId).success &&
    expectedCitationCount > 0 &&
    allHttpUrls &&
    node.rawCaptures.length === expectedCitationCount &&
    node.triggeringObservations.length === expectedObservationCount
  );
}

function isPlateLineageHydratable(lineage: PlateLineageResponse): boolean {
  return (
    SafeLayoutIdSchema.safeParse(lineage.lineageId).success &&
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

  const parsedItems = rawAllPlates.map((item: unknown) => GeneratedIllustrationSchema.safeParse(item));
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
      sanitizeWorkspaceProse(plate.prompt).length === 0 ||
      (plate.scenarioPrompt !== undefined &&
        sanitizeWorkspaceProse(plate.scenarioPrompt).length === 0)
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

export function extractValidatedChangelogConnectorIds(
  rawChangelogEntries: unknown
): { ok: true; connectorIds: string[] } | HydratorStepFailure {
  if (!Array.isArray(rawChangelogEntries)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored RepairChangelogEntry list failed runtime schema validation"
    );
  }

  const parsedItems = rawChangelogEntries.map((item: unknown) =>
    RepairChangelogEntrySchema.safeParse(item)
  );
  if (parsedItems.some((parsed) => !parsed.success)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored RepairChangelogEntry failed runtime schema validation"
    );
  }

  const parsedEntries = parsedItems.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const hasBlankChangelogProse = parsedEntries.some(
    (entry) =>
      sanitizeWorkspaceProse(entry.rootCauseSummary).length === 0 ||
      entry.brokenInvariants.some(
        (invariant) => sanitizeWorkspaceProse(invariant).length === 0
      )
  );
  if (hasBlankChangelogProse) {
    return stepFailure(
      "repository_integrity_error",
      "Sanitized RepairChangelogEntry prose failed runtime schema validation"
    );
  }

  const connectorIds = Array.from(
    new Set(parsedEntries.map((entry) => entry.connectorId))
  ).sort((left, right) => left.localeCompare(right));
  return { ok: true, connectorIds };
}

export function buildLineageCatalogEntries(
  lineages: readonly PlateLineageResponse[]
): { ok: true; lineages: OrchestrationCatalogLineageEntry[] } | HydratorStepFailure {
  const hasBlankLineageObservationProse = lineages.some((lineage) =>
    lineage.nodes.some((node) =>
      node.triggeringObservations.some(
        (obs) =>
          sanitizeWorkspaceProse(obs.status).length === 0 ||
          sanitizeWorkspaceProse(obs.scopeOfWork).length === 0
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
        plates: lineage.nodes.map((node): OrchestrationCatalogPlateSummary => ({
          plateId: node.plate.plateId,
          turnNumber: node.plate.turnNumber,
          isBranch: node.plate.isBranch,
          epistemicLabel: node.plate.epistemicLabel,
          projectNumbers: node.plate.projectNumbers,
          ...(node.plate.scenarioPrompt !== undefined
            ? { scenarioPrompt: sanitizeWorkspaceProse(node.plate.scenarioPrompt) }
            : {}),
        })),
      })),
  };
}

export function buildConnectorCatalogEntries(
  changelogs: readonly RepairChangelogResponse[]
): OrchestrationCatalogConnectorEntry[] {
  return changelogs
    .filter((changelog) => SafeLayoutIdSchema.safeParse(changelog.connectorId).success)
    .sort((left, right) => left.connectorId.localeCompare(right.connectorId))
    .map((changelog) => ({
      connectorId: changelog.connectorId,
      status: changelog.connectorStatus,
      activeVersion: changelog.activeVersion,
      repairCount: changelog.entries.length,
    }));
}

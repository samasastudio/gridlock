import {
  GeneratedIllustrationSchema,
  RepairChangelogEntrySchema,
  type EpistemicIllustrationLabel,
  type FrameTimelineNode,
  type FrameTimelineResponse,
  type RepairChangelogResponse,
} from "../../interfaces/index.ts";
import { SafeLayoutIdSchema } from "../../interfaces/workspace-layout-models.ts";
import {
  sanitizeWorkspaceProse,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

export interface OrchestrationCatalogIllustrationSummary {
  illustrationId: string;
  turnNumber: number;
  isBranch: boolean;
  epistemicLabel: EpistemicIllustrationLabel;
  projectNumbers: readonly string[];
  scenarioPrompt?: string;
}

export interface OrchestrationCatalogTimelineEntry {
  timelineId: string;
  activeCanonicalIllustrationId: string | null;
  plates: readonly OrchestrationCatalogIllustrationSummary[];
}

export interface OrchestrationCatalogConnectorEntry {
  connectorId: string;
  status: RepairChangelogResponse["connectorStatus"];
  activeVersion: number;
  repairCount: number;
}

function isTimelineNodeHydratable(node: FrameTimelineNode): boolean {
  const expectedCitationCount = new Set(node.plate.rawCaptureHashes).size;
  const expectedObservationCount = new Set(node.plate.triggeringObservationIds).size;
  const allHttpUrls = node.rawCaptures.every((artifact) =>
    /^https?:\/\//i.test(artifact.sourceUrl)
  );
  return (
    SafeLayoutIdSchema.safeParse(node.plate.illustrationId).success &&
    expectedCitationCount > 0 &&
    allHttpUrls &&
    node.rawCaptures.length === expectedCitationCount &&
    node.triggeringObservations.length === expectedObservationCount
  );
}

function isFrameTimelineHydratable(timeline: FrameTimelineResponse): boolean {
  return (
    SafeLayoutIdSchema.safeParse(timeline.timelineId).success &&
    timeline.nodes.length > 0 &&
    timeline.nodes.every(isTimelineNodeHydratable)
  );
}

export function extractValidatedTimelineIds(
  rawAllPlates: unknown
): { ok: true; timelineIds: string[] } | HydratorStepFailure {
  if (!Array.isArray(rawAllPlates)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored GeneratedIllustration list failed runtime schema validation"
    );
  }

  const parsedItems = rawAllPlates.map((item: unknown) => GeneratedIllustrationSchema.safeParse(item));
  if (parsedItems.some((parsed) => !parsed.success)) {
    return stepFailure(
      "repository_integrity_error",
      "Stored GeneratedIllustration failed runtime schema validation"
    );
  }

  const parsedPlates = parsedItems.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const uniquePlateIds = new Set(parsedPlates.map((plate) => plate.illustrationId));
  if (uniquePlateIds.size !== parsedPlates.length) {
    return stepFailure(
      "repository_integrity_error",
      "Duplicate illustrationId found in stored GeneratedIllustration list"
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
      "Sanitized GeneratedIllustration prompt failed runtime schema validation"
    );
  }

  const timelineIds = Array.from(new Set(parsedPlates.map((plate) => plate.timelineId))).sort(
    (left, right) => left.localeCompare(right)
  );
  return { ok: true, timelineIds };
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

export function buildTimelineCatalogEntries(
  timelines: readonly FrameTimelineResponse[]
): { ok: true; timelines: OrchestrationCatalogTimelineEntry[] } | HydratorStepFailure {
  const hasBlankTimelineObservationProse = timelines.some((timeline) =>
    timeline.nodes.some((node) =>
      node.triggeringObservations.some(
        (obs) =>
          sanitizeWorkspaceProse(obs.status).length === 0 ||
          sanitizeWorkspaceProse(obs.scopeOfWork).length === 0
      )
    )
  );
  if (hasBlankTimelineObservationProse) {
    return stepFailure(
      "repository_integrity_error",
      "Sanitized timeline Observation prose failed runtime schema validation"
    );
  }

  return {
    ok: true,
    timelines: timelines
      .filter(isFrameTimelineHydratable)
      .sort((left, right) => left.timelineId.localeCompare(right.timelineId))
      .map((timeline) => ({
        timelineId: timeline.timelineId,
        activeCanonicalIllustrationId: timeline.activeCanonicalIllustrationId,
        plates: timeline.nodes.map((node): OrchestrationCatalogIllustrationSummary => ({
          illustrationId: node.plate.illustrationId,
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

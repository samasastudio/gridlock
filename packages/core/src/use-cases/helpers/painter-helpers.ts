import type { Buffer } from "node:buffer";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  PAINTER_AGENT_MODEL,
  VisualPlateSchema,
  type Observation,
  type VisualPlate,
} from "../../interfaces/index.ts";

export function evaluateMilestoneObservations(
  observations: readonly Observation[],
  existingPlates: readonly VisualPlate[]
): Observation[] {
  const alreadyPaintedIds = new Set(
    existingPlates
      .filter((plate) => !plate.isBranch)
      .flatMap((plate) => plate.triggeringObservationIds)
  );

  return observations.filter((obs) => obs.isMilestone && !alreadyPaintedIds.has(obs.id));
}

export function comparePlatesChronologically(a: VisualPlate, b: VisualPlate): number {
  return a.turnNumber !== b.turnNumber
    ? a.turnNumber - b.turnNumber
    : a.createdAt.localeCompare(b.createdAt);
}

export function selectActiveCanonicalPlate(existingPlates: readonly VisualPlate[]): VisualPlate | null {
  return existingPlates
    .filter((plate) => !plate.isBranch)
    .reduce<VisualPlate | null>(
      (latest, candidate) =>
        latest === null || comparePlatesChronologically(latest, candidate) <= 0 ? candidate : latest,
      null
    );
}

export function formatObservationsSummary(observations: readonly Observation[]): string {
  return observations
    .map((obs) => `${obs.projectNumber} (${obs.status}, $${obs.estimatedCostUsd.toLocaleString("en-US")}, ${obs.squareFootage.toLocaleString("en-US")} sq ft: ${obs.scopeOfWork})`)
    .join("; ");
}

export function synthesizeBootstrapPrompt(lineageId: string, observations: readonly Observation[]): string {
  return `Bootstrap Atlas Dossier technical topographical plate for corridor lineage "${lineageId}" incorporating initial milestone observations: ${formatObservationsSummary(observations)}`;
}

export interface VisualPlateTurnSpec {
  turnNumber: number;
  parentInteractionId: string | null;
  parentPlateId: string | null;
  observations: readonly Observation[];
  prompt: string;
}

export function buildVisualPlateRecord(
  params: VisualPlateTurnSpec & { lineageId: string; interactionId: string; webpBuffer: Buffer; sha256: string; createdAt: string }
): VisualPlate {
  const plateId = `plate_${params.lineageId}_t${params.turnNumber}_${params.sha256.slice(0, 8)}`;
  return VisualPlateSchema.parse({
    plateId,
    lineageId: params.lineageId,
    turnNumber: params.turnNumber,
    model: PAINTER_AGENT_MODEL,
    interactionId: params.interactionId,
    parentInteractionId: params.parentInteractionId,
    parentPlateId: params.parentPlateId,
    rebootstrappedFromParentWebp: false,
    projectNumbers: Array.from(new Set(params.observations.map((obs) => obs.projectNumber))),
    triggeringObservationIds: params.observations.map((obs) => obs.id),
    sourceArtifactHashes: Array.from(new Set(params.observations.map((obs) => obs.sourceArtifactHash))),
    prompt: params.prompt,
    storageUri: `${ARTIFACT_BUCKET_URI}/plates/${params.lineageId}/${plateId}.webp`,
    mimeType: "image/webp",
    byteLength: params.webpBuffer.byteLength,
    sha256: params.sha256,
    isBranch: false,
    epistemicLabel: CANONICAL_MILESTONE_LABEL,
    watermarkText: null,
    createdAt: params.createdAt,
    expiresAt: null,
  });
}

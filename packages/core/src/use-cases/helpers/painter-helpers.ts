import type { Observation, VisualPlate } from "../../interfaces/index.ts";

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

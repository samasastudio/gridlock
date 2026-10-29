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

  return observations.filter(
    (obs) => obs.isMilestone && !alreadyPaintedIds.has(obs.id)
  );
}

export function selectActiveCanonicalPlate(
  existingPlates: readonly VisualPlate[]
): VisualPlate | null {
  const canonicalPlates = existingPlates.filter((plate) => !plate.isBranch);
  return canonicalPlates.at(-1) ?? null;
}

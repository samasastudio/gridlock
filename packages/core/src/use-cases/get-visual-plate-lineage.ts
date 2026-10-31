import {
  DEFAULT_LINEAGE_ID,
  type GridlockRepository,
  type VisualPlateLineage,
} from "../interfaces/index.ts";
import { buildVisualPlateLineage } from "./helpers/painter-helpers.ts";
import { loadObservationsByIdForPlates } from "./painter-turn-runner.ts";

export async function getVisualPlateLineage(
  input: { lineageId?: string },
  deps: { repository: GridlockRepository }
): Promise<VisualPlateLineage> {
  const lineageId = input.lineageId ?? DEFAULT_LINEAGE_ID;
  const plates = await deps.repository.listVisualPlatesByLineage(lineageId);
  const observationsById = await loadObservationsByIdForPlates(
    deps.repository,
    plates
  );
  return buildVisualPlateLineage({ lineageId, plates, observationsById });
}

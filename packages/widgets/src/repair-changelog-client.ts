import {
  EfficiencyScorecardSchema,
  RepairChangelogResponseSchema,
  type EfficiencyScorecard,
  type RepairChangelogResponse,
} from "@samasastudio/gridlock-core/schemas";
import { buildApiEndpointUrl, fetchValidatedJson, type DossierHttpError } from "./dossier-http-client.ts";

export interface RepairChangelogQuery {
  apiBaseUrl: string;
  connectorId?: string;
  limit?: number;
  runsLimit?: number;
}

export type RepairChangelogSnapshotResult =
  | { ok: true; changelog: RepairChangelogResponse; efficiencyScorecard: EfficiencyScorecard }
  | DossierHttpError;

const MALFORMED_SNAPSHOT_MESSAGE = "Malformed Repair Changelog or Efficiency Scorecard payload";

export function buildRepairChangelogUrl(options: RepairChangelogQuery & { format?: "json" | "md" }): string {
  return buildApiEndpointUrl(options.apiBaseUrl, "/api/repairs/changelog", {
    connector_id: options.connectorId,
    limit: options.limit,
    format: options.format,
  });
}

export async function fetchRepairChangelogSnapshot(
  options: RepairChangelogQuery & { signal?: AbortSignal }
): Promise<RepairChangelogSnapshotResult> {
  const [changelogResult, scorecardResult] = await Promise.all([
    fetchValidatedJson({
      url: buildRepairChangelogUrl(options),
      schema: RepairChangelogResponseSchema,
      resourceLabel: "Repair Changelog",
      malformedMessage: MALFORMED_SNAPSHOT_MESSAGE,
      init: { signal: options.signal },
    }),
    fetchValidatedJson({
      url: buildApiEndpointUrl(options.apiBaseUrl, "/api/efficiency/scorecard", {
        limit: options.runsLimit,
      }),
      schema: EfficiencyScorecardSchema,
      resourceLabel: "Efficiency Scorecard",
      malformedMessage: MALFORMED_SNAPSHOT_MESSAGE,
      init: { signal: options.signal },
    }),
  ]);
  if (!changelogResult.ok) return changelogResult;
  if (!scorecardResult.ok) return scorecardResult;
  return {
    ok: true,
    changelog: changelogResult.data,
    efficiencyScorecard: scorecardResult.data,
  };
}

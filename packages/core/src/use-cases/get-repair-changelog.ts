import {
  ConnectorConfigSchema,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  RepairChangelogResponseSchema,
  UnknownConnectorError,
  type GridlockRepository,
  type RepairChangelogResponse,
} from "../interfaces/index.ts";
import { formatRepairChangelogMarkdown } from "./helpers/repair-changelog-markdown.ts";

export type RepairChangelogOutputFormat = "json" | "md";

export interface GetRepairChangelogQuery {
  connectorId?: string;
  limit?: number;
  format?: RepairChangelogOutputFormat;
}

export type RepairChangelogErrorCode = "connector_not_found" | "repair_changelog_error";

export type GetRepairChangelogResult =
  | { ok: true; format: "json"; changelog: RepairChangelogResponse }
  | { ok: true; format: "md"; changelog: RepairChangelogResponse; markdown: string }
  | { ok: false; error: RepairChangelogErrorCode; message: string };

type RepairChangelogRepoDeps = Pick<
  GridlockRepository,
  "getActiveConnectorConfig" | "listRepairChangelog"
>;

async function readConnectorAndEntries(
  connectorId: string,
  repository: RepairChangelogRepoDeps
): Promise<
  | { ok: true; configCandidate: unknown; rawEntries: unknown }
  | { ok: false; error: RepairChangelogErrorCode; message: string }
> {
  try {
    const [configCandidate, rawEntries] = await Promise.all([
      repository.getActiveConnectorConfig(connectorId),
      repository.listRepairChangelog(connectorId),
    ]);
    return { ok: true, configCandidate, rawEntries };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read Repair Changelog";
    return error instanceof UnknownConnectorError
      ? { ok: false, error: "connector_not_found", message }
      : { ok: false, error: "repair_changelog_error", message };
  }
}

export async function getRepairChangelog(
  query: GetRepairChangelogQuery,
  deps: { repository: RepairChangelogRepoDeps }
): Promise<GetRepairChangelogResult> {
  const connectorId = query.connectorId ?? DEFAULT_TDLR_CONNECTOR_CONFIG.connectorId;
  const format = query.format ?? "json";

  const fetched = await readConnectorAndEntries(connectorId, deps.repository);

  if (!fetched.ok) {
    return fetched;
  }

  const parsedConfig = ConnectorConfigSchema.safeParse(fetched.configCandidate);

  if (!parsedConfig.success) {
    return {
      ok: false,
      error: "repair_changelog_error",
      message: "Stored ConnectorConfig document failed runtime schema validation",
    };
  }

  const fullValidated = RepairChangelogResponseSchema.safeParse({
    connectorId: parsedConfig.data.connectorId,
    connectorStatus: parsedConfig.data.status,
    activeVersion: parsedConfig.data.version,
    entries: fetched.rawEntries,
  });

  if (!fullValidated.success) {
    return {
      ok: false,
      error: "repair_changelog_error",
      message: "Stored RepairChangelogEntry records failed runtime schema validation",
    };
  }

  const sortedEntries = [...fullValidated.data.entries].sort(
    (left, right) =>
      Date.parse(left.patchPromotedAt) - Date.parse(right.patchPromotedAt) ||
      left.promotedVersion - right.promotedVersion
  );
  const totalAmortizedRuns = sortedEntries.reduce(
    (sum, entry) => sum + entry.subsequentDeterministicRunsServed,
    0
  );
  
  const entries = query.limit !== undefined ? sortedEntries.slice(-query.limit) : sortedEntries;
  const changelog: RepairChangelogResponse = { ...fullValidated.data, entries };

  return format === "md"
    ? {
        ok: true,
        format: "md",
        changelog,
        markdown: formatRepairChangelogMarkdown(changelog, {
          totalHealsCount: sortedEntries.length,
          totalAmortizedRuns,
        }),
      }
    : { ok: true, format: "json", changelog };
}

import {
  EfficiencyScorecardSchema,
  RepairChangelogResponseSchema,
  type EfficiencyScorecard,
  type RepairChangelogResponse,
} from "@samasastudio/gridlock-core/schemas";

export interface RepairLogQuery {
  apiBaseUrl: string;
  connectorId?: string;
  limit?: number;
  runsLimit?: number;
}

export type RepairLogSnapshotResult =
  | { ok: true; changelog: RepairChangelogResponse; efficiencyScorecard: EfficiencyScorecard }
  | { ok: false; message: string; statusCode?: number };

function buildEndpointUrl(
  apiBaseUrl: string,
  pathname: string,
  paramsObj: Record<string, string | number | undefined>
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const entries = Object.entries(paramsObj)
    .filter(([, val]) => val !== undefined && val !== "")
    .map(([key, val]) => [key, String(val)] as [string, string]);
  const query = new URLSearchParams(entries).toString();
  return query ? `${base}${pathname}?${query}` : `${base}${pathname}`;
}

export function buildRepairChangelogUrl(options: RepairLogQuery & { format?: "json" | "md" }): string {
  return buildEndpointUrl(options.apiBaseUrl, "/api/repairs/changelog", {
    connector_id: options.connectorId,
    limit: options.limit,
    format: options.format,
  });
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message.length > 0 ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchRepairLogSnapshot(
  options: RepairLogQuery & { signal?: AbortSignal }
): Promise<RepairLogSnapshotResult> {
  try {
    const [changelogRes, scorecardRes] = await Promise.all([
      globalThis.fetch(buildRepairChangelogUrl(options), { signal: options.signal }),
      globalThis.fetch(buildEndpointUrl(options.apiBaseUrl, "/api/efficiency/scorecard", { limit: options.runsLimit }), {
        signal: options.signal,
      }),
    ]);
    if (!changelogRes.ok) {
      return { ok: false, statusCode: changelogRes.status, message: await readErrorMessage(changelogRes, `Repair Changelog HTTP ${changelogRes.status}`) };
    }
    if (!scorecardRes.ok) {
      return { ok: false, statusCode: scorecardRes.status, message: await readErrorMessage(scorecardRes, `Efficiency Scorecard HTTP ${scorecardRes.status}`) };
    }
    const [rawChangelog, rawScorecard] = await Promise.all([changelogRes.json(), scorecardRes.json()]);
    const parsedChangelog = RepairChangelogResponseSchema.safeParse(rawChangelog);
    const parsedScorecard = EfficiencyScorecardSchema.safeParse(rawScorecard);
    if (!parsedChangelog.success || !parsedScorecard.success) {
      return { ok: false, message: "Malformed Repair Changelog or Efficiency Scorecard payload" };
    }
    return { ok: true, changelog: parsedChangelog.data, efficiencyScorecard: parsedScorecard.data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Network error loading Repair Changelog" };
  }
}

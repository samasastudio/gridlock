import {
  EfficiencyLedgerSchema,
  RepairChangelogResponseSchema,
  type EfficiencyLedger,
  type RepairChangelogResponse,
} from "@samasastudio/gridlock-core";

export interface RepairLogQuery {
  apiBaseUrl: string;
  connectorId?: string;
  limit?: number;
}

export type RepairLogSnapshotResult =
  | { ok: true; changelog: RepairChangelogResponse; efficiencyLedger: EfficiencyLedger }
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
    const [changelogRes, ledgerRes] = await Promise.all([
      globalThis.fetch(buildRepairChangelogUrl(options), { signal: options.signal }),
      globalThis.fetch(buildEndpointUrl(options.apiBaseUrl, "/api/telemetry/efficiency", { limit: options.limit }), {
        signal: options.signal,
      }),
    ]);
    if (!changelogRes.ok) {
      return { ok: false, statusCode: changelogRes.status, message: await readErrorMessage(changelogRes, `Repair Changelog HTTP ${changelogRes.status}`) };
    }
    if (!ledgerRes.ok) {
      return { ok: false, statusCode: ledgerRes.status, message: await readErrorMessage(ledgerRes, `Efficiency Ledger HTTP ${ledgerRes.status}`) };
    }
    const [rawChangelog, rawLedger] = await Promise.all([changelogRes.json(), ledgerRes.json()]);
    const parsedChangelog = RepairChangelogResponseSchema.safeParse(rawChangelog);
    const parsedLedger = EfficiencyLedgerSchema.safeParse(rawLedger);
    if (!parsedChangelog.success || !parsedLedger.success) {
      return { ok: false, message: "Malformed Repair Changelog or Efficiency Ledger payload" };
    }
    return { ok: true, changelog: parsedChangelog.data, efficiencyLedger: parsedLedger.data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Network error loading Repair Changelog" };
  }
}

import {
  TdlrSearchRowSchema,
  type TdlrSearchRow,
} from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";
import {
  GRIDLOCK_USER_AGENT,
  headersToRecord,
  verifySiteAccess,
} from "./site-access-and-pii.ts";
import {
  DEFAULT_TDLR_BASE_URL,
  defaultPageLoader,
  ingestTdlrFiling,
  markBlockedByWaf,
  preflightRobotsTxt,
  type IngestFilingResult,
  type PageLoader,
  type PageLoaderResponse,
} from "./tdlr-connector.ts";

export const DEFAULT_DAILY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const MIN_POLITE_DELAY_MS = 1_500;
export const MAX_RECORDS_PER_RUN = 100;
export const MAX_CONCURRENCY = 1;

export type TdlrDiscoveryMode = "backfill" | "daily";

export interface TdlrSearchFilter {
  field: "ProjectName" | "FacilityName" | "OwnerName";
  value: string;
}

export const DEFAULT_TDLR_SEARCH_FILTERS: readonly TdlrSearchFilter[] = [
  { field: "ProjectName", value: "Data Center" },
  { field: "ProjectName", value: "Datacenter" },
  { field: "FacilityName", value: "Data Center" },
  { field: "OwnerName", value: "Datacenter" },
  { field: "OwnerName", value: "QTS" },
  { field: "OwnerName", value: "CyrusOne" },
  { field: "OwnerName", value: "Compass" },
  { field: "OwnerName", value: "Colovore" },
];

export type SearchLoader = (
  url: string,
  formBody: string
) => Promise<PageLoaderResponse>;

export const defaultSearchLoader: SearchLoader = async (
  url: string,
  formBody: string
): Promise<PageLoaderResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": GRIDLOCK_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: formBody,
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "application/json; charset=utf-8",
    body,
    headers: headersToRecord(response.headers),
  };
};

export function parseTdlrCliArgs(argv: readonly string[]): {
  mode: TdlrDiscoveryMode;
} {
  return {
    mode: argv.includes("--backfill") ? "backfill" : "daily",
  };
}

const COMPUTE_INFRASTRUCTURE_KEYWORDS =
  /\b(?:data\s*centers?|datacenters?|qts|cyrusone|compass\s+datacenters?|colovore|substation|semiconductor|hyperscale|server\s+farm|colocation|ai\s+campus|compute)\b/i;

const NON_COMPUTE_FALSE_POSITIVE_PATTERN =
  /\b(?:shopping|community|fitness|daycare|recreation|senior|convention|retail)\s+center\b/i;

export function isComputeInfrastructureFiling(row: {
  ProjectName: string;
  FacilityName?: string;
  OwnerName?: string;
  ScopeOfWork?: string;
}): boolean {
  const combined = [
    row.ProjectName,
    row.FacilityName ?? "",
    row.OwnerName ?? "",
    row.ScopeOfWork ?? "",
  ].join(" ");

  if (
    NON_COMPUTE_FALSE_POSITIVE_PATTERN.test(combined) &&
    !/\b(?:data\s*centers?|datacenters?)\b/i.test(combined)
  ) {
    return false;
  }

  return COMPUTE_INFRASTRUCTURE_KEYWORDS.test(combined);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultJitterMs = (): number => Math.floor(Math.random() * 250);

export type TdlrDiscoverySweepResult =
  | {
      status: "completed";
      mode: TdlrDiscoveryMode;
      discoveredCount: number;
      ingestedProjectNumbers: string[];
      results: IngestFilingResult[];
      circuitBreakerTripped: boolean;
      skippedByCircuitBreakerCount: number;
      tokensUsed: 0;
    }
  | {
      status: "blocked_by_waf";
      mode: TdlrDiscoveryMode;
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

export async function runTdlrDiscoverySweep(
  input: {
    mode?: TdlrDiscoveryMode;
    baseUrl?: string;
    now?: Date;
    sinceDate?: Date;
    searchFilters?: readonly TdlrSearchFilter[];
    backfillStartYear?: number;
    backfillEndYear?: number;
    minDelayMs?: number;
    maxRecordsPerRun?: number;
  },
  deps: {
    repository: GridlockRepository;
    pageLoader?: PageLoader;
    searchLoader?: SearchLoader;
    sleep?: (ms: number) => Promise<void>;
    jitterMs?: () => number;
  }
): Promise<TdlrDiscoverySweepResult> {
  const mode: TdlrDiscoveryMode = input.mode ?? "daily";
  const baseUrl = (input.baseUrl ?? DEFAULT_TDLR_BASE_URL).replace(/\/+$/, "");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const pageLoader = deps.pageLoader ?? defaultPageLoader;
  const searchLoader = deps.searchLoader ?? defaultSearchLoader;
  const sleep = deps.sleep ?? defaultSleep;
  const jitterMs = deps.jitterMs ?? defaultJitterMs;
  const baseDelayMs = Math.max(
    MIN_POLITE_DELAY_MS,
    input.minDelayMs ?? MIN_POLITE_DELAY_MS
  );
  const maxRecordsPerRun = Math.min(
    MAX_RECORDS_PER_RUN,
    Math.max(1, input.maxRecordsPerRun ?? MAX_RECORDS_PER_RUN)
  );
  const backfillStartYear = input.backfillStartYear ?? 2024;
  const backfillEndYear = input.backfillEndYear ?? 2026;
  const effectiveSinceDate =
    input.sinceDate ??
    (mode === "daily"
      ? new Date(now.getTime() - DEFAULT_DAILY_LOOKBACK_MS)
      : undefined);

  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");
  const searchPath = "/TABS/Search/SearchProjects";

  // 1. Preflight robots.txt once per sweep
  const preflight = await preflightRobotsTxt({
    baseUrl,
    targetPath: searchPath,
    pageLoader,
    now,
  });
  if (!preflight.allowed) {
    const blocked = await markBlockedByWaf(
      deps.repository,
      config.connectorId,
      nowIso,
      preflight.access
    );
    return { ...blocked, mode };
  }

  // 2. Enforce single-token guardrail on OwnerName filters
  const rawFilters = input.searchFilters ?? DEFAULT_TDLR_SEARCH_FILTERS;
  const safeFilters = rawFilters.filter((filter) => {
    const trimmed = filter.value.trim();
    if (!trimmed) return false;
    if (filter.field === "OwnerName" && /\s/.test(trimmed)) {
      return false;
    }
    return true;
  });

  // 3. Single-flight discovery queries (maxConcurrency: 1)
  const discoveredByNumber = new Map<string, TdlrSearchRow>();
  const searchUrl = `${baseUrl}${searchPath}`;

  for (let i = 0; i < safeFilters.length; i += 1) {
    const filter = safeFilters[i]!;
    if (i > 0) {
      await sleep(baseDelayMs + Math.max(0, jitterMs()));
    }
    const formBody = new URLSearchParams({
      [filter.field]: filter.value.trim(),
      draw: String(i + 1),
      start: "0",
      length: "100",
    }).toString();

    const searchRes = await searchLoader(searchUrl, formBody);
    const searchAccess = verifySiteAccess({
      status: searchRes.status,
      headers: searchRes.headers,
      body: searchRes.body,
      robotsTxt: preflight.robotsTxt,
      targetPath: searchPath,
      now,
    });
    if (!searchAccess.allowed) {
      const blocked = await markBlockedByWaf(
        deps.repository,
        config.connectorId,
        nowIso,
        searchAccess
      );
      return { ...blocked, mode };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(searchRes.body);
    } catch {
      continue;
    }

    const rawRows: unknown[] = Array.isArray(parsedJson)
      ? parsedJson
      : parsedJson !== null &&
          typeof parsedJson === "object" &&
          Array.isArray((parsedJson as { data?: unknown }).data)
        ? (parsedJson as { data: unknown[] }).data
        : [];

    for (const rawRow of rawRows) {
      const parsedRow = TdlrSearchRowSchema.safeParse(rawRow);
      if (!parsedRow.success) continue;
      const row = parsedRow.data;
      if (!isComputeInfrastructureFiling(row)) continue;

      const createdMs = Date.parse(row.ProjectCreatedOn);
      if (mode === "backfill") {
        if (Number.isNaN(createdMs)) continue;
        const createdYear = new Date(createdMs).getUTCFullYear();
        if (createdYear < backfillStartYear || createdYear > backfillEndYear) {
          continue;
        }
      }

      if (effectiveSinceDate) {
        if (
          Number.isNaN(createdMs) ||
          createdMs < effectiveSinceDate.getTime()
        ) {
          continue;
        }
      }

      if (!discoveredByNumber.has(row.ProjectNumber)) {
        discoveredByNumber.set(row.ProjectNumber, row);
      }
    }
  }

  // 4. Sort chronologically (ProjectCreatedOn ASC)
  const chronologicalRows = Array.from(discoveredByNumber.values()).sort(
    (a, b) => {
      const diff =
        Date.parse(a.ProjectCreatedOn) - Date.parse(b.ProjectCreatedOn);
      if (diff !== 0 && !Number.isNaN(diff)) {
        return diff;
      }
      return a.ProjectNumber.localeCompare(b.ProjectNumber);
    }
  );

  // 5. Enforce <= 100 records/run circuit breaker
  const discoveredCount = chronologicalRows.length;
  const circuitBreakerTripped = discoveredCount > maxRecordsPerRun;
  const skippedByCircuitBreakerCount = circuitBreakerTripped
    ? discoveredCount - maxRecordsPerRun
    : 0;
  const boundedRows = chronologicalRows.slice(0, maxRecordsPerRun);

  // 6. Ingest each filing single-flight with polite pacing (>= 1,500ms + jitter)
  const results: IngestFilingResult[] = [];
  const ingestedProjectNumbers: string[] = [];

  for (const row of boundedRows) {
    await sleep(baseDelayMs + Math.max(0, jitterMs()));
    const filingResult = await ingestTdlrFiling(
      {
        projectNumber: row.ProjectNumber,
        baseUrl,
        now,
        robotsTxt: preflight.robotsTxt,
      },
      {
        repository: deps.repository,
        pageLoader,
      }
    );

    if (filingResult.status === "blocked_by_waf") {
      return {
        status: "blocked_by_waf",
        mode,
        reason: filingResult.reason,
        ...(filingResult.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: filingResult.retryAfterSeconds }
          : {}),
        tokensUsed: 0,
      };
    }

    results.push(filingResult);
    if (filingResult.status === "ingested") {
      ingestedProjectNumbers.push(row.ProjectNumber);
    }
  }

  return {
    status: "completed",
    mode,
    discoveredCount,
    ingestedProjectNumbers,
    results,
    circuitBreakerTripped,
    skippedByCircuitBreakerCount,
    tokensUsed: 0,
  };
}

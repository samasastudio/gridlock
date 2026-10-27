import { defaultSpanSink } from "../adapters/cloud-logging-sink.ts";
import {
  defaultPageLoader,
  defaultSearchLoader,
} from "../adapters/http-loaders.ts";
import {
  DEFAULT_DAILY_LOOKBACK_MS,
  DEFAULT_TDLR_BASE_URL,
  DEFAULT_TDLR_SEARCH_FILTERS,
  MAX_RECORDS_PER_RUN,
  MIN_POLITE_DELAY_MS,
  type GridlockRepository,
  type IngestFilingResult,
  type PageLoader,
  type SearchLoader,
  type TdlrDiscoveryMode,
  type TdlrDiscoverySweepResult,
  type TdlrSearchFilter,
  type TdlrSearchRow,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import {
  markBlockedByWaf,
  preflightRobotsTxt,
  verifySiteAccess,
} from "./helpers/site-access.ts";
import {
  collectQualifyingDiscoveryRows,
  sanitizeDiscoverySearchFilters,
  sortDiscoveryRowsChronologically,
} from "./helpers/tdlr-parser.ts";
import {
  buildTelemetrySpan,
  calculateNaiveTokensAvoided,
} from "./helpers/telemetry-math.ts";
import { ingestTdlrFiling } from "./ingest-tdlr-filing.ts";
import { recordStageTelemetry } from "./record-telemetry.ts";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultJitterMs = (): number => Math.floor(Math.random() * 250);

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
    spanSink?: TelemetrySpanSink;
  }
): Promise<TdlrDiscoverySweepResult> {
  const startedWallMs = Date.now();
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

  const recordDiscoveryFailureTelemetry = async (
    status: "blocked_by_waf" | "aborted"
  ) => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    await recordStageTelemetry(
      {
        stage: "tdlr_discovery_sweep",
        connectorId: config.connectorId,
        execution_mode: "deterministic",
        status,
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        estimatedCostSavedUsd: 0,
        startedAt: now,
        endedAt,
        recordedAt: nowIso,
        attributes: { connectorId: config.connectorId, mode },
      },
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
  };

  let preflight: Awaited<ReturnType<typeof preflightRobotsTxt>>;
  const discoveredByNumber = new Map<string, TdlrSearchRow>();

  try {
    preflight = await preflightRobotsTxt({
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
      await recordDiscoveryFailureTelemetry("blocked_by_waf");
      return { ...blocked, mode };
    }

    const safeFilters = sanitizeDiscoverySearchFilters(
      input.searchFilters ?? DEFAULT_TDLR_SEARCH_FILTERS
    );
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
        await recordDiscoveryFailureTelemetry("blocked_by_waf");
        return { ...blocked, mode };
      }

      collectQualifyingDiscoveryRows({
        rawJsonBody: searchRes.body,
        mode,
        backfillStartYear,
        backfillEndYear,
        effectiveSinceDate,
        discoveredByNumber,
      });
    }
  } catch (error) {
    await recordDiscoveryFailureTelemetry("aborted");
    throw error;
  }

  const chronologicalRows = sortDiscoveryRowsChronologically(
    discoveredByNumber.values()
  );
  const discoveredCount = chronologicalRows.length;
  const circuitBreakerTripped = discoveredCount > maxRecordsPerRun;
  const skippedByCircuitBreakerCount = circuitBreakerTripped
    ? discoveredCount - maxRecordsPerRun
    : 0;
  const boundedRows = chronologicalRows.slice(0, maxRecordsPerRun);

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
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
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

  const sweepDurationMs = Math.max(0, Date.now() - startedWallMs);
  const sweepEndedAt = new Date(now.getTime() + sweepDurationMs);
  const sweepTokensAvoided = results.reduce((sum, r) => {
    if (r.status === "ingested" || r.status === "unchanged_artifact") {
      return sum + calculateNaiveTokensAvoided(r.sourceArtifact.rawByteLength);
    }
    return sum;
  }, 0);
  const sink = deps.spanSink ?? defaultSpanSink;
  sink(
    buildTelemetrySpan({
      stage: "tdlr_discovery_sweep",
      execution_mode: "deterministic",
      status:
        ingestedProjectNumbers.length > 0 ? "ingested" : "unchanged_artifact",
      startedAt: now,
      endedAt: sweepEndedAt,
      tokensUsed: 0,
      naiveTokensAvoided: sweepTokensAvoided,
      attributes: {
        connectorId: config.connectorId,
        mode,
        discoveredCount,
        ingestedCount: ingestedProjectNumbers.length,
      },
    })
  );

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

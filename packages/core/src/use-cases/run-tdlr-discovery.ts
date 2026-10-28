import { defaultSpanSink } from "../adapters/cloud-logging-sink.ts";
import { defaultPageLoader, defaultSearchLoader } from "../adapters/http-loaders.ts";
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
  type SiteAccessCheckResult,
  type TdlrDiscoveryMode,
  type TdlrDiscoverySweepResult,
  type TdlrSearchFilter,
  type TdlrSearchRow,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import { markBlockedByWaf, preflightRobotsTxt, verifySiteAccess } from "./helpers/site-access.ts";
import {
  collectQualifyingDiscoveryRows,
  sanitizeDiscoverySearchFilters,
  sortDiscoveryRowsChronologically,
} from "./helpers/tdlr-parser.ts";
import { buildTelemetrySpan, calculateNaiveTokensAvoided } from "./helpers/telemetry-math.ts";
import { ingestTdlrFiling } from "./ingest-tdlr-filing.ts";
import { recordStageTelemetry } from "./record-telemetry.ts";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const defaultJitterMs = (): number => Math.floor(Math.random() * 250);

type SearchSweepOutcome =
  | { blocked: false }
  | { blocked: true; access: Extract<SiteAccessCheckResult, { allowed: false }> };

async function executeSearchFilterSweep(params: {
  safeFilters: readonly TdlrSearchFilter[];
  searchUrl: string;
  searchPath: string;
  robotsTxt: string;
  now: Date;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  jitterMs: () => number;
  searchLoader: SearchLoader;
  mode: TdlrDiscoveryMode;
  backfillStartYear: number;
  backfillEndYear: number;
  effectiveSinceDate: Date | undefined;
  discoveredByNumber: Map<string, TdlrSearchRow>;
}): Promise<SearchSweepOutcome> {
  return params.safeFilters.reduce<Promise<SearchSweepOutcome>>(
    async (prevPromise, filter, index) => {
      const prev = await prevPromise;
      if (prev.blocked) return prev;
      if (index > 0) {
        await params.sleep(params.baseDelayMs + Math.max(0, params.jitterMs()));
      }
      const formBody = new URLSearchParams({
        [filter.field]: filter.value.trim(),
        draw: String(index + 1),
        start: "0",
        length: "100",
      }).toString();

      const searchRes = await params.searchLoader(params.searchUrl, formBody);
      const searchAccess = verifySiteAccess({
        status: searchRes.status,
        headers: searchRes.headers,
        body: searchRes.body,
        robotsTxt: params.robotsTxt,
        targetPath: params.searchPath,
        now: params.now,
      });
      if (!searchAccess.allowed) return { blocked: true, access: searchAccess };

      collectQualifyingDiscoveryRows({
        rawJsonBody: searchRes.body,
        mode: params.mode,
        backfillStartYear: params.backfillStartYear,
        backfillEndYear: params.backfillEndYear,
        effectiveSinceDate: params.effectiveSinceDate,
        discoveredByNumber: params.discoveredByNumber,
      });
      return { blocked: false };
    },
    Promise.resolve({ blocked: false })
  );
}

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
  const baseDelayMs = Math.max(MIN_POLITE_DELAY_MS, input.minDelayMs ?? MIN_POLITE_DELAY_MS);
  const maxRecordsPerRun = Math.min(
    MAX_RECORDS_PER_RUN,
    Math.max(1, input.maxRecordsPerRun ?? MAX_RECORDS_PER_RUN)
  );
  const backfillStartYear = input.backfillStartYear ?? 2024;
  const backfillEndYear = input.backfillEndYear ?? 2026;
  const effectiveSinceDate =
    input.sinceDate ??
    (mode === "daily" ? new Date(now.getTime() - DEFAULT_DAILY_LOOKBACK_MS) : undefined);

  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");
  const searchPath = "/TABS/Search/SearchProjects";

  const recordDiscoveryFailureTelemetry = async (status: "blocked_by_waf" | "aborted") => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
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
        endedAt: new Date(now.getTime() + durationMs),
        recordedAt: nowIso,
        attributes: { connectorId: config.connectorId, mode },
      },
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
  };

  const discoveredByNumber = new Map<string, TdlrSearchRow>();

  const runSearchPhase = async (): Promise<
    | { ok: false; blockedResult: Extract<TdlrDiscoverySweepResult, { status: "blocked_by_waf" }> }
    | { ok: true; robotsTxt: string }
  > => {
    const preflight = await preflightRobotsTxt({ baseUrl, targetPath: searchPath, pageLoader, now });
    if (!preflight.allowed) {
      const blocked = await markBlockedByWaf(deps.repository, config.connectorId, nowIso, preflight.access);
      await recordDiscoveryFailureTelemetry("blocked_by_waf");
      return { ok: false, blockedResult: { ...blocked, mode } };
    }

    const safeFilters = sanitizeDiscoverySearchFilters(input.searchFilters ?? DEFAULT_TDLR_SEARCH_FILTERS);
    const sweepOutcome = await executeSearchFilterSweep({
      safeFilters,
      searchUrl: `${baseUrl}${searchPath}`,
      searchPath,
      robotsTxt: preflight.robotsTxt,
      now,
      baseDelayMs,
      sleep,
      jitterMs,
      searchLoader,
      mode,
      backfillStartYear,
      backfillEndYear,
      effectiveSinceDate,
      discoveredByNumber,
    });
    if (sweepOutcome.blocked) {
      const blocked = await markBlockedByWaf(deps.repository, config.connectorId, nowIso, sweepOutcome.access);
      await recordDiscoveryFailureTelemetry("blocked_by_waf");
      return { ok: false, blockedResult: { ...blocked, mode } };
    }
    return { ok: true, robotsTxt: preflight.robotsTxt };
  };

  const searchPhaseOutcome = await runSearchPhase().catch(async (error) => {
    await recordDiscoveryFailureTelemetry("aborted");
    throw error;
  });
  if (!searchPhaseOutcome.ok) return searchPhaseOutcome.blockedResult;

  const chronologicalRows = sortDiscoveryRowsChronologically(discoveredByNumber.values());
  const discoveredCount = chronologicalRows.length;
  const circuitBreakerTripped = discoveredCount > maxRecordsPerRun;
  const skippedByCircuitBreakerCount = circuitBreakerTripped ? discoveredCount - maxRecordsPerRun : 0;
  const boundedRows = chronologicalRows.slice(0, maxRecordsPerRun);

  const ingestSummary = await boundedRows.reduce<
    Promise<{
      blockedResult?: Extract<TdlrDiscoverySweepResult, { status: "blocked_by_waf" }>;
      results: IngestFilingResult[];
      ingestedProjectNumbers: string[];
    }>
  >(
    async (accPromise, row) => {
      const acc = await accPromise;
      if (acc.blockedResult) return acc;
      await sleep(baseDelayMs + Math.max(0, jitterMs()));
      const filingResult = await ingestTdlrFiling(
        { projectNumber: row.ProjectNumber, baseUrl, now, robotsTxt: searchPhaseOutcome.robotsTxt },
        {
          repository: deps.repository,
          pageLoader,
          ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
        }
      );
      if (filingResult.status === "blocked_by_waf") {
        return {
          ...acc,
          blockedResult: {
            status: "blocked_by_waf",
            mode,
            reason: filingResult.reason,
            ...(filingResult.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: filingResult.retryAfterSeconds }
              : {}),
            tokensUsed: 0,
          },
        };
      }
      return {
        results: [...acc.results, filingResult],
        ingestedProjectNumbers:
          filingResult.status === "ingested"
            ? [...acc.ingestedProjectNumbers, row.ProjectNumber]
            : acc.ingestedProjectNumbers,
      };
    },
    Promise.resolve({ results: [], ingestedProjectNumbers: [] })
  );

  if (ingestSummary.blockedResult) return ingestSummary.blockedResult;

  const { results, ingestedProjectNumbers } = ingestSummary;
  const sweepDurationMs = Math.max(0, Date.now() - startedWallMs);
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
      status: ingestedProjectNumbers.length > 0 ? "ingested" : "unchanged_artifact",
      startedAt: now,
      endedAt: new Date(now.getTime() + sweepDurationMs),
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

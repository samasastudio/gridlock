import {
  defaultSpanSink,
} from "./adapters/cloud-logging-sink.ts";
import {
  defaultPageLoader,
  defaultSearchLoader,
} from "./adapters/http-loaders.ts";
import { ingestTdlrFiling as ingestTdlrFilingUseCase } from "./use-cases/ingest-tdlr-filing.ts";
import {
  recordAgenticStageTelemetry as recordAgenticStageTelemetryUseCase,
  recordStageTelemetry as recordStageTelemetryUseCase,
} from "./use-cases/record-telemetry.ts";
import { runOutOfBandRepairAgent as runOutOfBandRepairAgentUseCase } from "./use-cases/run-repair-agent.ts";
import { runTdlrDiscoverySweep as runTdlrDiscoverySweepUseCase } from "./use-cases/run-tdlr-discovery.ts";
import type {
  EfficiencyLedger,
  ExecutionMode,
  GeminiInteractionsClient,
  GridlockRepository,
  IngestFilingResult,
  PageLoader,
  RepairAgentResult,
  SearchLoader,
  SourceArtifact,
  TdlrDiscoveryMode,
  TdlrDiscoverySweepResult,
  TdlrSearchFilter,
  TelemetryRun,
  TelemetryRunStatus,
  TelemetrySpan,
  TelemetrySpanSink,
} from "./interfaces/index.ts";

export {
  ARTIFACT_BUCKET_URI,
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  CandidateSelectorPatchSchema,
  ConnectorConfigSchema,
  ConnectorStatusSchema,
  DEFAULT_DAILY_LOOKBACK_MS,
  DEFAULT_EFFICIENCY_LEDGER,
  DEFAULT_GCP_PROJECT_ID,
  DEFAULT_TDLR_BASE_URL,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  DEFAULT_TDLR_SEARCH_FILTERS,
  EfficiencyLedgerSchema,
  ExecutionModeSchema,
  GRIDLOCK_USER_AGENT,
  IsoCalendarDateSchema,
  MAX_CONCURRENCY,
  MAX_RECORDS_PER_RUN,
  MILESTONE_COST_THRESHOLD_USD,
  MIN_POLITE_DELAY_MS,
  NAIVE_COST_PER_TOKEN_USD,
  NINETY_DAYS_MS,
  ObservationSchema,
  PositiveIntegerStringSchema,
  ProjectSchema,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  SelectorDiffEntrySchema,
  Sha256HashSchema,
  SourceArtifactSchema,
  TdlrFieldLabelsSchema,
  TdlrProjectNumberSchema,
  TdlrSearchRowSchema,
  TelemetryRunSchema,
  TelemetryRunStatusSchema,
  TelemetrySpanSchema,
  type CandidateSelectorPatch,
  type ConnectorConfig,
  type ConnectorStatus,
  type EfficiencyLedger,
  type ExecutionMode,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type IngestFilingResult,
  type IsoCalendarDate,
  type Observation,
  type PageLoader,
  type PageLoaderResponse,
  type PlaywrightPageLike,
  type Project,
  type RepairAgentResult,
  type RepairChangelogEntry,
  type SandboxReplayResult,
  type SearchLoader,
  type SelectorDiffEntry,
  type Sha256Hash,
  type SiteAccessCheckResult,
  type SiteAccessInput,
  type SourceArtifact,
  type TdlrDiscoveryMode,
  type TdlrDiscoverySweepResult,
  type TdlrFieldLabels,
  type TdlrProjectNumber,
  type TdlrSearchFilter,
  type TdlrSearchRow,
  type TelemetryLedgerQueryOptions,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
  type TelemetrySpanSink,
} from "./interfaces/index.ts";

export {
  createCloudLoggingSpanSink,
  defaultSpanSink,
} from "./adapters/cloud-logging-sink.ts";
export {
  createPlaywrightPageLoader,
  defaultPageLoader,
  defaultSearchLoader,
  headersToRecord,
} from "./adapters/http-loaders.ts";
export { createInMemoryGridlockRepository } from "./adapters/in-memory-repository.ts";

export {
  sanitizeLocationAddressPii,
  sanitizeTextPii,
} from "./use-cases/helpers/pii-sanitizer.ts";
export { evaluateSandboxReplayGate } from "./use-cases/helpers/sandbox-replay.ts";
export {
  isPathAllowedByRobotsTxt,
  verifySiteAccess,
} from "./use-cases/helpers/site-access.ts";
export {
  isComputeInfrastructureFiling,
  parseTdlrCliArgs,
  parseTdlrFilingHtml,
} from "./use-cases/helpers/tdlr-parser.ts";
export {
  applyConnectorPromotion,
  applyHealAmortization,
  applyTelemetryRunToLedger,
  buildTelemetryRun,
  buildTelemetrySpan,
  calculateEstimatedCostSavedUsd,
  calculateNaiveTokensAvoided,
} from "./use-cases/helpers/telemetry-math.ts";

export async function recordStageTelemetry(
  input: {
    stage: string;
    connectorId?: string;
    projectNumber?: string;
    sourceArtifactHash?: string;
    execution_mode: ExecutionMode;
    status: TelemetryRunStatus;
    rawByteLength: number;
    tokensUsed: number;
    naiveTokensAvoided: number;
    estimatedCostSavedUsd?: number;
    interactionId?: string;
    startedAt: Date;
    endedAt: Date;
    recordedAt?: string;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: {
      recordTelemetryRun(run: TelemetryRun): Promise<EfficiencyLedger>;
    };
    spanSink?: TelemetrySpanSink;
  }
): Promise<{ run: TelemetryRun; span: TelemetrySpan; ledger: EfficiencyLedger }> {
  return recordStageTelemetryUseCase(input, {
    repository: deps.repository,
    spanSink: deps.spanSink ?? defaultSpanSink,
  });
}

export async function recordAgenticStageTelemetry(
  input: {
    stage: string;
    connectorId?: string;
    projectNumber?: string;
    sourceArtifactHash?: string;
    status: "agentic_completed" | "agentic_failed";
    tokensUsed: number;
    interactionId?: string;
    rawByteLength?: number;
    startedAt: Date;
    endedAt: Date;
    attributes?: Record<string, string | number | boolean | null>;
  },
  deps: {
    repository: {
      recordTelemetryRun(run: TelemetryRun): Promise<EfficiencyLedger>;
    };
    spanSink?: TelemetrySpanSink;
  }
): Promise<{ run: TelemetryRun; span: TelemetrySpan; ledger: EfficiencyLedger }> {
  return recordAgenticStageTelemetryUseCase(input, {
    repository: deps.repository,
    spanSink: deps.spanSink ?? defaultSpanSink,
  });
}

export async function ingestTdlrFiling(
  input: {
    projectNumber: string;
    baseUrl?: string;
    now?: Date;
    robotsTxt?: string;
  },
  deps: {
    repository: GridlockRepository;
    pageLoader?: PageLoader;
    spanSink?: TelemetrySpanSink;
  }
): Promise<IngestFilingResult> {
  return ingestTdlrFilingUseCase(input, {
    repository: deps.repository,
    pageLoader: deps.pageLoader ?? defaultPageLoader,
    spanSink: deps.spanSink ?? defaultSpanSink,
  });
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
  return runTdlrDiscoverySweepUseCase(input, {
    repository: deps.repository,
    pageLoader: deps.pageLoader ?? defaultPageLoader,
    searchLoader: deps.searchLoader ?? defaultSearchLoader,
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.jitterMs !== undefined ? { jitterMs: deps.jitterMs } : {}),
    spanSink: deps.spanSink ?? defaultSpanSink,
  });
}

export async function runOutOfBandRepairAgent(
  input: {
    connectorId?: string;
    quarantinedArtifact: SourceArtifact;
    brokenInvariants: readonly string[];
    historicalFixtures: readonly string[];
    anomalyDetectedAt?: Date;
    now?: Date;
  },
  deps: {
    repository: GridlockRepository;
    geminiClient: GeminiInteractionsClient;
    spanSink?: TelemetrySpanSink;
  }
): Promise<RepairAgentResult> {
  return runOutOfBandRepairAgentUseCase(input, {
    repository: deps.repository,
    geminiClient: deps.geminiClient,
    spanSink: deps.spanSink ?? defaultSpanSink,
  });
}

export {
  createGridlockHttpServer,
  handleGridlockHttpRequest,
} from "./controllers/http-server.ts";
export { handleGetEfficiencyTelemetry } from "./controllers/telemetry-controller.ts";

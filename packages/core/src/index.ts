import {
  defaultPageLoader,
  defaultSearchLoader,
} from "./adapters/http-loaders.ts";
import { ingestTdlrFiling as ingestTdlrFilingUseCase } from "./use-cases/ingest-tdlr-filing.ts";
import { runTdlrDiscoverySweep as runTdlrDiscoverySweepUseCase } from "./use-cases/run-tdlr-discovery.ts";
import type {
  GridlockRepository,
  IngestFilingResult,
  PageLoader,
  SearchLoader,
  TdlrDiscoveryMode,
  TdlrDiscoverySweepResult,
  TdlrSearchFilter,
  TelemetrySpanSink,
} from "./interfaces/index.ts";

export {
  ARTIFACT_BUCKET_URI,
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  CANONICAL_MILESTONE_LABEL,
  CandidateSelectorPatchSchema,
  ConnectorConfigSchema,
  ConnectorStatusSchema,
  DEFAULT_DAILY_LOOKBACK_MS,
  DEFAULT_EFFICIENCY_LEDGER,
  DEFAULT_GCP_PROJECT_ID,
  DEFAULT_LINEAGE_ID,
  DEFAULT_MAX_BRANCHES_PER_LINEAGE,
  DEFAULT_TDLR_BASE_URL,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  DEFAULT_TDLR_SEARCH_FILTERS,
  EfficiencyLedgerSchema,
  EpistemicPlateLabelSchema,
  ExecutionModeSchema,
  GRIDLOCK_USER_AGENT,
  IsoCalendarDateSchema,
  MAX_CONCURRENCY,
  MAX_RECORDS_PER_RUN,
  MAX_SCENARIO_PROMPT_LENGTH,
  MILESTONE_COST_THRESHOLD_USD,
  MIN_POLITE_DELAY_MS,
  NAIVE_COST_PER_TOKEN_USD,
  NINETY_DAYS_MS,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  PositiveIntegerStringSchema,
  ProjectSchema,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  RepairChangelogResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
  SelectorDiffEntrySchema,
  Sha256HashSchema,
  SourceArtifactSchema,
  TdlrFieldLabelsSchema,
  TdlrProjectNumberSchema,
  TdlrSearchRowSchema,
  TelemetryRunSchema,
  TelemetryRunStatusSchema,
  TelemetrySpanSchema,
  UnknownConnectorError,
  VisualPlateSchema,
  type CandidateSelectorPatch,
  type ConnectorConfig,
  type ConnectorStatus,
  type EfficiencyLedger,
  type EpistemicPlateLabel,
  type ExecutionMode,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionError,
  type GeminiInteractionImageBlock,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type IngestFilingResult,
  type IsoCalendarDate,
  type Observation,
  type PageLoader,
  type PageLoaderResponse,
  type PainterErrorCode,
  type PainterImageEncodeResult,
  type PainterImageEncoder,
  type Project,
  type RepairAgentResult,
  type RepairChangelogEntry,
  type RepairChangelogResponse,
  type SandboxReplayResult,
  type SearchLoader,
  type SelectorDiffEntry,
  type Sha256Hash,
  type SiteAccessCheckResult,
  type SiteAccessInput,
  type SourceArtifact,
  type StatefulPainterResult,
  type TdlrDiscoveryMode,
  type TdlrDiscoverySweepResult,
  type TdlrFieldLabels,
  type TdlrProjectNumber,
  type TdlrSearchFilter,
  type TdlrSearchRow,
  type TelemetryLedgerQueryOptions,
  type TelemetryPainterDeltas,
  type TelemetryRun,
  type TelemetryRunStatus,
  type TelemetrySpan,
  type TelemetrySpanSink,
  type VisualPlate,
} from "./interfaces/index.ts";

export {
  createCloudLoggingSpanSink,
  defaultSpanSink,
} from "./adapters/cloud-logging-sink.ts";
export {
  createPlaywrightPageLoader,
  defaultPageLoader,
  defaultSearchLoader,
  type PlaywrightPageLike,
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
} from "./use-cases/helpers/tdlr-discovery-filter.ts";
export { parseTdlrFilingHtml } from "./use-cases/helpers/tdlr-parser.ts";
export {
  applyConnectorPromotion,
  applyHealAmortization,
  calculateEstimatedCostSavedUsd,
  calculateNaiveTokensAvoided,
} from "./use-cases/helpers/telemetry-math.ts";
export {
  createCorridorBaseCanvasWebp,
  isWebpBuffer,
} from "./use-cases/helpers/webp-codec.ts";

export {
  evaluatePainterMilestoneGate,
  type PainterMilestoneGateOutcome,
} from "./use-cases/painter-turn-runner.ts";
export {
  recordAgenticStageTelemetry,
  recordStageTelemetry,
} from "./use-cases/record-telemetry.ts";
export {
  bootstrapCanvas,
  branchLineage,
  paintMilestoneDelta,
  type BootstrapCanvasInput,
  type BranchLineageInput,
  type PainterDeps,
  type PaintMilestoneDeltaInput,
} from "./use-cases/run-painter-agent.ts";
export { runOutOfBandRepairAgent } from "./use-cases/run-repair-agent.ts";

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
    ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
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
    ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
  });
}

export {
  createGridlockHttpServer,
  handleGridlockHttpRequest,
} from "./controllers/http-server.ts";

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
  MAX_CONCURRENCY,
  MAX_RECORDS_PER_RUN,
  MILESTONE_COST_THRESHOLD_USD,
  MIN_POLITE_DELAY_MS,
  NAIVE_COST_PER_TOKEN_USD,
  NINETY_DAYS_MS,
  ObservationSchema,
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
} from "./adapters/http-loaders.ts";
export { createInMemoryGridlockRepository } from "./adapters/in-memory-repository.ts";

export {
  sanitizeLocationAddressPii,
  sanitizeTextPii,
} from "./use-cases/helpers/pii-sanitizer.ts";
export { evaluateSandboxReplayGate } from "./use-cases/helpers/sandbox-replay.ts";
export {
  headersToRecord,
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

export { ingestTdlrFiling } from "./use-cases/ingest-tdlr-filing.ts";
export {
  recordAgenticStageTelemetry,
  recordStageTelemetry,
} from "./use-cases/record-telemetry.ts";
export { runOutOfBandRepairAgent } from "./use-cases/run-repair-agent.ts";
export { runTdlrDiscoverySweep } from "./use-cases/run-tdlr-discovery.ts";

export {
  createGridlockHttpServer,
  handleGridlockHttpRequest,
} from "./controllers/http-server.ts";
export { handleGetEfficiencyTelemetry } from "./controllers/telemetry-controller.ts";

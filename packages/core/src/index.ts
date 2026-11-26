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
  RunSpanSink,
} from "./interfaces/index.ts";

export {
  ARTIFACT_BUCKET_URI,
  BranchIllustrationRequestSchema,
  BranchIllustrationResponseSchema,
  // TODO(#82): Temporary aliases for packages/widgets until Slice 8 removes them.
  BranchPlateRequestSchema,
  BranchPlateResponseSchema,
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  CANONICAL_MILESTONE_LABEL,
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  CandidateSelectorPatchSchema,
  CitedObservationSchema,
  CitedProjectSchema,
  ConnectorConfigSchema,
  ConnectorHealthCardNodeSchema,
  ConnectorStatusSchema,
  DEFAULT_DAILY_LOOKBACK_MS,
  DEFAULT_EFFICIENCY_SCORECARD,
  DEFAULT_GCP_PROJECT_ID,
  DEFAULT_LINEAGE_ID,
  DEFAULT_MAX_BRANCHES_PER_TIMELINE,
  DEFAULT_TDLR_BASE_URL,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  DEFAULT_TDLR_SEARCH_FILTERS,
  DEFAULT_TIMELINE_ID,
  EfficiencyScorecardSchema,
  EpistemicIllustrationLabelSchema,
  ExecutionModeSchema,
  FrameTimelineEdgeSchema,
  FrameTimelineNodeSchema,
  FrameTimelineResponseSchema,
  GRIDLOCK_USER_AGENT,
  GeneratedIllustrationSchema,
  InvestigatePlanRequestSchema,
  InvestigatePlanResponseSchema,
  IsoCalendarDateSchema,
  LineageEdgeSchema,
  LineageNodeSchema,
  LineageSourceCitationSchema,
  MAX_CONCURRENCY,
  MAX_INVESTIGATE_BODY_BYTES,
  MAX_INVESTIGATE_QUERY_LENGTH,
  MAX_ORCHESTRATION_CATALOG_PROJECTS,
  MAX_PROJECTS_PER_CARD,
  MAX_RECORDS_PER_RUN,
  MAX_SCENARIO_PROMPT_LENGTH,
  MAX_WORKSPACE_NODES,
  MILESTONE_COST_THRESHOLD_USD,
  MIN_POLITE_DELAY_MS,
  MetricComparisonTableNodeSchema,
  NAIVE_COST_PER_TOKEN_USD,
  NINETY_DAYS_MS,
  ORCHESTRATION_LAYOUT_SPEC_JSON_SCHEMA,
  ObservationSchema,
  ObservationTimelineNodeSchema,
  OrchestrationLayoutSpecSchema,
  OrchestrationNodeSpecSchema,
  PAINTER_AGENT_MODEL,
  PlateLineageResponseSchema,
  PositiveIntegerStringSchema,
  ProjectDossierCardNodeSchema,
  ProjectSchema,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  RepairChangelogResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
  SelectorDiffEntrySchema,
  Sha256HashSchema,
  RawCaptureSchema,
  TdlrFieldLabelsSchema,
  TdlrProjectNumberSchema,
  TdlrSearchRowSchema,
  TimelineSourceCitationSchema,
  RunRecordSchema,
  RunRecordStatusSchema,
  RunSpanSchema,
  RunStageSchema,
  UI_ORCHESTRATION_AGENT_MODEL,
  UnknownConnectorError,
  FrameTimelineScrubberNodeSchema,
  WorkspaceCardNodeSchema,
  WorkspaceCardTypeSchema,
  WorkspaceLayoutSchema,
} from "./interfaces/index.ts";
export type * from "./interfaces/index.ts";

export {
  createCloudLoggingSpanSink,
  defaultSpanSink,
} from "./adapters/cloud-logging-sink.ts";
export {
  createGeminiInteractionsClient,
  type GeminiInteractionsAdapterOptions,
} from "./adapters/gemini-interactions-client.ts";
export {
  createPlaywrightPageLoader,
  defaultPageLoader,
  defaultSearchLoader,
  type PlaywrightPageLike,
} from "./adapters/http-loaders.ts";
export { createInMemoryGridlockRepository } from "./adapters/in-memory-repository.ts";
export {
  createSharpImageEncoder,
  sharpImageEncoder,
  type SharpImageEncoderOptions,
} from "./adapters/sharp-image-encoder.ts";

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
} from "./use-cases/helpers/scorecard-math.ts";
export {
  createCorridorBaseCanvasWebp,
  isWebpBuffer,
} from "./use-cases/helpers/webp-codec.ts";

export {
  getFrameTimeline,
  type GetFrameTimelineQuery,
  type GetFrameTimelineResult,
} from "./use-cases/get-frame-timeline.ts";
export {
  hydrateInvestigationWorkspace,
  type HydrateInvestigationWorkspaceDeps,
  type HydrateInvestigationWorkspaceOptions,
  type HydrateWorkspaceResult,
} from "./use-cases/hydrate-investigation-workspace.ts";
export {
  evaluatePainterMilestoneGate,
  type PainterMilestoneGateOutcome,
} from "./use-cases/painter-turn-runner.ts";
export {
  recordAgenticStageRun,
  recordStageRun,
} from "./use-cases/record-run.ts";
export {
  bootstrapCanvas,
  branchTimeline,
  paintMilestoneDelta,
  type BootstrapCanvasInput,
  type BranchTimelineInput,
  type PainterDeps,
  type PaintMilestoneDeltaInput,
} from "./use-cases/run-painter-agent.ts";
export {
  runUiOrchestrationAgent,
  type UiOrchestrationAgentDeps,
  type UiOrchestrationAgentErrorCode,
  type UiOrchestrationAgentInput,
  type UiOrchestrationAgentResult,
} from "./use-cases/run-ui-orchestration-agent.ts";
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
    spanSink?: RunSpanSink;
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
    spanSink?: RunSpanSink;
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
  type GridlockHttpDeps,
} from "./controllers/http-server.ts";

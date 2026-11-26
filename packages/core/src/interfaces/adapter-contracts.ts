import type { Buffer } from "node:buffer";
import type {
  ConnectorConfig,
  ConnectorStatus,
  Observation,
  Project,
  RawCapture,
} from "./filing-models.ts";
import type {
  EfficiencyScorecard,
  ExecutionMode,
  RunRecord,
  RunSpan,
} from "./run-record-models.ts";
import type { RepairChangelogEntry } from "./repair-models.ts";
import type { GeneratedIllustration } from "./painter-models.ts";

export interface RunPainterDeltas {
  imageGenerationsAvoidedDelta?: number;
  illustrationCacheHitsDelta?: number;
}

export interface RecordRunTransitionContext {
  readonly currentScorecard: EfficiencyScorecard;
  readonly recentRuns: readonly RunRecord[];
  readonly activeConfig: ConnectorConfig | null;
  readonly matchingChangelogEntry: RepairChangelogEntry | null;
}

export interface RecordRunTransitionResult {
  readonly updatedScorecard: EfficiencyScorecard;
  readonly updatedChangelogEntry?: RepairChangelogEntry | null;
}

export type RecordRunTransition = (
  context: RecordRunTransitionContext
) => RecordRunTransitionResult;

export interface ConnectorPromotionTransitionContext {
  readonly currentScorecard: EfficiencyScorecard;
  readonly existingChangelog: readonly RepairChangelogEntry[];
  readonly quarantinedArtifact: RawCapture | null;
}

export interface ConnectorPromotionTransitionResult {
  readonly updatedScorecard: EfficiencyScorecard;
  readonly promotedArtifact?: RawCapture | null;
}

export type ConnectorPromotionTransition = (
  context: ConnectorPromotionTransitionContext
) => ConnectorPromotionTransitionResult;

export type RawCaptureMetadataTransition = (
  existing: RawCapture
) => RawCapture | null;

export interface ScorecardQueryOptions {
  limit?: number;
  executionMode?: ExecutionMode;
}

export interface GridlockRepository {
  getActiveConnectorConfig(connectorId: string): Promise<ConnectorConfig>;
  setConnectorStatus(
    connectorId: string,
    status: ConnectorStatus,
    updatedAt: string
  ): Promise<ConnectorConfig>;
  getRawCaptureByHash(sha256: string): Promise<RawCapture | null>;
  saveRawCapture(
    artifact: RawCapture,
    gzipBuffer: Buffer
  ): Promise<void>;
  updateRawCaptureMetadata(
    sha256: string,
    transition: RawCaptureMetadataTransition
  ): Promise<RawCapture | null>;
  readArtifactGzip(sha256: string): Promise<Buffer | null>;
  getProjectByNumber(projectNumber: string): Promise<Project | null>;
  upsertProject(project: Project): Promise<void>;
  appendObservation(observation: Observation): Promise<void>;
  listObservationsByProject(projectNumber: string): Promise<Observation[]>;
  listProjects(): Promise<Project[]>;
  recordRunRecord(
    run: RunRecord,
    transition: RecordRunTransition
  ): Promise<EfficiencyScorecard>;
  getEfficiencyScorecard(
    options?: ScorecardQueryOptions
  ): Promise<EfficiencyScorecard>;
  listRunRecords(
    options?: ScorecardQueryOptions
  ): Promise<RunRecord[]>;
  promoteConnectorConfig(
    config: ConnectorConfig,
    changelogEntry: RepairChangelogEntry,
    transition: ConnectorPromotionTransition
  ): Promise<void>;
  listRepairChangelog(connectorId?: string): Promise<RepairChangelogEntry[]>;
  saveGeneratedIllustration(illustration: GeneratedIllustration, webpBuffer: Buffer): Promise<void>;
  getGeneratedIllustrationById(illustrationId: string): Promise<GeneratedIllustration | null>;
  getGeneratedIllustrationByInteractionId(
    interactionId: string
  ): Promise<GeneratedIllustration | null>;
  listGeneratedIllustrationsByTimeline(timelineId?: string): Promise<GeneratedIllustration[]>;
  readGeneratedIllustrationWebp(illustrationId: string): Promise<Buffer | null>;
}

export interface PageLoaderResponse {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string | undefined>;
}

export type PageLoader = (url: string) => Promise<PageLoaderResponse>;

export type SearchLoader = (
  url: string,
  formBody: string
) => Promise<PageLoaderResponse>;

export type RunSpanSink = (span: RunSpan) => void;

export interface GeminiInteractionImageBlock {
  data?: string;
  mime_type?: string;
}

export interface PainterImageEncodeOptions {
  isBranch?: boolean;
  watermarkText?: string | null;
}

export type PainterImageEncodeResult =
  | { ok: true; webpBuffer: Buffer; sha256: string }
  | { ok: false; reason: string };

export type PainterImageEncoder = (
  outputImage: GeminiInteractionImageBlock | null | undefined,
  options?: PainterImageEncodeOptions
) => PainterImageEncodeResult | Promise<PainterImageEncodeResult>;

export type GeminiInteractionResponseFormat =
  | {
      type: "text";
      mime_type: "application/json";
      schema?: Record<string, unknown>;
    }
  | {
      type: "image";
      mime_type?: "image/jpeg";
      aspect_ratio?: string;
      image_size?: "1K" | "2K" | "4K";
      schema?: undefined;
    };

export interface GeminiInteractionCreateRequest {
  model: string;
  input: string | Array<Record<string, unknown>>;
  previous_interaction_id?: string;
  store?: boolean;
  response_format?: GeminiInteractionResponseFormat;
}

export interface GeminiInteractionError {
  code?: string;
  message?: string;
}

export interface GeminiInteractionResponse {
  id: string;
  status?: string;
  previous_interaction_id?: string;
  output_text?: string | null;
  output_image?: GeminiInteractionImageBlock | null;
  errors?: readonly GeminiInteractionError[];
  usage?: {
    total_tokens?: number;
  };
}

export interface GeminiInteractionsClient {
  interactions: {
    create(
      request: GeminiInteractionCreateRequest
    ): Promise<GeminiInteractionResponse>;
  };
}

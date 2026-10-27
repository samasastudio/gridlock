import type {
  ConnectorConfig,
  ConnectorStatus,
  Observation,
  Project,
  SourceArtifact,
} from "./filing-models.ts";
import type {
  EfficiencyLedger,
  ExecutionMode,
  TelemetryRun,
  TelemetrySpan,
} from "./telemetry-models.ts";
import type { RepairChangelogEntry } from "./repair-models.ts";

export interface TelemetryLedgerQueryOptions {
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
  getSourceArtifactByHash(sha256: string): Promise<SourceArtifact | null>;
  saveSourceArtifact(
    artifact: SourceArtifact,
    gzipBuffer: Buffer
  ): Promise<void>;
  readArtifactGzip(sha256: string): Promise<Buffer | null>;
  getProjectByNumber(projectNumber: string): Promise<Project | null>;
  upsertProject(project: Project): Promise<void>;
  appendObservation(observation: Observation): Promise<void>;
  listObservationsByProject(projectNumber: string): Promise<Observation[]>;
  listProjects(): Promise<Project[]>;
  recordTelemetryRun(run: TelemetryRun): Promise<EfficiencyLedger>;
  getEfficiencyLedger(
    options?: TelemetryLedgerQueryOptions
  ): Promise<EfficiencyLedger>;
  listTelemetryRuns(
    options?: TelemetryLedgerQueryOptions
  ): Promise<TelemetryRun[]>;
  promoteConnectorConfig(
    config: ConnectorConfig,
    changelogEntry: RepairChangelogEntry
  ): Promise<void>;
  listRepairChangelog(connectorId?: string): Promise<RepairChangelogEntry[]>;
}

export interface PageLoaderResponse {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string | undefined>;
}

export type PageLoader = (url: string) => Promise<PageLoaderResponse>;

export interface PlaywrightPageLike {
  goto(
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" }
  ): Promise<{
    status(): number;
    headers(): Record<string, string>;
  } | null>;
  content(): Promise<string>;
}

export type SearchLoader = (
  url: string,
  formBody: string
) => Promise<PageLoaderResponse>;

export type TelemetrySpanSink = (span: TelemetrySpan) => void;

export interface GeminiInteractionCreateRequest {
  model: string;
  input: string | Array<Record<string, unknown>>;
  response_format?: {
    type: "text";
    mime_type: "application/json";
    schema: Record<string, unknown>;
  };
}

export interface GeminiInteractionResponse {
  id: string;
  status?: string;
  output_text?: string | null;
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

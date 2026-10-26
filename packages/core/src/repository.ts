import {
  ConnectorConfigSchema,
  DEFAULT_EFFICIENCY_LEDGER,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  EfficiencyLedgerSchema,
  ObservationSchema,
  ProjectSchema,
  SourceArtifactSchema,
  TelemetryRunSchema,
  type ConnectorConfig,
  type ConnectorStatus,
  type EfficiencyLedger,
  type ExecutionMode,
  type Observation,
  type Project,
  type SourceArtifact,
  type TelemetryRun,
} from "./schemas.ts";
import { applyTelemetryRunToLedger } from "./telemetry.ts";

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
}

export function createInMemoryGridlockRepository(
  initialConfig: ConnectorConfig = DEFAULT_TDLR_CONNECTOR_CONFIG,
  initialLedger: EfficiencyLedger = DEFAULT_EFFICIENCY_LEDGER
): GridlockRepository {
  const configs = new Map<string, ConnectorConfig>([
    [initialConfig.connectorId, ConnectorConfigSchema.parse(initialConfig)],
  ]);
  const artifacts = new Map<string, SourceArtifact>();
  const artifactBlobs = new Map<string, Buffer>();
  const projects = new Map<string, Project>();
  const observations: Observation[] = [];
  const telemetryRuns: TelemetryRun[] = [
    ...initialLedger.recentRuns.map((run) =>
      structuredClone(TelemetryRunSchema.parse(run))
    ),
  ];
  let efficiencyLedger: EfficiencyLedger = structuredClone(
    EfficiencyLedgerSchema.parse(initialLedger)
  );

  return {
    async getActiveConnectorConfig(connectorId: string): Promise<ConnectorConfig> {
      const config = configs.get(connectorId);
      if (!config) {
        throw new Error(`Unknown connectorId: ${connectorId}`);
      }
      return structuredClone(config);
    },

    async setConnectorStatus(
      connectorId: string,
      status: ConnectorStatus,
      updatedAt: string
    ): Promise<ConnectorConfig> {
      const existing = await this.getActiveConnectorConfig(connectorId);
      const updated = ConnectorConfigSchema.parse({
        ...existing,
        status,
        updatedAt,
      });
      configs.set(connectorId, updated);
      return structuredClone(updated);
    },

    async getSourceArtifactByHash(sha256: string): Promise<SourceArtifact | null> {
      const found = artifacts.get(sha256);
      return found ? structuredClone(found) : null;
    },

    async saveSourceArtifact(
      artifact: SourceArtifact,
      gzipBuffer: Buffer
    ): Promise<void> {
      const validated = SourceArtifactSchema.parse(artifact);
      artifacts.set(validated.sha256, structuredClone(validated));
      artifactBlobs.set(validated.sha256, Buffer.from(gzipBuffer));
    },

    async readArtifactGzip(sha256: string): Promise<Buffer | null> {
      const blob = artifactBlobs.get(sha256);
      return blob ? Buffer.from(blob) : null;
    },

    async getProjectByNumber(projectNumber: string): Promise<Project | null> {
      const found = projects.get(projectNumber);
      return found ? structuredClone(found) : null;
    },

    async upsertProject(project: Project): Promise<void> {
      const validated = ProjectSchema.parse(project);
      projects.set(validated.projectNumber, structuredClone(validated));
    },

    async appendObservation(observation: Observation): Promise<void> {
      const validated = ObservationSchema.parse(observation);
      observations.push(structuredClone(validated));
    },

    async listObservationsByProject(projectNumber: string): Promise<Observation[]> {
      return observations
        .filter((obs) => obs.projectNumber === projectNumber)
        .map((obs) => structuredClone(obs));
    },

    async listProjects(): Promise<Project[]> {
      return Array.from(projects.values()).map((proj) => structuredClone(proj));
    },

    async recordTelemetryRun(run: TelemetryRun): Promise<EfficiencyLedger> {
      const validatedRun = TelemetryRunSchema.parse(run);
      telemetryRuns.push(structuredClone(validatedRun));
      const recentSlice = telemetryRuns
        .slice(-50)
        .map((r) => structuredClone(r));
      efficiencyLedger = applyTelemetryRunToLedger(
        efficiencyLedger,
        validatedRun,
        recentSlice
      );
      return structuredClone(efficiencyLedger);
    },

    async getEfficiencyLedger(
      options?: TelemetryLedgerQueryOptions
    ): Promise<EfficiencyLedger> {
      const boundedRuns = await this.listTelemetryRuns({
        ...options,
        limit: options?.limit ?? 50,
      });
      return EfficiencyLedgerSchema.parse({
        ...structuredClone(efficiencyLedger),
        recentRuns: boundedRuns,
      });
    },

    async listTelemetryRuns(
      options?: TelemetryLedgerQueryOptions
    ): Promise<TelemetryRun[]> {
      const executionMode = options?.executionMode;
      const filteredRuns = telemetryRuns.filter((run) =>
        executionMode ? run.execution_mode === executionMode : true
      );
      const sliced =
        options?.limit !== undefined
          ? filteredRuns.slice(-options.limit)
          : filteredRuns;
      return sliced.map((run) => structuredClone(run));
    },
  };
}

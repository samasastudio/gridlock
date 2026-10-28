import { Buffer } from "node:buffer";
import {
  ConnectorConfigSchema,
  DEFAULT_EFFICIENCY_LEDGER,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  EfficiencyLedgerSchema,
  ObservationSchema,
  ProjectSchema,
  RepairChangelogEntrySchema,
  SourceArtifactSchema,
  TelemetryRunSchema,
  type ConnectorConfig,
  type ConnectorPromotionStateUpdate,
  type ConnectorStatus,
  type EfficiencyLedger,
  type GridlockRepository,
  type Observation,
  type Project,
  type RepairChangelogEntry,
  type SourceArtifact,
  type TelemetryLedgerQueryOptions,
  type TelemetryRun,
  type TelemetryStateUpdate,
} from "../interfaces/index.ts";

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
  const state = {
    repairChangelog: [] as RepairChangelogEntry[],
    efficiencyLedger: structuredClone(
      EfficiencyLedgerSchema.parse(initialLedger)
    ),
  };

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

    async recordTelemetryRun(
      run: TelemetryRun,
      stateUpdate?: TelemetryStateUpdate
    ): Promise<EfficiencyLedger> {
      const validatedRun = TelemetryRunSchema.parse(run);
      telemetryRuns.push(structuredClone(validatedRun));
      if (stateUpdate) {
        state.efficiencyLedger = structuredClone(
          EfficiencyLedgerSchema.parse(stateUpdate.updatedLedger)
        );
        if (stateUpdate.updatedChangelog) {
          state.repairChangelog = stateUpdate.updatedChangelog.map((entry) =>
            structuredClone(RepairChangelogEntrySchema.parse(entry))
          );
        }
      }
      return structuredClone(state.efficiencyLedger);
    },

    async getEfficiencyLedger(
      options?: TelemetryLedgerQueryOptions
    ): Promise<EfficiencyLedger> {
      const boundedRuns = await this.listTelemetryRuns({
        ...options,
        limit: options?.limit ?? 50,
      });
      return EfficiencyLedgerSchema.parse({
        ...structuredClone(state.efficiencyLedger),
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

    async promoteConnectorConfig(
      config: ConnectorConfig,
      changelogEntry: RepairChangelogEntry,
      stateUpdate?: ConnectorPromotionStateUpdate
    ): Promise<void> {
      const validatedConfig = ConnectorConfigSchema.parse(config);
      const validatedEntry = RepairChangelogEntrySchema.parse(changelogEntry);
      configs.set(validatedConfig.connectorId, structuredClone(validatedConfig));
      state.repairChangelog.push(structuredClone(validatedEntry));

      if (stateUpdate?.promotedArtifact) {
        artifacts.set(
          validatedEntry.quarantinedArtifactHash,
          structuredClone(SourceArtifactSchema.parse(stateUpdate.promotedArtifact))
        );
      }
      if (stateUpdate) {
        state.efficiencyLedger = structuredClone(
          EfficiencyLedgerSchema.parse(stateUpdate.updatedLedger)
        );
      }
    },

    async listRepairChangelog(
      connectorId?: string
    ): Promise<RepairChangelogEntry[]> {
      return state.repairChangelog
        .filter((entry) =>
          connectorId ? entry.connectorId === connectorId : true
        )
        .map((entry) => structuredClone(entry));
    },
  };
}

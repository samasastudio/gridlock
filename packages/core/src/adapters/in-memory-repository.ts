import { Buffer } from "node:buffer";
import {
  ConnectorConfigSchema,
  DEFAULT_EFFICIENCY_SCORECARD,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  EfficiencyScorecardSchema,
  GeneratedIllustrationSchema,
  ObservationSchema,
  ProjectSchema,
  RepairChangelogEntrySchema,
  RawCaptureSchema,
  RunRecordSchema,
  UnknownConnectorError,
  type ConnectorConfig,
  type ConnectorPromotionStateUpdate,
  type ConnectorStatus,
  type EfficiencyScorecard,
  type GeneratedIllustration,
  type GridlockRepository,
  type Observation,
  type Project,
  type RepairChangelogEntry,
  type RawCapture,
  type ScorecardQueryOptions,
  type RunRecord,
  type RunStateUpdate,
} from "../interfaces/index.ts";

export function createInMemoryGridlockRepository(
  initialConfig: ConnectorConfig = DEFAULT_TDLR_CONNECTOR_CONFIG,
  initialScorecard: EfficiencyScorecard = DEFAULT_EFFICIENCY_SCORECARD
): GridlockRepository {
  const configs = new Map<string, ConnectorConfig>([
    [initialConfig.connectorId, ConnectorConfigSchema.parse(initialConfig)],
  ]);
  const artifacts = new Map<string, RawCapture>();
  const artifactBlobs = new Map<string, Buffer>();
  const generatedIllustrations = new Map<string, GeneratedIllustration>();
  const illustrationWebpBlobs = new Map<string, Buffer>();
  const projects = new Map<string, Project>();
  const observations: Observation[] = [];
  const runRecords: RunRecord[] = [
    ...initialScorecard.recentRuns.map((run) =>
      structuredClone(RunRecordSchema.parse(run))
    ),
  ];
  const state = {
    repairChangelog: [] as RepairChangelogEntry[],
    efficiencyScorecard: structuredClone(
      EfficiencyScorecardSchema.parse(initialScorecard)
    ),
  };

  return {
    async getActiveConnectorConfig(connectorId: string): Promise<ConnectorConfig> {
      const config = configs.get(connectorId);
      if (!config) {
        throw new UnknownConnectorError(connectorId);
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

    async getRawCaptureByHash(sha256: string): Promise<RawCapture | null> {
      const found = artifacts.get(sha256);
      return found ? structuredClone(found) : null;
    },

    async saveRawCapture(
      artifact: RawCapture,
      gzipBuffer: Buffer
    ): Promise<void> {
      const validated = RawCaptureSchema.parse(artifact);
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

    async recordRunRecord(
      run: RunRecord,
      stateUpdate: RunStateUpdate
    ): Promise<EfficiencyScorecard> {
      const validatedRun = RunRecordSchema.parse(run);
      runRecords.push(structuredClone(validatedRun));
      state.efficiencyScorecard = structuredClone(
        EfficiencyScorecardSchema.parse(stateUpdate.updatedScorecard)
      );
      if (stateUpdate.updatedChangelog) {
        state.repairChangelog = stateUpdate.updatedChangelog.map((entry) =>
          structuredClone(RepairChangelogEntrySchema.parse(entry))
        );
      }
      return structuredClone(state.efficiencyScorecard);
    },

    async getEfficiencyScorecard(
      options?: ScorecardQueryOptions
    ): Promise<EfficiencyScorecard> {
      const boundedRuns = await this.listRunRecords({
        ...options,
        limit: options?.limit ?? 50,
      });
      return EfficiencyScorecardSchema.parse({
        ...structuredClone(state.efficiencyScorecard),
        recentRuns: boundedRuns,
      });
    },

    async listRunRecords(
      options?: ScorecardQueryOptions
    ): Promise<RunRecord[]> {
      const executionMode = options?.executionMode;
      const filteredRuns = runRecords.filter((run) =>
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
      stateUpdate: ConnectorPromotionStateUpdate
    ): Promise<void> {
      const validatedConfig = ConnectorConfigSchema.parse(config);
      const validatedEntry = RepairChangelogEntrySchema.parse(changelogEntry);
      configs.set(validatedConfig.connectorId, structuredClone(validatedConfig));
      state.repairChangelog.push(structuredClone(validatedEntry));

      if (stateUpdate.promotedArtifact) {
        artifacts.set(
          validatedEntry.quarantinedArtifactHash,
          structuredClone(RawCaptureSchema.parse(stateUpdate.promotedArtifact))
        );
      }
      state.efficiencyScorecard = structuredClone(
        EfficiencyScorecardSchema.parse(stateUpdate.updatedScorecard)
      );
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

    async saveGeneratedIllustration(
      plate: GeneratedIllustration,
      webpBuffer: Buffer
    ): Promise<void> {
      const validated = GeneratedIllustrationSchema.parse(plate);
      generatedIllustrations.set(validated.illustrationId, structuredClone(validated));
      illustrationWebpBlobs.set(validated.illustrationId, Buffer.from(webpBuffer));
    },

    async getGeneratedIllustrationById(illustrationId: string): Promise<GeneratedIllustration | null> {
      const found = generatedIllustrations.get(illustrationId);
      return found ? structuredClone(found) : null;
    },

    async getGeneratedIllustrationByInteractionId(
      interactionId: string
    ): Promise<GeneratedIllustration | null> {
      const found = Array.from(generatedIllustrations.values()).find(
        (plate) => plate.interactionId === interactionId
      );
      return found ? structuredClone(found) : null;
    },

    async listGeneratedIllustrationsByTimeline(
      timelineId?: string
    ): Promise<GeneratedIllustration[]> {
      return Array.from(generatedIllustrations.values())
        .filter((plate) => (timelineId ? plate.timelineId === timelineId : true))
        .sort((a, b) =>
          a.turnNumber !== b.turnNumber
            ? a.turnNumber - b.turnNumber
            : a.createdAt.localeCompare(b.createdAt)
        )
        .map((plate) => structuredClone(plate));
    },

    async readGeneratedIllustrationWebp(illustrationId: string): Promise<Buffer | null> {
      const blob = illustrationWebpBlobs.get(illustrationId);
      return blob ? Buffer.from(blob) : null;
    },
  };
}

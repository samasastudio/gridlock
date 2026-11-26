import { Buffer } from "node:buffer";
import {
  ConnectorConfigSchema,
  DEFAULT_EFFICIENCY_SCORECARD,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  EfficiencyScorecardSchema,
  GeneratedIllustrationSchema,
  ObservationSchema,
  ProjectSchema,
  RECENT_RUN_RECORDS_LIMIT,
  RepairChangelogEntrySchema,
  RawCaptureSchema,
  RunRecordSchema,
  UnknownConnectorError,
  type ConnectorConfig,
  type ConnectorPromotionTransition,
  type ConnectorStatus,
  type EfficiencyScorecard,
  type GeneratedIllustration,
  type GridlockRepository,
  type Observation,
  type Project,
  type RawCaptureMetadataTransition,
  type RecordRunTransition,
  type RepairChangelogEntry,
  type RawCapture,
  type ScorecardQueryOptions,
  type RunRecord,
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

    async updateRawCaptureMetadata(
      sha256: string,
      transition: RawCaptureMetadataTransition
    ): Promise<RawCapture | null> {
      const existing = artifacts.get(sha256);
      if (!existing) {
        return null;
      }
      const nextMetadata = transition(structuredClone(existing));
      if (nextMetadata === null) {
        return structuredClone(existing);
      }
      const validated = RawCaptureSchema.parse(nextMetadata);
      if (validated.sha256 !== sha256) {
        throw new Error(
          `RawCapture metadata transition changed sha256 from ${sha256} to ${validated.sha256}`
        );
      }
      artifacts.set(sha256, structuredClone(validated));
      return structuredClone(validated);
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
      transition: RecordRunTransition
    ): Promise<EfficiencyScorecard> {
      const validatedRun = RunRecordSchema.parse(run);
      const recentRuns = runRecords
        .slice(-RECENT_RUN_RECORDS_LIMIT)
        .map((entry) => structuredClone(entry));
      const activeConfig = validatedRun.connectorId
        ? configs.get(validatedRun.connectorId) ?? null
        : null;
      const matchingChangelogEntry =
        validatedRun.connectorId && activeConfig
          ? state.repairChangelog.reduce<RepairChangelogEntry | null>(
              (found, entry) =>
                entry.connectorId === validatedRun.connectorId &&
                entry.promotedVersion === activeConfig.version
                  ? entry
                  : found,
              null
            )
          : null;

      const transitionResult = transition({
        currentScorecard: structuredClone(state.efficiencyScorecard),
        recentRuns,
        activeConfig: activeConfig ? structuredClone(activeConfig) : null,
        matchingChangelogEntry: matchingChangelogEntry
          ? structuredClone(matchingChangelogEntry)
          : null,
      });

      const validatedScorecard = EfficiencyScorecardSchema.parse(
        transitionResult.updatedScorecard
      );
      const validatedChangelogEntry =
        transitionResult.updatedChangelogEntry != null
          ? RepairChangelogEntrySchema.parse(
              transitionResult.updatedChangelogEntry
            )
          : null;
      if (
        validatedChangelogEntry &&
        validatedChangelogEntry.id !== matchingChangelogEntry?.id
      ) {
        throw new Error(
          `Run transition attempted to update non-matching RepairChangelogEntry ${validatedChangelogEntry.id}`
        );
      }

      runRecords.push(structuredClone(validatedRun));
      state.efficiencyScorecard = structuredClone(validatedScorecard);
      if (validatedChangelogEntry) {
        state.repairChangelog = state.repairChangelog.map((entry) =>
          entry.id === validatedChangelogEntry.id
            ? structuredClone(validatedChangelogEntry)
            : entry
        );
      }
      return structuredClone(state.efficiencyScorecard);
    },

    async getEfficiencyScorecard(
      options?: ScorecardQueryOptions
    ): Promise<EfficiencyScorecard> {
      const boundedRuns = await this.listRunRecords(options);
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
      const rawLimit = options?.limit ?? RECENT_RUN_RECORDS_LIMIT;
      const limit = Number.isFinite(rawLimit)
        ? rawLimit
        : RECENT_RUN_RECORDS_LIMIT;
      const sliced = limit <= 0 ? [] : filteredRuns.slice(-limit);
      return sliced.map((run) => structuredClone(run));
    },

    async promoteConnectorConfig(
      config: ConnectorConfig,
      changelogEntry: RepairChangelogEntry,
      transition: ConnectorPromotionTransition
    ): Promise<void> {
      const validatedConfig = ConnectorConfigSchema.parse(config);
      const validatedEntry = RepairChangelogEntrySchema.parse(changelogEntry);
      const existingQuarantined =
        artifacts.get(validatedEntry.quarantinedArtifactHash) ?? null;

      const transitionResult = transition({
        currentScorecard: structuredClone(state.efficiencyScorecard),
        existingChangelog: state.repairChangelog.map((entry) =>
          structuredClone(entry)
        ),
        quarantinedArtifact: existingQuarantined
          ? structuredClone(existingQuarantined)
          : null,
      });

      const validatedScorecard = EfficiencyScorecardSchema.parse(
        transitionResult.updatedScorecard
      );
      const validatedPromotedArtifact =
        transitionResult.promotedArtifact != null
          ? RawCaptureSchema.parse(transitionResult.promotedArtifact)
          : null;
      if (validatedPromotedArtifact && !existingQuarantined) {
        throw new Error(
          `Connector promotion cannot update missing quarantined RawCapture ${validatedEntry.quarantinedArtifactHash}`
        );
      }
      if (
        validatedPromotedArtifact &&
        validatedPromotedArtifact.sha256 !==
          validatedEntry.quarantinedArtifactHash
      ) {
        throw new Error(
          `Connector promotion artifact hash mismatch: expected ${validatedEntry.quarantinedArtifactHash}, got ${validatedPromotedArtifact.sha256}`
        );
      }

      configs.set(
        validatedConfig.connectorId,
        structuredClone(validatedConfig)
      );
      state.repairChangelog.push(structuredClone(validatedEntry));
      if (validatedPromotedArtifact) {
        artifacts.set(
          validatedEntry.quarantinedArtifactHash,
          structuredClone(validatedPromotedArtifact)
        );
      }
      state.efficiencyScorecard = structuredClone(validatedScorecard);
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

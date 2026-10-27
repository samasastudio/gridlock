import { gunzipSync } from "node:zlib";
import {
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  CandidateSelectorPatchSchema,
  NAIVE_COST_PER_TOKEN_USD,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type RepairAgentResult,
  type SandboxReplayResult,
  type SourceArtifact,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import { evaluateSandboxReplayGate } from "./helpers/sandbox-replay.ts";
import { applyConnectorPromotion } from "./helpers/telemetry-math.ts";
import { recordAgenticStageTelemetry } from "./record-telemetry.ts";

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
  const connectorId = input.connectorId ?? input.quarantinedArtifact.connectorId;
  const startedAt =
    input.anomalyDetectedAt ?? new Date(input.quarantinedArtifact.capturedAt);
  const endedAt = input.now ?? new Date();
  const nowIso = endedAt.toISOString();
  const currentConfig =
    await deps.repository.getActiveConnectorConfig(connectorId);

  const rejectFailClosed = async (
    reason: string,
    tokensUsed: number,
    interactionId?: string,
    replay?: SandboxReplayResult
  ): Promise<RepairAgentResult> => {
    await deps.repository.setConnectorStatus(
      connectorId,
      "selector_anomaly",
      nowIso
    );
    await recordAgenticStageTelemetry(
      {
        stage: "repair_agent",
        connectorId,
        sourceArtifactHash: input.quarantinedArtifact.sha256,
        status: "agentic_failed",
        tokensUsed,
        ...(interactionId !== undefined ? { interactionId } : {}),
        rawByteLength: input.quarantinedArtifact.rawByteLength,
        startedAt,
        endedAt,
      },
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
    return {
      status: "repair_rejected",
      reason,
      connectorStatus: "selector_anomaly",
      ...(replay !== undefined ? { replay } : {}),
    };
  };

  const gzipBuffer = await deps.repository.readArtifactGzip(
    input.quarantinedArtifact.sha256
  );
  if (!gzipBuffer) {
    return rejectFailClosed(
      `Missing quarantined SourceArtifact buffer for ${input.quarantinedArtifact.sha256}`,
      0
    );
  }

  let quarantinedHtml: string;
  try {
    quarantinedHtml = gunzipSync(gzipBuffer).toString("utf-8");
  } catch {
    return rejectFailClosed("Corrupted gzip buffer in quarantined artifact", 0);
  }

  const prompt = JSON.stringify({
    task: "Synthesize a backward-compatible ConnectorConfig selector patch for TDLR TABS HTML.",
    currentConfig,
    brokenInvariants: input.brokenInvariants,
    quarantinedHtml,
  });

  let interaction: GeminiInteractionResponse;
  try {
    interaction = await deps.geminiClient.interactions.create({
      model: REPAIR_AGENT_MODEL,
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
      },
    });
  } catch (error) {
    return rejectFailClosed(
      error instanceof Error ? error.message : "Gemini interaction request failed",
      0
    );
  }

  const repairTokensUsed = Math.max(0, interaction.usage?.total_tokens ?? 0);
  const interactionId = interaction.id || "inter_unknown";

  if (!interaction.output_text) {
    return rejectFailClosed(
      "Empty output_text returned from Repair Agent",
      repairTokensUsed,
      interactionId
    );
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(interaction.output_text);
  } catch {
    return rejectFailClosed(
      "Malformed JSON returned from Repair Agent",
      repairTokensUsed,
      interactionId
    );
  }

  const parsedPatch = CandidateSelectorPatchSchema.safeParse(rawJson);
  if (!parsedPatch.success) {
    return rejectFailClosed(
      `Candidate patch failed schema validation: ${parsedPatch.error.message}`,
      repairTokensUsed,
      interactionId
    );
  }

  const replay = evaluateSandboxReplayGate({
    currentConfig,
    patch: parsedPatch.data,
    quarantinedHtml,
    historicalFixtures: input.historicalFixtures,
    nowIso,
  });

  if (!replay.passed) {
    return rejectFailClosed(
      replay.failureReasons.join(" | "),
      repairTokensUsed,
      interactionId,
      replay
    );
  }

  const mttrMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const estimatedRepairCostUsd = Number(
    (repairTokensUsed * NAIVE_COST_PER_TOKEN_USD).toFixed(8)
  );

  const changelogEntry = RepairChangelogEntrySchema.parse({
    id: `repair_${connectorId}_v${replay.candidateConfig.version}_${input.quarantinedArtifact.sha256.slice(0, 8)}`,
    connectorId,
    previousVersion: currentConfig.version,
    promotedVersion: replay.candidateConfig.version,
    quarantinedArtifactHash: input.quarantinedArtifact.sha256,
    brokenInvariants: [...input.brokenInvariants],
    selectorDiffs: replay.selectorDiffs,
    rootCauseSummary: parsedPatch.data.rootCauseSummary,
    historicalFixturesTested: replay.historicalFixturesTested,
    historicalFixturesPassed: replay.historicalFixturesPassed,
    totalFixturesVerified: replay.totalFixturesVerified,
    anomalyDetectedAt: startedAt.toISOString(),
    patchPromotedAt: nowIso,
    mttrMs,
    interactionId,
    repairTokensUsed,
    estimatedRepairCostUsd,
    subsequentDeterministicRunsServed: 0,
    expiresAt: null,
  });

  const existingChangelog = await deps.repository.listRepairChangelog();
  const existingQuarantined = await deps.repository.getSourceArtifactByHash(
    changelogEntry.quarantinedArtifactHash
  );
  const currentLedger = await deps.repository.getEfficiencyLedger();
  const promotion = applyConnectorPromotion({
    changelogEntry,
    allChangelogEntries: [...existingChangelog, changelogEntry],
    quarantinedArtifact: existingQuarantined ?? undefined,
    ledger: currentLedger,
  });

  await deps.repository.promoteConnectorConfig(
    replay.candidateConfig,
    changelogEntry,
    promotion
  );
  await recordAgenticStageTelemetry(
    {
      stage: "repair_agent",
      connectorId,
      sourceArtifactHash: input.quarantinedArtifact.sha256,
      status: "agentic_completed",
      tokensUsed: repairTokensUsed,
      interactionId,
      rawByteLength: input.quarantinedArtifact.rawByteLength,
      startedAt,
      endedAt,
    },
    {
      repository: deps.repository,
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    }
  );

  return {
    status: "repair_promoted",
    promotedConfig: replay.candidateConfig,
    changelogEntry,
    replay,
  };
}

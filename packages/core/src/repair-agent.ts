import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  CandidateSelectorPatchSchema,
  ConnectorConfigSchema,
  RepairChangelogEntrySchema,
  TdlrFieldLabelsSchema,
  type CandidateSelectorPatch,
  type ConnectorConfig,
  type RepairChangelogEntry,
  type SelectorDiffEntry,
  type SourceArtifact,
  type TdlrFieldLabels,
} from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";
import { parseTdlrFilingHtml } from "./tdlr-connector.ts";
import {
  NAIVE_COST_PER_TOKEN_USD,
  recordAgenticStageTelemetry,
  type TelemetrySpanSink,
} from "./telemetry.ts";

export const REPAIR_AGENT_MODEL = "gemini-3.8-flash" as const;

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

export const CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    detailContainerSelector: { type: "string" },
    definitionListSelector: { type: "string" },
    termSelector: { type: "string" },
    descriptionSelector: { type: "string" },
    fieldLabels: {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(TdlrFieldLabelsSchema.shape).map((key) => [
          key,
          { type: "string" },
        ])
      ),
    },
    rootCauseSummary: { type: "string" },
  },
  required: ["rootCauseSummary"],
};

export interface SandboxReplayResult {
  passed: boolean;
  candidateConfig: ConnectorConfig;
  selectorDiffs: SelectorDiffEntry[];
  quarantinedPassed: boolean;
  historicalFixturesTested: number;
  historicalFixturesPassed: number;
  totalFixturesVerified: number;
  failureReasons: string[];
}

export function evaluateSandboxReplayGate(input: {
  currentConfig: ConnectorConfig;
  patch: CandidateSelectorPatch;
  quarantinedHtml: string;
  historicalFixtures: readonly string[];
  nowIso: string;
}): SandboxReplayResult {
  const { currentConfig, patch, quarantinedHtml, historicalFixtures, nowIso } =
    input;

  const mergedLabels: TdlrFieldLabels = {
    ...currentConfig.fieldLabels,
    ...(patch.fieldLabels ?? {}),
  };

  const candidateConfig = ConnectorConfigSchema.parse({
    ...currentConfig,
    version: currentConfig.version + 1,
    status: "healthy",
    detailContainerSelector:
      patch.detailContainerSelector ?? currentConfig.detailContainerSelector,
    definitionListSelector:
      patch.definitionListSelector ?? currentConfig.definitionListSelector,
    termSelector: patch.termSelector ?? currentConfig.termSelector,
    descriptionSelector:
      patch.descriptionSelector ?? currentConfig.descriptionSelector,
    fieldLabels: mergedLabels,
    updatedAt: nowIso,
  });

  const selectorDiffs: SelectorDiffEntry[] = [];
  const topFields = [
    "detailContainerSelector",
    "definitionListSelector",
    "termSelector",
    "descriptionSelector",
  ] as const;

  for (const field of topFields) {
    if (currentConfig[field] !== candidateConfig[field]) {
      selectorDiffs.push({
        field,
        before: currentConfig[field],
        after: candidateConfig[field],
      });
    }
  }

  for (const key of Object.keys(
    candidateConfig.fieldLabels
  ) as Array<keyof TdlrFieldLabels>) {
    const beforeVal = currentConfig.fieldLabels[key] ?? "";
    const afterVal = candidateConfig.fieldLabels[key] ?? "";
    if (beforeVal !== afterVal) {
      selectorDiffs.push({
        field: `fieldLabels.${key}`,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  const failureReasons: string[] = [];
  if (selectorDiffs.length === 0) {
    failureReasons.push("Candidate patch produced zero selector diffs");
  }
  if (historicalFixtures.length === 0) {
    failureReasons.push(
      "At least 1 historical fixture is required for Sandbox Replay Gate verification"
    );
  }

  const replayFixture = (html: string) => {
    const sha256 = createHash("sha256")
      .update(Buffer.from(html, "utf-8"))
      .digest("hex");
    return parseTdlrFilingHtml(html, candidateConfig, { sha256, nowIso });
  };

  const quarantinedParse = replayFixture(quarantinedHtml);
  const quarantinedPassed = quarantinedParse.ok;
  if (!quarantinedParse.ok) {
    failureReasons.push(
      `Quarantined artifact failed replay: ${quarantinedParse.invariantErrors.join("; ")}`
    );
  }

  let historicalFixturesPassed = 0;
  for (let i = 0; i < historicalFixtures.length; i += 1) {
    const parsed = replayFixture(historicalFixtures[i]!);
    if (parsed.ok) {
      historicalFixturesPassed += 1;
    } else {
      failureReasons.push(
        `Historical fixture #${i + 1} regressed: ${parsed.invariantErrors.join("; ")}`
      );
    }
  }

  const passed =
    selectorDiffs.length > 0 &&
    historicalFixtures.length > 0 &&
    quarantinedPassed &&
    historicalFixturesPassed === historicalFixtures.length;

  return {
    passed,
    candidateConfig,
    selectorDiffs,
    quarantinedPassed,
    historicalFixturesTested: historicalFixtures.length,
    historicalFixturesPassed,
    totalFixturesVerified:
      historicalFixturesPassed + (quarantinedPassed ? 1 : 0),
    failureReasons,
  };
}

export type RepairAgentResult =
  | {
      status: "repair_promoted";
      promotedConfig: ConnectorConfig;
      changelogEntry: RepairChangelogEntry;
      replay: SandboxReplayResult;
    }
  | {
      status: "repair_rejected";
      reason: string;
      connectorStatus: "selector_anomaly";
      replay?: SandboxReplayResult;
    };

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
  const startedAt = input.anomalyDetectedAt ?? new Date(input.quarantinedArtifact.capturedAt);
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

  await deps.repository.promoteConnectorConfig(
    replay.candidateConfig,
    changelogEntry
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

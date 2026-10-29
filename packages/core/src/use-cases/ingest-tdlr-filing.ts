import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  DEFAULT_TDLR_BASE_URL,
  MILESTONE_COST_THRESHOLD_USD,
  NINETY_DAYS_MS,
  ObservationSchema,
  TdlrProjectNumberSchema,
  type GridlockRepository,
  type IngestFilingResult,
  type PageLoader,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";
import { verifySiteAccess } from "./helpers/site-access.ts";
import {
  buildSourceArtifact,
  parseTdlrFilingHtml,
} from "./helpers/tdlr-parser.ts";
import {
  calculateEstimatedCostSavedUsd,
  calculateNaiveTokensAvoided,
} from "./helpers/telemetry-math.ts";
import {
  markBlockedByWaf,
  preflightRobotsTxt,
} from "./preflight-site-access.ts";
import { recordStageTelemetry } from "./record-telemetry.ts";

export async function ingestTdlrFiling(
  input: {
    projectNumber: string;
    baseUrl?: string;
    now?: Date;
    robotsTxt?: string;
  },
  deps: {
    repository: GridlockRepository;
    pageLoader: PageLoader;
    spanSink?: TelemetrySpanSink;
  }
): Promise<IngestFilingResult> {
  const startedWallMs = Date.now();
  const baseUrl = (input.baseUrl ?? DEFAULT_TDLR_BASE_URL).replace(/\/+$/, "");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const pageLoader = deps.pageLoader;
  const targetPath = `/TABS/Search/Project/${encodeURIComponent(input.projectNumber)}`;
  const sourceUrl = `${baseUrl}${targetPath}`;
  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");

  const validProjectNumber = TdlrProjectNumberSchema.safeParse(input.projectNumber);
  const projectNumberProp = validProjectNumber.success ? { projectNumber: validProjectNumber.data } : {};
  const spanDeps = {
    repository: deps.repository,
    ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
  };

  const finalizeTelemetry = async (result: IngestFilingResult): Promise<IngestFilingResult> => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    const isSuccess = result.status === "ingested" || result.status === "unchanged_artifact";
    const rawByteLength = result.status === "blocked_by_waf" ? 0 : result.sourceArtifact.rawByteLength;
    const naiveTokensAvoided = isSuccess ? calculateNaiveTokensAvoided(rawByteLength) : 0;
    const estimatedCostSavedUsd = isSuccess ? calculateEstimatedCostSavedUsd(naiveTokensAvoided) : 0;

    await recordStageTelemetry(
      {
        stage: "tdlr_ingest",
        connectorId: config.connectorId,
        ...projectNumberProp,
        ...(result.status !== "blocked_by_waf" ? { sourceArtifactHash: result.sourceArtifact.sha256 } : {}),
        execution_mode: "deterministic",
        status: result.status,
        rawByteLength,
        tokensUsed: 0,
        naiveTokensAvoided,
        estimatedCostSavedUsd,
        startedAt: now,
        endedAt,
        recordedAt: nowIso,
        attributes: {
          connectorId: config.connectorId,
          projectNumber: input.projectNumber,
          rawByteLength,
        },
      },
      spanDeps
    );
    return result;
  };

  try {
    const preflight = await preflightRobotsTxt({
      baseUrl,
      targetPath,
      providedRobotsTxt: input.robotsTxt,
      pageLoader,
      now,
    });
    if (!preflight.allowed) {
      return finalizeTelemetry(
        await markBlockedByWaf(deps.repository, config.connectorId, nowIso, preflight.access)
      );
    }

    const response = await pageLoader(sourceUrl);
    const accessCheck = verifySiteAccess({
      status: response.status,
      headers: response.headers,
      body: response.body,
      robotsTxt: preflight.robotsTxt,
      targetPath,
      now,
    });

    if (!accessCheck.allowed) {
      return finalizeTelemetry(
        await markBlockedByWaf(deps.repository, config.connectorId, nowIso, accessCheck)
      );
    }

    const rawBuffer = Buffer.from(response.body, "utf-8");
    const sha256 = createHash("sha256").update(rawBuffer).digest("hex");

    const existingArtifact = await deps.repository.getSourceArtifactByHash(sha256);
    if (existingArtifact && !existingArtifact.storageUri.includes("/quarantine/")) {
      return finalizeTelemetry({
        status: "unchanged_artifact",
        sourceArtifact: existingArtifact,
      });
    }

    const gzipBuffer = gzipSync(rawBuffer);
    const plusNinetyDaysIso = new Date(now.getTime() + NINETY_DAYS_MS).toISOString();
    const parsed = parseTdlrFilingHtml(response.body, config, { sha256, nowIso });

    if (!parsed.ok) {
      const quarantinedArtifact = buildSourceArtifact({
        sha256,
        connectorId: config.connectorId,
        sourceUrl,
        contentType: response.contentType,
        rawByteLength: rawBuffer.byteLength,
        compressedByteLength: gzipBuffer.byteLength,
        folder: "quarantine",
        capturedAt: nowIso,
        expiresAt: plusNinetyDaysIso,
      });
      await deps.repository.saveSourceArtifact(quarantinedArtifact, gzipBuffer);
      await deps.repository.setConnectorStatus(config.connectorId, "selector_anomaly", nowIso);
      return finalizeTelemetry({
        status: "selector_anomaly",
        sourceArtifact: quarantinedArtifact,
        invariantErrors: parsed.invariantErrors,
      });
    }

    const project = parsed.project;
    const existingProject = await deps.repository.getProjectByNumber(project.projectNumber);
    const isMilestone =
      project.estimatedCostUsd >= MILESTONE_COST_THRESHOLD_USD ||
      (existingProject !== null && existingProject.currentStatus !== project.currentStatus);

    const sourceArtifact = buildSourceArtifact({
      sha256,
      connectorId: config.connectorId,
      sourceUrl,
      contentType: response.contentType,
      rawByteLength: rawBuffer.byteLength,
      compressedByteLength: gzipBuffer.byteLength,
      folder: "artifacts",
      capturedAt: nowIso,
      expiresAt: isMilestone ? null : plusNinetyDaysIso,
    });

    const observation = ObservationSchema.parse({
      id: `obs_${project.projectNumber}_${sha256.slice(0, 12)}`,
      projectNumber: project.projectNumber,
      sourceArtifactHash: sha256,
      observedAt: nowIso,
      status: project.currentStatus,
      estimatedCostUsd: project.estimatedCostUsd,
      squareFootage: project.squareFootage,
      scopeOfWork: project.scopeOfWork,
      isMilestone,
    });

    await deps.repository.saveSourceArtifact(sourceArtifact, gzipBuffer);
    await deps.repository.upsertProject(project);
    await deps.repository.appendObservation(observation);

    return finalizeTelemetry({
      status: "ingested",
      sourceArtifact,
      project,
      observation,
    });
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    await recordStageTelemetry(
      {
        stage: "tdlr_ingest",
        connectorId: config.connectorId,
        ...projectNumberProp,
        execution_mode: "deterministic",
        status: "aborted",
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        estimatedCostSavedUsd: 0,
        startedAt: now,
        endedAt,
        recordedAt: nowIso,
        attributes: {
          connectorId: config.connectorId,
          projectNumber: input.projectNumber,
        },
      },
      spanDeps
    );
    throw error;
  }
}

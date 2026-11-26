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
  type RunSpanSink,
} from "../interfaces/index.ts";
import { verifySiteAccess } from "./helpers/site-access.ts";
import {
  buildRawCapture,
  parseTdlrFilingHtml,
} from "./helpers/tdlr-parser.ts";
import {
  calculateEstimatedCostSavedUsd,
  calculateNaiveTokensAvoided,
} from "./helpers/scorecard-math.ts";
import {
  markBlockedByWaf,
  preflightRobotsTxt,
} from "./preflight-site-access.ts";
import { recordStageRun } from "./record-run.ts";

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
    spanSink?: RunSpanSink;
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

  const finalizeRunRecord = async (result: IngestFilingResult): Promise<IngestFilingResult> => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    const isSuccess = result.status === "ingested" || result.status === "unchanged_artifact";
    const rawByteLength = result.status === "blocked_by_waf" ? 0 : result.rawCapture.rawByteLength;
    const naiveTokensAvoided = isSuccess ? calculateNaiveTokensAvoided(rawByteLength) : 0;
    const estimatedCostSavedUsd = isSuccess ? calculateEstimatedCostSavedUsd(naiveTokensAvoided) : 0;

    await recordStageRun(
      {
        stage: "tdlr_ingest",
        connectorId: config.connectorId,
        ...projectNumberProp,
        ...(result.status !== "blocked_by_waf" ? { rawCaptureHash: result.rawCapture.sha256 } : {}),
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
      return finalizeRunRecord(
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
      return finalizeRunRecord(
        await markBlockedByWaf(deps.repository, config.connectorId, nowIso, accessCheck)
      );
    }

    const rawBuffer = Buffer.from(response.body, "utf-8");
    const sha256 = createHash("sha256").update(rawBuffer).digest("hex");

    const existingArtifact = await deps.repository.getRawCaptureByHash(sha256);
    if (existingArtifact && !existingArtifact.storageUri.includes("/quarantine/")) {
      return finalizeRunRecord({
        status: "unchanged_artifact",
        rawCapture: existingArtifact,
      });
    }

    const gzipBuffer = gzipSync(rawBuffer);
    const plusNinetyDaysIso = new Date(now.getTime() + NINETY_DAYS_MS).toISOString();
    const parsed = parseTdlrFilingHtml(response.body, config, { sha256, nowIso });

    if (!parsed.ok) {
      const quarantinedArtifact = buildRawCapture({
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
      await deps.repository.saveRawCapture(quarantinedArtifact, gzipBuffer);
      await deps.repository.setConnectorStatus(config.connectorId, "selector_anomaly", nowIso);
      return finalizeRunRecord({
        status: "selector_anomaly",
        rawCapture: quarantinedArtifact,
        invariantErrors: parsed.invariantErrors,
      });
    }

    const project = parsed.project;
    const existingProject = await deps.repository.getProjectByNumber(project.projectNumber);
    const isMilestone =
      project.estimatedCostUsd >= MILESTONE_COST_THRESHOLD_USD ||
      (existingProject !== null && existingProject.currentStatus !== project.currentStatus);

    const rawCapture = buildRawCapture({
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
      rawCaptureHash: sha256,
      observedAt: nowIso,
      status: project.currentStatus,
      estimatedCostUsd: project.estimatedCostUsd,
      squareFootage: project.squareFootage,
      scopeOfWork: project.scopeOfWork,
      isMilestone,
    });

    await deps.repository.saveRawCapture(rawCapture, gzipBuffer);
    await deps.repository.upsertProject(project);
    await deps.repository.appendObservation(observation);

    return finalizeRunRecord({
      status: "ingested",
      rawCapture,
      project,
      observation,
    });
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    await recordStageRun(
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

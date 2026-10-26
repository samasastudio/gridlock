import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  ObservationSchema,
  ProjectSchema,
  SourceArtifactSchema,
  TdlrProjectNumberSchema,
  TdlrSearchRowSchema,
  type ConnectorConfig,
  type Observation,
  type Project,
  type SourceArtifact,
  type TdlrSearchRow,
} from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";
import {
  buildTelemetrySpan,
  calculateEstimatedCostSavedUsd,
  calculateNaiveTokensAvoided,
  defaultSpanSink,
  recordStageTelemetry,
  type TelemetrySpanSink,
} from "./telemetry.ts";
import {
  GRIDLOCK_USER_AGENT,
  headersToRecord,
  isPathAllowedByRobotsTxt,
  sanitizeLocationAddressPii,
  sanitizeTextPii,
  verifySiteAccess,
  type SiteAccessCheckResult,
  type SiteAccessInput,
} from "./site-access-and-pii.ts";

export {
  GRIDLOCK_USER_AGENT,
  isPathAllowedByRobotsTxt,
  sanitizeLocationAddressPii,
  sanitizeTextPii,
  verifySiteAccess,
  type SiteAccessCheckResult,
  type SiteAccessInput,
};

export const DEFAULT_TDLR_BASE_URL = "https://www.tdlr.texas.gov";
export const ARTIFACT_BUCKET_URI = "gs://gridlock-artifacts";
export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const MILESTONE_COST_THRESHOLD_USD = 25_000_000;
export const MIN_POLITE_DELAY_MS = 1_500;
export const MAX_RECORDS_PER_RUN = 100;
export const MAX_CONCURRENCY = 1;

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

export function createPlaywrightPageLoader(
  page: PlaywrightPageLike
): PageLoader {
  return async (url: string): Promise<PageLoaderResponse> => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const body = await page.content();
    const headers = response?.headers() ?? {};
    return {
      status: response?.status() ?? 200,
      contentType: headers["content-type"] ?? "text/html; charset=utf-8",
      body,
      headers,
    };
  };
}

export const defaultPageLoader: PageLoader = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": GRIDLOCK_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "text/html; charset=utf-8",
    body,
    headers: headersToRecord(response.headers),
  };
};

export type IngestFilingResult =
  | {
      status: "ingested";
      sourceArtifact: SourceArtifact;
      project: Project;
      observation: Observation;
    }
  | {
      status: "unchanged_artifact";
      sourceArtifact: SourceArtifact;
    }
  | {
      status: "selector_anomaly";
      sourceArtifact: SourceArtifact;
      invariantErrors: string[];
    }
  | {
      status: "blocked_by_waf";
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

async function markBlockedByWaf(
  repository: GridlockRepository,
  connectorId: string,
  nowIso: string,
  access: Extract<SiteAccessCheckResult, { allowed: false }>
): Promise<{
  status: "blocked_by_waf";
  reason: string;
  retryAfterSeconds?: number;
  tokensUsed: 0;
}> {
  await repository.setConnectorStatus(connectorId, "blocked_by_waf", nowIso);
  return {
    status: "blocked_by_waf",
    reason: access.reason,
    ...(access.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: access.retryAfterSeconds }
      : {}),
    tokensUsed: 0,
  };
}

async function preflightRobotsTxt(params: {
  baseUrl: string;
  targetPath: string;
  providedRobotsTxt?: string;
  pageLoader: PageLoader;
  now: Date;
}): Promise<
  | { allowed: true; robotsTxt: string }
  | {
      allowed: false;
      access: Extract<SiteAccessCheckResult, { allowed: false }>;
    }
> {
  let robotsTxt = params.providedRobotsTxt;
  if (robotsTxt === undefined) {
    try {
      const robotsRes = await params.pageLoader(`${params.baseUrl}/robots.txt`);
      const robotsAccess = verifySiteAccess({
        status: robotsRes.status === 404 ? 200 : robotsRes.status,
        headers: robotsRes.headers,
        body: robotsRes.status === 404 ? "" : robotsRes.body,
        now: params.now,
      });
      if (!robotsAccess.allowed) {
        return { allowed: false, access: robotsAccess };
      }
      robotsTxt = robotsRes.status === 200 ? robotsRes.body : "";
    } catch {
      robotsTxt = "";
    }
  }

  const pathCheck = verifySiteAccess({
    status: 200,
    body: "",
    robotsTxt,
    targetPath: params.targetPath,
    now: params.now,
  });
  if (!pathCheck.allowed) {
    return { allowed: false, access: pathCheck };
  }

  return { allowed: true, robotsTxt };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCssClassToken(selector: string): {
  tagName: string | null;
  className: string;
} {
  const trimmed = selector.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) {
    return { tagName: null, className: trimmed };
  }
  const tagPart = trimmed.slice(0, dotIndex).trim();
  const classPart = trimmed.slice(dotIndex + 1).trim();
  return {
    tagName: tagPart.length > 0 ? tagPart : null,
    className: classPart,
  };
}

function extractDefinitionListFields(
  html: string,
  config: ConnectorConfig
): { containerFound: boolean; fields: Map<string, string[]> } {
  const fields = new Map<string, string[]>();
  const containerAlternatives = config.detailContainerSelector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let containerMatch: RegExpExecArray | null = null;
  for (const alt of containerAlternatives) {
    const containerSelector = parseCssClassToken(alt);
    const containerTagPattern = containerSelector.tagName
      ? escapeRegExp(containerSelector.tagName)
      : "[a-zA-Z0-9-]+";
    const containerStartPattern = new RegExp(
      `<${containerTagPattern}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(containerSelector.className)}\\b[^"']*["'][^>]*>`,
      "i"
    );
    containerMatch = containerStartPattern.exec(html);
    if (containerMatch) break;
  }

  if (!containerMatch) {
    return { containerFound: false, fields };
  }

  const scopedHtml = html.slice(containerMatch.index);
  const dlAlternatives = config.definitionListSelector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const termTags = config.termSelector
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const descTags = config.descriptionSelector
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allTokenTags = [...termTags, ...descTags].map(escapeRegExp).join("|");

  const tokenPattern = new RegExp(
    `<(${allTokenTags})[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi"
  );

  for (const dlAlt of dlAlternatives) {
    const dlSelector = parseCssClassToken(dlAlt);
    const dlTag = escapeRegExp(dlSelector.tagName ?? "dl");
    const dlPattern = new RegExp(
      `<${dlTag}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(dlSelector.className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${dlTag}>`,
      "gi"
    );

    for (const dlMatch of scopedHtml.matchAll(dlPattern)) {
      const dlBody = dlMatch[1] ?? "";
      let currentTerm: string | null = null;
      for (const tokenMatch of dlBody.matchAll(tokenPattern)) {
        const tag = (tokenMatch[1] ?? "").toLowerCase();
        const text = stripHtmlTags(tokenMatch[2] ?? "");
        if (termTags.includes(tag)) {
          currentTerm = text;
          if (!fields.has(currentTerm)) {
            fields.set(currentTerm, []);
          }
        } else if (descTags.includes(tag) && currentTerm) {
          const list = fields.get(currentTerm) ?? [];
          if (text.length > 0) {
            list.push(text);
          }
          fields.set(currentTerm, list);
        }
      }
    }
  }

  return { containerFound: true, fields };
}

function getFieldList(
  fields: Map<string, string[]>,
  labelSpec: string
): string[] {
  for (const candidate of labelSpec.split("|")) {
    const trimmed = candidate.trim();
    const found = fields.get(trimmed);
    if (found && found.length > 0) {
      return found;
    }
  }
  return [];
}

export function parseTdlrFilingHtml(
  html: string,
  config: ConnectorConfig,
  meta: { sha256: string; nowIso: string }
):
  | { ok: true; project: Project }
  | { ok: false; invariantErrors: string[] } {
  if (html.trim().length === 0) {
    return {
      ok: false,
      invariantErrors: ["Empty HTML document received from portal"],
    };
  }

  const { containerFound, fields } = extractDefinitionListFields(html, config);
  if (!containerFound) {
    return {
      ok: false,
      invariantErrors: [
        `Missing detailContainerSelector "${config.detailContainerSelector}" in portal HTML`,
      ],
    };
  }

  const labels = config.fieldLabels;
  const getSingle = (labelSpec: string): string =>
    getFieldList(fields, labelSpec)[0] ?? "";
  const rawDesignFirm = labels.designFirmName
    ? getSingle(labels.designFirmName)
    : "";
  const sanitizedDesignFirm = rawDesignFirm
    ? sanitizeTextPii(rawDesignFirm)
    : undefined;

  const parsedProject = ProjectSchema.safeParse({
    projectNumber: getSingle(labels.projectNumber),
    projectName: sanitizeTextPii(getSingle(labels.projectName)),
    facilityName: sanitizeTextPii(getSingle(labels.facilityName)),
    ownerName: sanitizeTextPii(getSingle(labels.ownerName)),
    ...(sanitizedDesignFirm ? { designFirmName: sanitizedDesignFirm } : {}),
    locationAddress: sanitizeLocationAddressPii(
      getFieldList(fields, labels.locationAddress)
    ),
    county: sanitizeTextPii(getSingle(labels.county)),
    estimatedCostUsd: parseCurrencyUsd(getSingle(labels.estimatedCost)),
    squareFootage: parseSquareFootage(getSingle(labels.squareFootage)),
    typeOfWork: sanitizeTextPii(getSingle(labels.typeOfWork)),
    scopeOfWork: sanitizeTextPii(getSingle(labels.scopeOfWork)),
    currentStatus: sanitizeTextPii(getSingle(labels.currentStatus)),
    startDate: parseUsSlashDateToIso(getSingle(labels.startDate)),
    completionDate: parseUsSlashDateToIso(getSingle(labels.completionDate)),
    latestSourceArtifactHash: meta.sha256,
    updatedAt: meta.nowIso,
  });

  if (!parsedProject.success) {
    return {
      ok: false,
      invariantErrors: parsedProject.error.issues.map(
        (issue) => `${issue.path.join(".") || "document"}: ${issue.message}`
      ),
    };
  }

  return { ok: true, project: parsedProject.data };
}

function parseUsSlashDateToIso(raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) {
    return raw.trim();
  }
  const month = match[1]!.padStart(2, "0");
  const day = match[2]!.padStart(2, "0");
  const year = match[3]!;
  return `${year}-${month}-${day}`;
}

function parseCurrencyUsd(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return Number.NaN;
  }
  return Number.parseFloat(cleaned);
}

function parseSquareFootage(raw: string): number {
  const match = /^([\d,]+(?:\.\d+)?)/.exec(raw.trim());
  if (!match) {
    return Number.NaN;
  }
  const cleaned = match[1]!.replace(/,/g, "");
  return Number.parseFloat(cleaned);
}

function buildSourceArtifact(params: {
  sha256: string;
  connectorId: string;
  sourceUrl: string;
  contentType: string;
  rawByteLength: number;
  compressedByteLength: number;
  folder: "artifacts" | "quarantine";
  capturedAt: string;
  expiresAt: string | null;
}): SourceArtifact {
  return SourceArtifactSchema.parse({
    sha256: params.sha256,
    connectorId: params.connectorId,
    sourceUrl: params.sourceUrl,
    contentType: params.contentType,
    rawByteLength: params.rawByteLength,
    compressedByteLength: params.compressedByteLength,
    storageUri: `${ARTIFACT_BUCKET_URI}/${params.folder}/${params.sha256}.gz`,
    capturedAt: params.capturedAt,
    expiresAt: params.expiresAt,
    referencedByMilestone:
      params.folder === "quarantine" || params.expiresAt === null,
  });
}

export async function ingestTdlrFiling(
  input: {
    projectNumber: string;
    baseUrl?: string;
    now?: Date;
    robotsTxt?: string;
  },
  deps: {
    repository: GridlockRepository;
    pageLoader?: PageLoader;
    spanSink?: TelemetrySpanSink;
  }
): Promise<IngestFilingResult> {
  const startedWallMs = Date.now();
  const baseUrl = (input.baseUrl ?? DEFAULT_TDLR_BASE_URL).replace(/\/+$/, "");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const pageLoader = deps.pageLoader ?? defaultPageLoader;
  const targetPath = `/TABS/Search/Project/${encodeURIComponent(input.projectNumber)}`;
  const sourceUrl = `${baseUrl}${targetPath}`;
  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");

  const validProjectNumber = TdlrProjectNumberSchema.safeParse(
    input.projectNumber
  );
  const projectNumberProp = validProjectNumber.success
    ? { projectNumber: validProjectNumber.data }
    : {};

  const finalizeTelemetry = async (
    result: IngestFilingResult
  ): Promise<IngestFilingResult> => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    const isSuccess =
      result.status === "ingested" || result.status === "unchanged_artifact";
    const rawByteLength =
      result.status === "blocked_by_waf"
        ? 0
        : result.sourceArtifact.rawByteLength;
    const naiveTokensAvoided = isSuccess
      ? calculateNaiveTokensAvoided(rawByteLength)
      : 0;
    const estimatedCostSavedUsd = isSuccess
      ? calculateEstimatedCostSavedUsd(naiveTokensAvoided)
      : 0;

    await recordStageTelemetry(
      {
        stage: "tdlr_ingest",
        connectorId: config.connectorId,
        ...projectNumberProp,
        ...(result.status !== "blocked_by_waf"
          ? { sourceArtifactHash: result.sourceArtifact.sha256 }
          : {}),
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
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
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
      const blocked = await markBlockedByWaf(
        deps.repository,
        config.connectorId,
        nowIso,
        preflight.access
      );
      return finalizeTelemetry(blocked);
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
      const blocked = await markBlockedByWaf(
        deps.repository,
        config.connectorId,
        nowIso,
        accessCheck
      );
      return finalizeTelemetry(blocked);
    }

    const rawBuffer = Buffer.from(response.body, "utf-8");
    const sha256 = createHash("sha256").update(rawBuffer).digest("hex");

    const existingArtifact =
      await deps.repository.getSourceArtifactByHash(sha256);
    if (
      existingArtifact &&
      !existingArtifact.storageUri.includes("/quarantine/")
    ) {
      return finalizeTelemetry({
        status: "unchanged_artifact",
        sourceArtifact: existingArtifact,
      });
    }

    const gzipBuffer = gzipSync(rawBuffer);
    const plusNinetyDaysIso = new Date(
      now.getTime() + NINETY_DAYS_MS
    ).toISOString();

    const quarantineWithErrors = async (
      invariantErrors: string[]
    ): Promise<IngestFilingResult> => {
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
      await deps.repository.setConnectorStatus(
        config.connectorId,
        "selector_anomaly",
        nowIso
      );
      return finalizeTelemetry({
        status: "selector_anomaly",
        sourceArtifact: quarantinedArtifact,
        invariantErrors,
      });
    };

    const parsed = parseTdlrFilingHtml(response.body, config, {
      sha256,
      nowIso,
    });
    if (!parsed.ok) {
      return quarantineWithErrors(parsed.invariantErrors);
    }

    const project = parsed.project;
    const existingProject = await deps.repository.getProjectByNumber(
      project.projectNumber
    );
    const isMilestone =
      project.estimatedCostUsd >= MILESTONE_COST_THRESHOLD_USD ||
      (existingProject !== null &&
        existingProject.currentStatus !== project.currentStatus);

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
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
    throw error;
  }
}

export type TdlrDiscoveryMode = "backfill" | "daily";

export interface TdlrSearchFilter {
  field: "ProjectName" | "FacilityName" | "OwnerName";
  value: string;
}

export const DEFAULT_TDLR_SEARCH_FILTERS: readonly TdlrSearchFilter[] = [
  { field: "ProjectName", value: "Data Center" },
  { field: "ProjectName", value: "Datacenter" },
  { field: "FacilityName", value: "Data Center" },
  { field: "OwnerName", value: "Datacenter" },
  { field: "OwnerName", value: "QTS" },
  { field: "OwnerName", value: "CyrusOne" },
  { field: "OwnerName", value: "Compass" },
  { field: "OwnerName", value: "Colovore" },
];

export type SearchLoader = (
  url: string,
  formBody: string
) => Promise<PageLoaderResponse>;

export const defaultSearchLoader: SearchLoader = async (
  url: string,
  formBody: string
): Promise<PageLoaderResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": GRIDLOCK_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: formBody,
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "application/json; charset=utf-8",
    body,
    headers: headersToRecord(response.headers),
  };
};

export function parseTdlrCliArgs(argv: readonly string[]): {
  mode: TdlrDiscoveryMode;
} {
  return {
    mode: argv.includes("--backfill") ? "backfill" : "daily",
  };
}

const COMPUTE_INFRASTRUCTURE_KEYWORDS =
  /\b(?:data\s*centers?|datacenters?|qts|cyrusone|compass\s+datacenters?|colovore|substation|semiconductor|hyperscale|server\s+farm|colocation|ai\s+campus|compute)\b/i;

const NON_COMPUTE_FALSE_POSITIVE_PATTERN =
  /\b(?:shopping|community|fitness|daycare|recreation|senior|convention|retail)\s+center\b/i;

export function isComputeInfrastructureFiling(row: {
  ProjectName: string;
  FacilityName?: string;
  OwnerName?: string;
  ScopeOfWork?: string;
}): boolean {
  const combined = [
    row.ProjectName,
    row.FacilityName ?? "",
    row.OwnerName ?? "",
    row.ScopeOfWork ?? "",
  ].join(" ");

  if (
    NON_COMPUTE_FALSE_POSITIVE_PATTERN.test(combined) &&
    !/\b(?:data\s*centers?|datacenters?)\b/i.test(combined)
  ) {
    return false;
  }

  return COMPUTE_INFRASTRUCTURE_KEYWORDS.test(combined);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultJitterMs = (): number => Math.floor(Math.random() * 250);

export type TdlrDiscoverySweepResult =
  | {
      status: "completed";
      mode: TdlrDiscoveryMode;
      discoveredCount: number;
      ingestedProjectNumbers: string[];
      results: IngestFilingResult[];
      circuitBreakerTripped: boolean;
      skippedByCircuitBreakerCount: number;
      tokensUsed: 0;
    }
  | {
      status: "blocked_by_waf";
      mode: TdlrDiscoveryMode;
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

export async function runTdlrDiscoverySweep(
  input: {
    mode?: TdlrDiscoveryMode;
    baseUrl?: string;
    now?: Date;
    sinceDate?: Date;
    searchFilters?: readonly TdlrSearchFilter[];
    backfillStartYear?: number;
    backfillEndYear?: number;
    minDelayMs?: number;
    maxRecordsPerRun?: number;
  },
  deps: {
    repository: GridlockRepository;
    pageLoader?: PageLoader;
    searchLoader?: SearchLoader;
    sleep?: (ms: number) => Promise<void>;
    jitterMs?: () => number;
    spanSink?: TelemetrySpanSink;
  }
): Promise<TdlrDiscoverySweepResult> {
  const startedWallMs = Date.now();
  const mode: TdlrDiscoveryMode = input.mode ?? "daily";
  const baseUrl = (input.baseUrl ?? DEFAULT_TDLR_BASE_URL).replace(/\/+$/, "");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const pageLoader = deps.pageLoader ?? defaultPageLoader;
  const searchLoader = deps.searchLoader ?? defaultSearchLoader;
  const sleep = deps.sleep ?? defaultSleep;
  const jitterMs = deps.jitterMs ?? defaultJitterMs;
  const baseDelayMs = Math.max(
    MIN_POLITE_DELAY_MS,
    input.minDelayMs ?? MIN_POLITE_DELAY_MS
  );
  const maxRecordsPerRun = Math.min(
    MAX_RECORDS_PER_RUN,
    Math.max(1, input.maxRecordsPerRun ?? MAX_RECORDS_PER_RUN)
  );
  const backfillStartYear = input.backfillStartYear ?? 2024;
  const backfillEndYear = input.backfillEndYear ?? 2026;
  const effectiveSinceDate =
    input.sinceDate ??
    (mode === "daily"
      ? new Date(now.getTime() - DEFAULT_DAILY_LOOKBACK_MS)
      : undefined);

  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");
  const searchPath = "/TABS/Search/SearchProjects";

  const recordDiscoveryFailureTelemetry = async (
    status: "blocked_by_waf" | "aborted"
  ) => {
    const durationMs = Math.max(0, Date.now() - startedWallMs);
    const endedAt = new Date(now.getTime() + durationMs);
    await recordStageTelemetry(
      {
        stage: "tdlr_discovery_sweep",
        connectorId: config.connectorId,
        execution_mode: "deterministic",
        status,
        rawByteLength: 0,
        tokensUsed: 0,
        naiveTokensAvoided: 0,
        estimatedCostSavedUsd: 0,
        startedAt: now,
        endedAt,
        recordedAt: nowIso,
        attributes: { connectorId: config.connectorId, mode },
      },
      {
        repository: deps.repository,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );
  };

  let preflight: Awaited<ReturnType<typeof preflightRobotsTxt>>;
  const discoveredByNumber = new Map<string, TdlrSearchRow>();

  try {
    // 1. Preflight robots.txt once per sweep
    preflight = await preflightRobotsTxt({
      baseUrl,
      targetPath: searchPath,
      pageLoader,
      now,
    });
    if (!preflight.allowed) {
      const blocked = await markBlockedByWaf(
        deps.repository,
        config.connectorId,
        nowIso,
        preflight.access
      );
      await recordDiscoveryFailureTelemetry("blocked_by_waf");
      return { ...blocked, mode };
    }

    // 2. Enforce single-token guardrail on OwnerName filters
    const rawFilters = input.searchFilters ?? DEFAULT_TDLR_SEARCH_FILTERS;
    const safeFilters = rawFilters.filter((filter) => {
      const trimmed = filter.value.trim();
      if (!trimmed) return false;
      if (filter.field === "OwnerName" && /\s/.test(trimmed)) {
        return false;
      }
      return true;
    });

    // 3. Single-flight discovery queries (maxConcurrency: 1)
    const searchUrl = `${baseUrl}${searchPath}`;

    for (let i = 0; i < safeFilters.length; i += 1) {
      const filter = safeFilters[i]!;
      if (i > 0) {
        await sleep(baseDelayMs + Math.max(0, jitterMs()));
      }
      const formBody = new URLSearchParams({
        [filter.field]: filter.value.trim(),
        draw: String(i + 1),
        start: "0",
        length: "100",
      }).toString();

      const searchRes = await searchLoader(searchUrl, formBody);
      const searchAccess = verifySiteAccess({
        status: searchRes.status,
        headers: searchRes.headers,
        body: searchRes.body,
        robotsTxt: preflight.robotsTxt,
        targetPath: searchPath,
        now,
      });
      if (!searchAccess.allowed) {
        const blocked = await markBlockedByWaf(
          deps.repository,
          config.connectorId,
          nowIso,
          searchAccess
        );
        await recordDiscoveryFailureTelemetry("blocked_by_waf");
        return { ...blocked, mode };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(searchRes.body);
      } catch {
        continue;
      }

      const rawRows: unknown[] = Array.isArray(parsedJson)
        ? parsedJson
        : parsedJson !== null &&
            typeof parsedJson === "object" &&
            Array.isArray((parsedJson as { data?: unknown }).data)
          ? (parsedJson as { data: unknown[] }).data
          : [];

      for (const rawRow of rawRows) {
        const parsedRow = TdlrSearchRowSchema.safeParse(rawRow);
        if (!parsedRow.success) continue;
        const row = parsedRow.data;
        if (!isComputeInfrastructureFiling(row)) continue;

        const createdMs = Date.parse(row.ProjectCreatedOn);
        if (mode === "backfill") {
          if (Number.isNaN(createdMs)) continue;
          const createdYear = new Date(createdMs).getUTCFullYear();
          if (
            createdYear < backfillStartYear ||
            createdYear > backfillEndYear
          ) {
            continue;
          }
        }

        if (effectiveSinceDate) {
          if (
            Number.isNaN(createdMs) ||
            createdMs < effectiveSinceDate.getTime()
          ) {
            continue;
          }
        }

        if (!discoveredByNumber.has(row.ProjectNumber)) {
          discoveredByNumber.set(row.ProjectNumber, row);
        }
      }
    }
  } catch (error) {
    await recordDiscoveryFailureTelemetry("aborted");
    throw error;
  }

  // 4. Sort chronologically (ProjectCreatedOn ASC)
  const chronologicalRows = Array.from(discoveredByNumber.values()).sort(
    (a, b) => {
      const diff =
        Date.parse(a.ProjectCreatedOn) - Date.parse(b.ProjectCreatedOn);
      if (diff !== 0 && !Number.isNaN(diff)) {
        return diff;
      }
      return a.ProjectNumber.localeCompare(b.ProjectNumber);
    }
  );

  // 5. Enforce <= 100 records/run circuit breaker
  const discoveredCount = chronologicalRows.length;
  const circuitBreakerTripped = discoveredCount > maxRecordsPerRun;
  const skippedByCircuitBreakerCount = circuitBreakerTripped
    ? discoveredCount - maxRecordsPerRun
    : 0;
  const boundedRows = chronologicalRows.slice(0, maxRecordsPerRun);

  // 6. Ingest each filing single-flight with polite pacing (>= 1,500ms + jitter)
  const results: IngestFilingResult[] = [];
  const ingestedProjectNumbers: string[] = [];

  for (const row of boundedRows) {
    await sleep(baseDelayMs + Math.max(0, jitterMs()));
    const filingResult = await ingestTdlrFiling(
      {
        projectNumber: row.ProjectNumber,
        baseUrl,
        now,
        robotsTxt: preflight.robotsTxt,
      },
      {
        repository: deps.repository,
        pageLoader,
        ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
      }
    );

    if (filingResult.status === "blocked_by_waf") {
      return {
        status: "blocked_by_waf",
        mode,
        reason: filingResult.reason,
        ...(filingResult.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: filingResult.retryAfterSeconds }
          : {}),
        tokensUsed: 0,
      };
    }

    results.push(filingResult);
    if (filingResult.status === "ingested") {
      ingestedProjectNumbers.push(row.ProjectNumber);
    }
  }

  const sweepDurationMs = Math.max(0, Date.now() - startedWallMs);
  const sweepEndedAt = new Date(now.getTime() + sweepDurationMs);
  const sweepTokensAvoided = results.reduce((sum, r) => {
    if (r.status === "ingested" || r.status === "unchanged_artifact") {
      return sum + calculateNaiveTokensAvoided(r.sourceArtifact.rawByteLength);
    }
    return sum;
  }, 0);
  const sink = deps.spanSink ?? defaultSpanSink;
  sink(
    buildTelemetrySpan({
      stage: "tdlr_discovery_sweep",
      execution_mode: "deterministic",
      status:
        ingestedProjectNumbers.length > 0 ? "ingested" : "unchanged_artifact",
      startedAt: now,
      endedAt: sweepEndedAt,
      tokensUsed: 0,
      naiveTokensAvoided: sweepTokensAvoided,
      attributes: {
        connectorId: config.connectorId,
        mode,
        discoveredCount,
        ingestedCount: ingestedProjectNumbers.length,
      },
    })
  );

  return {
    status: "completed",
    mode,
    discoveredCount,
    ingestedProjectNumbers,
    results,
    circuitBreakerTripped,
    skippedByCircuitBreakerCount,
    tokensUsed: 0,
  };
}

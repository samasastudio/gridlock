import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  ObservationSchema,
  ProjectSchema,
  SourceArtifactSchema,
  type ConnectorConfig,
  type Observation,
  type Project,
  type SourceArtifact,
} from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";
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

export {
  DEFAULT_DAILY_LOOKBACK_MS,
  DEFAULT_TDLR_SEARCH_FILTERS,
  MAX_CONCURRENCY,
  MAX_RECORDS_PER_RUN,
  MIN_POLITE_DELAY_MS,
  defaultSearchLoader,
  isComputeInfrastructureFiling,
  parseTdlrCliArgs,
  runTdlrDiscoverySweep,
  type SearchLoader,
  type TdlrDiscoveryMode,
  type TdlrDiscoverySweepResult,
  type TdlrSearchFilter,
} from "./tdlr-discovery.ts";

export const DEFAULT_TDLR_BASE_URL = "https://www.tdlr.texas.gov";
export const ARTIFACT_BUCKET_URI = "gs://gridlock-artifacts";
export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
export const MILESTONE_COST_THRESHOLD_USD = 25_000_000;

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

export async function markBlockedByWaf(
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

export async function preflightRobotsTxt(params: {
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
  const containerSelector = parseCssClassToken(config.detailContainerSelector);
  const containerTagPattern = containerSelector.tagName
    ? escapeRegExp(containerSelector.tagName)
    : "[a-zA-Z0-9-]+";
  const containerStartPattern = new RegExp(
    `<${containerTagPattern}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(containerSelector.className)}\\b[^"']*["'][^>]*>`,
    "i"
  );
  const containerMatch = containerStartPattern.exec(html);
  if (!containerMatch) {
    return { containerFound: false, fields };
  }

  const scopedHtml = html.slice(containerMatch.index);
  const dlSelector = parseCssClassToken(config.definitionListSelector);
  const dlTag = escapeRegExp(dlSelector.tagName ?? "dl");

  const dlPattern = new RegExp(
    `<${dlTag}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(dlSelector.className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${dlTag}>`,
    "gi"
  );

  const tokenPattern = new RegExp(
    `<(${escapeRegExp(config.termSelector)}|${escapeRegExp(config.descriptionSelector)})[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi"
  );

  for (const dlMatch of scopedHtml.matchAll(dlPattern)) {
    const dlBody = dlMatch[1] ?? "";
    let currentTerm: string | null = null;
    for (const tokenMatch of dlBody.matchAll(tokenPattern)) {
      const tag = (tokenMatch[1] ?? "").toLowerCase();
      const text = stripHtmlTags(tokenMatch[2] ?? "");
      if (tag === config.termSelector.toLowerCase()) {
        currentTerm = text;
        if (!fields.has(currentTerm)) {
          fields.set(currentTerm, []);
        }
      } else if (
        tag === config.descriptionSelector.toLowerCase() &&
        currentTerm
      ) {
        const list = fields.get(currentTerm) ?? [];
        if (text.length > 0) {
          list.push(text);
        }
        fields.set(currentTerm, list);
      }
    }
  }

  return { containerFound: true, fields };
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
  }
): Promise<IngestFilingResult> {
  const baseUrl = (input.baseUrl ?? DEFAULT_TDLR_BASE_URL).replace(/\/+$/, "");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const pageLoader = deps.pageLoader ?? defaultPageLoader;
  const targetPath = `/TABS/Search/Project/${encodeURIComponent(input.projectNumber)}`;
  const sourceUrl = `${baseUrl}${targetPath}`;
  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");

  const preflight = await preflightRobotsTxt({
    baseUrl,
    targetPath,
    providedRobotsTxt: input.robotsTxt,
    pageLoader,
    now,
  });
  if (!preflight.allowed) {
    return markBlockedByWaf(
      deps.repository,
      config.connectorId,
      nowIso,
      preflight.access
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
    return markBlockedByWaf(
      deps.repository,
      config.connectorId,
      nowIso,
      accessCheck
    );
  }

  const rawBuffer = Buffer.from(response.body, "utf-8");
  const sha256 = createHash("sha256").update(rawBuffer).digest("hex");

  const existingArtifact =
    await deps.repository.getSourceArtifactByHash(sha256);
  if (
    existingArtifact &&
    !existingArtifact.storageUri.includes("/quarantine/")
  ) {
    return {
      status: "unchanged_artifact",
      sourceArtifact: existingArtifact,
    };
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
    return {
      status: "selector_anomaly",
      sourceArtifact: quarantinedArtifact,
      invariantErrors,
    };
  };

  if (response.body.trim().length === 0) {
    return quarantineWithErrors(["Empty HTML document received from portal"]);
  }

  const { containerFound, fields } = extractDefinitionListFields(
    response.body,
    config
  );
  if (!containerFound) {
    return quarantineWithErrors([
      `Missing detailContainerSelector "${config.detailContainerSelector}" in portal HTML`,
    ]);
  }

  const labels = config.fieldLabels;

  const getSingle = (label: string): string =>
    (fields.get(label) ?? [])[0] ?? "";
  const rawDesignFirm = labels.designFirmName
    ? getSingle(labels.designFirmName)
    : "";
  const sanitizedDesignFirm = rawDesignFirm
    ? sanitizeTextPii(rawDesignFirm)
    : undefined;

  const estimatedCostUsd = parseCurrencyUsd(getSingle(labels.estimatedCost));
  const squareFootage = parseSquareFootage(getSingle(labels.squareFootage));

  const parsedProject = ProjectSchema.safeParse({
    projectNumber: getSingle(labels.projectNumber),
    projectName: sanitizeTextPii(getSingle(labels.projectName)),
    facilityName: sanitizeTextPii(getSingle(labels.facilityName)),
    ownerName: sanitizeTextPii(getSingle(labels.ownerName)),
    ...(sanitizedDesignFirm ? { designFirmName: sanitizedDesignFirm } : {}),
    locationAddress: sanitizeLocationAddressPii(
      fields.get(labels.locationAddress) ?? []
    ),
    county: sanitizeTextPii(getSingle(labels.county)),
    estimatedCostUsd,
    squareFootage,
    typeOfWork: sanitizeTextPii(getSingle(labels.typeOfWork)),
    scopeOfWork: sanitizeTextPii(getSingle(labels.scopeOfWork)),
    currentStatus: sanitizeTextPii(getSingle(labels.currentStatus)),
    startDate: parseUsSlashDateToIso(getSingle(labels.startDate)),
    completionDate: parseUsSlashDateToIso(getSingle(labels.completionDate)),
    latestSourceArtifactHash: sha256,
    updatedAt: nowIso,
  });

  if (!parsedProject.success) {
    const invariantErrors = parsedProject.error.issues.map(
      (issue) => `${issue.path.join(".") || "document"}: ${issue.message}`
    );
    return quarantineWithErrors(invariantErrors);
  }

  const project = parsedProject.data;
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

  return {
    status: "ingested",
    sourceArtifact,
    project,
    observation,
  };
}

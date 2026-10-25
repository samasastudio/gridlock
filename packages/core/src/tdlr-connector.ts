import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  ObservationSchema,
  ProjectSchema,
  SourceArtifactSchema,
  TdlrSearchRowSchema,
  type ConnectorConfig,
  type Observation,
  type Project,
  type SourceArtifact,
  type TdlrSearchRow,
} from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";

export const GRIDLOCK_USER_AGENT =
  "GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)";

export const DEFAULT_TDLR_BASE_URL = "https://www.tdlr.texas.gov";
export const ARTIFACT_BUCKET_URI = "gs://gridlock-artifacts";
export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
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

export function createPlaywrightPageLoader(page: PlaywrightPageLike): PageLoader {
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
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "text/html; charset=utf-8",
    body,
    headers,
  };
};

export interface SiteAccessInput {
  status: number;
  headers?: Record<string, string | undefined>;
  body: string;
  robotsTxt?: string;
  targetPath?: string;
  userAgent?: string;
  now?: Date;
}

export type SiteAccessCheckResult =
  | {
      allowed: true;
      status: "ok";
      tokensUsed: 0;
    }
  | {
      allowed: false;
      status: "blocked_by_waf";
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

function getHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function parseRetryAfterSeconds(
  raw: string | undefined,
  now?: Date
): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const baseMs = now ? now.getTime() : Date.now();
    return Math.max(0, Math.ceil((dateMs - baseMs) / 1000));
  }
  return undefined;
}

export function isPathAllowedByRobotsTxt(
  robotsTxt: string,
  targetPath: string,
  userAgent: string = GRIDLOCK_USER_AGENT
): boolean {
  const uaLower = userAgent.toLowerCase();
  const botProductToken = (uaLower.split("/")[0] ?? "gridlockcivicresearchbot").trim();
  const lines = robotsTxt.split(/\r?\n/);

  let currentAgents: string[] = [];
  let seenRuleInGroup = false;
  const disallowPrefixes: string[] = [];
  const allowPrefixes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      currentAgents = [];
      seenRuleInGroup = false;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (seenRuleInGroup) {
        currentAgents = [];
        seenRuleInGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      continue;
    }

    const groupApplies = currentAgents.some(
      (ua) =>
        ua === "*" ||
        uaLower.includes(ua) ||
        botProductToken.includes(ua)
    );

    if (directive === "disallow") {
      seenRuleInGroup = true;
      if (groupApplies && value.length > 0) {
        disallowPrefixes.push(value);
      }
    } else if (directive === "allow") {
      seenRuleInGroup = true;
      if (groupApplies && value.length > 0) {
        allowPrefixes.push(value);
      }
    }
  }

  const normalizedPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  let longestDisallow = -1;
  for (const prefix of disallowPrefixes) {
    if (normalizedPath.startsWith(prefix) && prefix.length > longestDisallow) {
      longestDisallow = prefix.length;
    }
  }
  if (longestDisallow === -1) {
    return true;
  }

  let longestAllow = -1;
  for (const prefix of allowPrefixes) {
    if (normalizedPath.startsWith(prefix) && prefix.length > longestAllow) {
      longestAllow = prefix.length;
    }
  }

  return longestAllow >= longestDisallow;
}

const WAF_BODY_SIGNATURES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /_Incapsula_Resource/i, label: "Imperva Incapsula (_Incapsula_Resource)" },
  { pattern: /cf-mitigated/i, label: "Cloudflare mitigation (cf-mitigated)" },
  { pattern: /challenge-platform/i, label: "Cloudflare challenge-platform" },
  {
    pattern: /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i,
    label: "Cloudflare Turnstile challenge",
  },
  { pattern: /g-recaptcha/i, label: "Google reCAPTCHA challenge (g-recaptcha)" },
  {
    pattern: /<title>\s*TDLR TABS\s*-\s*Under Maintenance\s*<\/title>/i,
    label: "TDLR TABS Maintenance Window",
  },
];

export function verifySiteAccess(input: SiteAccessInput): SiteAccessCheckResult {
  const retryAfterSeconds = parseRetryAfterSeconds(
    getHeaderCaseInsensitive(input.headers, "retry-after"),
    input.now
  );

  if (
    input.robotsTxt &&
    input.targetPath &&
    !isPathAllowedByRobotsTxt(input.robotsTxt, input.targetPath, input.userAgent)
  ) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Disallowed by robots.txt for path ${input.targetPath}`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      tokensUsed: 0,
    };
  }

  if (input.status === 403 || input.status === 429 || input.status === 503) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Portal returned HTTP ${input.status} access/rate-limit status`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      tokensUsed: 0,
    };
  }

  const cfMitigated = getHeaderCaseInsensitive(input.headers, "cf-mitigated");
  if (cfMitigated) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Blocked by Cloudflare cf-mitigated header (${cfMitigated})`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      tokensUsed: 0,
    };
  }

  for (const sig of WAF_BODY_SIGNATURES) {
    if (sig.pattern.test(input.body)) {
      return {
        allowed: false,
        status: "blocked_by_waf",
        reason: `WAF/CAPTCHA challenge detected: ${sig.label}`,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        tokensUsed: 0,
      };
    }
  }

  return {
    allowed: true,
    status: "ok",
    tokensUsed: 0,
  };
}

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

const EMAIL_PII_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PII_PATTERN =
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b(?:\s*(?:ext\.?|x)\s*\d+)?/gi;
const LABELED_RESIDENTIAL_ADDRESS_PATTERN =
  /\b(?:Residential|Home|Personal)\s+Address\s*:\s*[^.;\n]+/gi;
const RESIDENTIAL_ADDRESS_INDICATOR_PATTERN =
  /\b(?:apt\.?|apartment|unit|lot|residence|residential|home\s+address|private\s+residence|single-family|condo)\b/i;

export function sanitizeTextPii(raw: string): string {
  return raw
    .replace(LABELED_RESIDENTIAL_ADDRESS_PATTERN, "[REDACTED_ADDRESS]")
    .replace(EMAIL_PII_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PII_PATTERN, "[REDACTED_PHONE]")
    .trim();
}

export function sanitizeLocationAddressPii(addressPartsOrText: string | string[]): string {
  const parts = Array.isArray(addressPartsOrText)
    ? addressPartsOrText.map((p) => p.trim()).filter(Boolean)
    : addressPartsOrText
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

  const joined = parts.join(", ");
  if (!RESIDENTIAL_ADDRESS_INDICATOR_PATTERN.test(joined)) {
    return sanitizeTextPii(joined);
  }

  // Retain trailing municipal/state/ZIP segment when present
  if (Array.isArray(addressPartsOrText) && parts.length >= 2) {
    const cityStateZip = sanitizeTextPii(parts[parts.length - 1]!);
    return `[REDACTED_ADDRESS], ${cityStateZip}`;
  }

  const cityStateMatch = /([A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/.exec(joined);
  if (cityStateMatch) {
    return `[REDACTED_ADDRESS], ${sanitizeTextPii(cityStateMatch[1]!)}`;
  }

  return "[REDACTED_ADDRESS]";
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
      } else if (tag === config.descriptionSelector.toLowerCase() && currentTerm) {
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

  let robotsTxt = input.robotsTxt;
  if (robotsTxt === undefined) {
    try {
      const robotsRes = await pageLoader(`${baseUrl}/robots.txt`);
      if (robotsRes.status === 200) {
        robotsTxt = robotsRes.body;
      } else if (
        robotsRes.status === 403 ||
        robotsRes.status === 429 ||
        robotsRes.status === 503
      ) {
        const robotsAccess = verifySiteAccess({
          status: robotsRes.status,
          headers: robotsRes.headers,
          body: robotsRes.body,
          now,
        });
        if (!robotsAccess.allowed) {
          await deps.repository.setConnectorStatus(
            config.connectorId,
            "blocked_by_waf",
            nowIso
          );
          return {
            status: "blocked_by_waf",
            reason: robotsAccess.reason,
            ...(robotsAccess.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: robotsAccess.retryAfterSeconds }
              : {}),
            tokensUsed: 0,
          };
        }
      }
    } catch {
      // If robots.txt fetch fails at network layer, defer to target page load
    }
  }

  if (robotsTxt !== undefined) {
    const preflightAccess = verifySiteAccess({
      status: 200,
      body: "",
      robotsTxt,
      targetPath,
    });
    if (!preflightAccess.allowed) {
      await deps.repository.setConnectorStatus(
        config.connectorId,
        "blocked_by_waf",
        nowIso
      );
      return {
        status: "blocked_by_waf",
        reason: preflightAccess.reason,
        tokensUsed: 0,
      };
    }
  }

  const response = await pageLoader(sourceUrl);
  const accessCheck = verifySiteAccess({
    status: response.status,
    headers: response.headers,
    body: response.body,
    robotsTxt,
    targetPath,
    now,
  });

  if (!accessCheck.allowed) {
    await deps.repository.setConnectorStatus(
      config.connectorId,
      "blocked_by_waf",
      nowIso
    );
    return {
      status: "blocked_by_waf",
      reason: accessCheck.reason,
      ...(accessCheck.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: accessCheck.retryAfterSeconds }
        : {}),
      tokensUsed: 0,
    };
  }

  const rawBuffer = Buffer.from(response.body, "utf-8");
  const sha256 = createHash("sha256").update(rawBuffer).digest("hex");

  const existingArtifact = await deps.repository.getSourceArtifactByHash(sha256);
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
  const plusNinetyDaysIso = new Date(now.getTime() + NINETY_DAYS_MS).toISOString();

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

  const getSingle = (label: string): string => (fields.get(label) ?? [])[0] ?? "";
  const rawDesignFirm = labels.designFirmName
    ? getSingle(labels.designFirmName)
    : "";
  const sanitizedDesignFirm = rawDesignFirm ? sanitizeTextPii(rawDesignFirm) : undefined;

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

  return {
    status: "ingested",
    sourceArtifact,
    project,
    observation,
  };
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
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "application/json; charset=utf-8",
    body,
    headers,
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
  }
): Promise<TdlrDiscoverySweepResult> {
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

  const config = await deps.repository.getActiveConnectorConfig("tdlr-tabs");

  // 1. Check robots.txt before discovery
  let robotsTxt = "";
  try {
    const robotsRes = await pageLoader(`${baseUrl}/robots.txt`);
    const robotsAccess = verifySiteAccess({
      status: robotsRes.status === 404 ? 200 : robotsRes.status,
      headers: robotsRes.headers,
      body: robotsRes.status === 404 ? "" : robotsRes.body,
      now,
    });
    if (!robotsAccess.allowed) {
      await deps.repository.setConnectorStatus(
        config.connectorId,
        "blocked_by_waf",
        nowIso
      );
      return {
        status: "blocked_by_waf",
        mode,
        reason: robotsAccess.reason,
        ...(robotsAccess.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: robotsAccess.retryAfterSeconds }
          : {}),
        tokensUsed: 0,
      };
    }
    if (robotsRes.status === 200) {
      robotsTxt = robotsRes.body;
    }
  } catch {
    // Proceed if robots.txt endpoint is unreachable
  }

  const searchPath = "/TABS/Search/SearchProjects";
  const searchAccessPreflight = verifySiteAccess({
    status: 200,
    body: "",
    robotsTxt,
    targetPath: searchPath,
  });
  if (!searchAccessPreflight.allowed) {
    await deps.repository.setConnectorStatus(
      config.connectorId,
      "blocked_by_waf",
      nowIso
    );
    return {
      status: "blocked_by_waf",
      mode,
      reason: searchAccessPreflight.reason,
      tokensUsed: 0,
    };
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
  const discoveredByNumber = new Map<string, TdlrSearchRow>();
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
      robotsTxt,
      targetPath: searchPath,
      now,
    });
    if (!searchAccess.allowed) {
      await deps.repository.setConnectorStatus(
        config.connectorId,
        "blocked_by_waf",
        nowIso
      );
      return {
        status: "blocked_by_waf",
        mode,
        reason: searchAccess.reason,
        ...(searchAccess.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: searchAccess.retryAfterSeconds }
          : {}),
        tokensUsed: 0,
      };
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
        if (createdYear < backfillStartYear || createdYear > backfillEndYear) {
          continue;
        }
      }

      if (input.sinceDate) {
        if (Number.isNaN(createdMs) || createdMs < input.sinceDate.getTime()) {
          continue;
        }
      }

      if (!discoveredByNumber.has(row.ProjectNumber)) {
        discoveredByNumber.set(row.ProjectNumber, row);
      }
    }
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
        robotsTxt,
      },
      {
        repository: deps.repository,
        pageLoader,
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

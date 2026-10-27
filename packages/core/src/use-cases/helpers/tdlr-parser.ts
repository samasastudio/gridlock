import {
  ARTIFACT_BUCKET_URI,
  ProjectSchema,
  SourceArtifactSchema,
  TdlrSearchRowSchema,
  type ConnectorConfig,
  type Project,
  type SourceArtifact,
  type TdlrDiscoveryMode,
  type TdlrSearchFilter,
  type TdlrSearchRow,
} from "../../interfaces/index.ts";
import {
  sanitizeLocationAddressPii,
  sanitizeTextPii,
} from "./pii-sanitizer.ts";

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
  if (dotIndex === -1) return { tagName: null, className: trimmed };
  const tagPart = trimmed.slice(0, dotIndex).trim();
  const classPart = trimmed.slice(dotIndex + 1).trim();
  return { tagName: tagPart.length > 0 ? tagPart : null, className: classPart };
}

function splitSelectorList(selector: string, lowerCase = false): string[] {
  return selector
    .split(",")
    .map((s) => (lowerCase ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
}

function extractDefinitionListFields(
  html: string,
  config: ConnectorConfig
): { containerFound: boolean; fields: Map<string, string[]> } {
  const fields = new Map<string, string[]>();
  let containerMatch: RegExpExecArray | null = null;

  for (const alt of splitSelectorList(config.detailContainerSelector)) {
    const sel = parseCssClassToken(alt);
    const tagPat = sel.tagName ? escapeRegExp(sel.tagName) : "[a-zA-Z0-9-]+";
    const startPat = new RegExp(
      `<${tagPat}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(sel.className)}\\b[^"']*["'][^>]*>`,
      "i"
    );
    containerMatch = startPat.exec(html);
    if (containerMatch) break;
  }

  if (!containerMatch) return { containerFound: false, fields };

  const scopedHtml = html.slice(containerMatch.index);
  const termTags = splitSelectorList(config.termSelector, true);
  const descTags = splitSelectorList(config.descriptionSelector, true);
  const allTags = [...termTags, ...descTags].map(escapeRegExp).join("|");
  const tokenPattern = new RegExp(`<(${allTags})[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");

  for (const dlAlt of splitSelectorList(config.definitionListSelector)) {
    const dlSel = parseCssClassToken(dlAlt);
    const dlTag = escapeRegExp(dlSel.tagName ?? "dl");
    const dlPattern = new RegExp(
      `<${dlTag}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(dlSel.className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${dlTag}>`,
      "gi"
    );

    for (const dlMatch of scopedHtml.matchAll(dlPattern)) {
      let currentTerm: string | null = null;
      for (const tokenMatch of (dlMatch[1] ?? "").matchAll(tokenPattern)) {
        const tag = (tokenMatch[1] ?? "").toLowerCase();
        const text = stripHtmlTags(tokenMatch[2] ?? "");
        if (termTags.includes(tag)) {
          currentTerm = text;
          if (!fields.has(currentTerm)) fields.set(currentTerm, []);
        } else if (descTags.includes(tag) && currentTerm) {
          const list = fields.get(currentTerm) ?? [];
          if (text.length > 0) list.push(text);
          fields.set(currentTerm, list);
        }
      }
    }
  }

  return { containerFound: true, fields };
}

function getFieldList(fields: Map<string, string[]>, labelSpec: string): string[] {
  for (const candidate of labelSpec.split("|")) {
    const found = fields.get(candidate.trim());
    if (found && found.length > 0) return found;
  }
  return [];
}

function parseUsSlashDateToIso(raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return raw.trim();
  return `${match[3]!}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

function parseCurrencyUsd(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number.parseFloat(cleaned) : Number.NaN;
}

function parseSquareFootage(raw: string): number {
  const match = /^([\d,]+(?:\.\d+)?)/.exec(raw.trim());
  return match ? Number.parseFloat(match[1]!.replace(/,/g, "")) : Number.NaN;
}

export function buildSourceArtifact(params: {
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
    ...params,
    storageUri: `${ARTIFACT_BUCKET_URI}/${params.folder}/${params.sha256}.gz`,
    referencedByMilestone: params.folder === "quarantine" || params.expiresAt === null,
  });
}

export function parseTdlrFilingHtml(
  html: string,
  config: ConnectorConfig,
  meta: { sha256: string; nowIso: string }
): { ok: true; project: Project } | { ok: false; invariantErrors: string[] } {
  if (html.trim().length === 0) {
    return { ok: false, invariantErrors: ["Empty HTML document received from portal"] };
  }

  const { containerFound, fields } = extractDefinitionListFields(html, config);
  if (!containerFound) {
    return {
      ok: false,
      invariantErrors: [`Missing detailContainerSelector "${config.detailContainerSelector}" in portal HTML`],
    };
  }

  const labels = config.fieldLabels;
  const getSingle = (spec: string): string => getFieldList(fields, spec)[0] ?? "";
  const rawDesignFirm = labels.designFirmName ? getSingle(labels.designFirmName) : "";
  const sanitizedDesignFirm = rawDesignFirm ? sanitizeTextPii(rawDesignFirm) : undefined;

  const parsedProject = ProjectSchema.safeParse({
    projectNumber: getSingle(labels.projectNumber),
    projectName: sanitizeTextPii(getSingle(labels.projectName)),
    facilityName: sanitizeTextPii(getSingle(labels.facilityName)),
    ownerName: sanitizeTextPii(getSingle(labels.ownerName)),
    ...(sanitizedDesignFirm ? { designFirmName: sanitizedDesignFirm } : {}),
    locationAddress: sanitizeLocationAddressPii(getFieldList(fields, labels.locationAddress)),
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

export function parseTdlrCliArgs(argv: readonly string[]): { mode: TdlrDiscoveryMode } {
  return { mode: argv.includes("--backfill") ? "backfill" : "daily" };
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
  const combined = [row.ProjectName, row.FacilityName ?? "", row.OwnerName ?? "", row.ScopeOfWork ?? ""].join(" ");
  if (NON_COMPUTE_FALSE_POSITIVE_PATTERN.test(combined) && !/\b(?:data\s*centers?|datacenters?)\b/i.test(combined)) {
    return false;
  }
  return COMPUTE_INFRASTRUCTURE_KEYWORDS.test(combined);
}

export function sanitizeDiscoverySearchFilters(filters: readonly TdlrSearchFilter[]): TdlrSearchFilter[] {
  return filters.filter((filter) => {
    const trimmed = filter.value.trim();
    return Boolean(trimmed) && !(filter.field === "OwnerName" && /\s/.test(trimmed));
  });
}

export function collectQualifyingDiscoveryRows(params: {
  rawJsonBody: string;
  mode: TdlrDiscoveryMode;
  backfillStartYear: number;
  backfillEndYear: number;
  effectiveSinceDate: Date | undefined;
  discoveredByNumber: Map<string, TdlrSearchRow>;
}): void {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawJsonBody);
  } catch {
    return;
  }

  const rawRows: unknown[] = Array.isArray(parsedJson)
    ? parsedJson
    : parsedJson !== null && typeof parsedJson === "object" && Array.isArray((parsedJson as { data?: unknown }).data)
      ? (parsedJson as { data: unknown[] }).data
      : [];

  for (const rawRow of rawRows) {
    const parsedRow = TdlrSearchRowSchema.safeParse(rawRow);
    if (!parsedRow.success || !isComputeInfrastructureFiling(parsedRow.data)) continue;
    const row = parsedRow.data;
    const createdMs = Date.parse(row.ProjectCreatedOn);

    if (params.mode === "backfill") {
      if (Number.isNaN(createdMs)) continue;
      const year = new Date(createdMs).getUTCFullYear();
      if (year < params.backfillStartYear || year > params.backfillEndYear) continue;
    }
    if (params.effectiveSinceDate && (Number.isNaN(createdMs) || createdMs < params.effectiveSinceDate.getTime())) {
      continue;
    }
    if (!params.discoveredByNumber.has(row.ProjectNumber)) {
      params.discoveredByNumber.set(row.ProjectNumber, row);
    }
  }
}

export function sortDiscoveryRowsChronologically(rows: Iterable<TdlrSearchRow>): TdlrSearchRow[] {
  return Array.from(rows).sort((a, b) => {
    const diff = Date.parse(a.ProjectCreatedOn) - Date.parse(b.ProjectCreatedOn);
    return diff !== 0 && !Number.isNaN(diff) ? diff : a.ProjectNumber.localeCompare(b.ProjectNumber);
  });
}

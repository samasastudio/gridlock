import {
  ARTIFACT_BUCKET_URI,
  ProjectSchema,
  SourceArtifactSchema,
  type ConnectorConfig,
  type Project,
  type SourceArtifact,
} from "../../interfaces/index.ts";
import { sanitizeLocationAddressPii, sanitizeTextPii } from "./pii-sanitizer.ts";

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

function parseCssClassToken(selector: string): { tagName: string | null; className: string } {
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

function findDetailContainerMatch(html: string, detailContainerSelector: string): RegExpExecArray | null {
  return (
    splitSelectorList(detailContainerSelector)
      .map((alt) => {
        const sel = parseCssClassToken(alt);
        const tagPat = sel.tagName ? escapeRegExp(sel.tagName) : "[a-zA-Z0-9-]+";
        const startPat = new RegExp(
          `<${tagPat}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(sel.className)}\\b[^"']*["'][^>]*>`,
          "i"
        );
        return startPat.exec(html);
      })
      .find((match): match is RegExpExecArray => match !== null) ?? null
  );
}

interface DefinitionToken {
  readonly tag: string;
  readonly text: string;
}

function extractDefinitionListBlocks(scopedHtml: string, definitionListSelector: string): string[] {
  return splitSelectorList(definitionListSelector).flatMap((dlSelector) => {
    const { tagName, className } = parseCssClassToken(dlSelector);
    const dlTag = escapeRegExp(tagName ?? "dl");
    const dlPattern = new RegExp(
      `<${dlTag}\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${dlTag}>`,
      "gi"
    );
    return Array.from(scopedHtml.matchAll(dlPattern), (match) => match[1] ?? "");
  });
}

function tokenizeDefinitionListBlocks(
  dlBlocks: readonly string[],
  termTags: readonly string[],
  descTags: readonly string[]
): DefinitionToken[] {
  const allTags = [...termTags, ...descTags].map(escapeRegExp).join("|");
  const tokenPattern = new RegExp(`<(${allTags})[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  return dlBlocks.flatMap((dlHtml) =>
    Array.from(dlHtml.matchAll(tokenPattern), (match) => ({
      tag: (match[1] ?? "").toLowerCase(),
      text: stripHtmlTags(match[2] ?? ""),
    }))
  );
}

function groupTokensByTerm(
  tokens: readonly DefinitionToken[],
  termTags: readonly string[],
  descTags: readonly string[]
): Map<string, string[]> {
  const grouped = tokens.reduce<{ currentTerm: string | null; entries: Record<string, string[]> }>(
    (state, token) => {
      if (termTags.includes(token.tag)) {
        const existing = state.entries[token.text] ?? [];
        return { currentTerm: token.text, entries: { ...state.entries, [token.text]: existing } };
      }
      if (descTags.includes(token.tag) && state.currentTerm && token.text.length > 0) {
        const existing = state.entries[state.currentTerm] ?? [];
        return {
          currentTerm: state.currentTerm,
          entries: { ...state.entries, [state.currentTerm]: [...existing, token.text] },
        };
      }
      return state;
    },
    { currentTerm: null, entries: {} }
  );
  return new Map(Object.entries(grouped.entries));
}

function extractDefinitionListFields(
  html: string,
  config: ConnectorConfig
): { containerFound: boolean; fields: Map<string, string[]> } {
  const containerMatch = findDetailContainerMatch(html, config.detailContainerSelector);
  if (!containerMatch) return { containerFound: false, fields: new Map() };

  const scopedHtml = html.slice(containerMatch.index);
  const termTags = splitSelectorList(config.termSelector, true);
  const descTags = splitSelectorList(config.descriptionSelector, true);
  const dlBlocks = extractDefinitionListBlocks(scopedHtml, config.definitionListSelector);
  const tokens = tokenizeDefinitionListBlocks(dlBlocks, termTags, descTags);
  const fields = groupTokensByTerm(tokens, termTags, descTags);

  return { containerFound: true, fields };
}

function getFieldList(fields: Map<string, string[]>, labelSpec: string): string[] {
  return (
    labelSpec
      .split("|")
      .map((candidate) => fields.get(candidate.trim()) ?? [])
      .find((list) => list.length > 0) ?? []
  );
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

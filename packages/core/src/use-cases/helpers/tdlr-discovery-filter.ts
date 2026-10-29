import {
  TdlrSearchRowSchema,
  type TdlrDiscoveryMode,
  type TdlrSearchFilter,
  type TdlrSearchRow,
} from "../../interfaces/index.ts";

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

function tryParseSearchRowsJson(rawJsonBody: string): unknown[] {
  try {
    const parsedJson: unknown = JSON.parse(rawJsonBody);
    if (Array.isArray(parsedJson)) return parsedJson;
    if (parsedJson !== null && typeof parsedJson === "object" && Array.isArray((parsedJson as { data?: unknown }).data)) {
      return (parsedJson as { data: unknown[] }).data;
    }
    return [];
  } catch {
    return [];
  }
}

function isRowWithinDiscoveryWindow(
  row: TdlrSearchRow,
  params: { mode: TdlrDiscoveryMode; backfillStartYear: number; backfillEndYear: number; effectiveSinceDate: Date | undefined }
): boolean {
  const createdMs = Date.parse(row.ProjectCreatedOn);
  if (params.mode === "backfill") {
    if (Number.isNaN(createdMs)) return false;
    const year = new Date(createdMs).getUTCFullYear();
    if (year < params.backfillStartYear || year > params.backfillEndYear) return false;
  }
  return !(params.effectiveSinceDate && (Number.isNaN(createdMs) || createdMs < params.effectiveSinceDate.getTime()));
}

export function extractQualifyingDiscoveryRows(params: {
  rawJsonBody: string;
  mode: TdlrDiscoveryMode;
  backfillStartYear: number;
  backfillEndYear: number;
  effectiveSinceDate: Date | undefined;
}): TdlrSearchRow[] {
  return tryParseSearchRowsJson(params.rawJsonBody)
    .map((rawRow) => TdlrSearchRowSchema.safeParse(rawRow))
    .filter(
      (parsed): parsed is { success: true; data: TdlrSearchRow } =>
        parsed.success &&
        isComputeInfrastructureFiling(parsed.data) &&
        isRowWithinDiscoveryWindow(parsed.data, params)
    )
    .map(({ data }) => data);
}

export function sortDiscoveryRowsChronologically(rows: Iterable<TdlrSearchRow>): TdlrSearchRow[] {
  return Array.from(rows).sort((a, b) => {
    const diff = Date.parse(a.ProjectCreatedOn) - Date.parse(b.ProjectCreatedOn);
    return diff !== 0 && !Number.isNaN(diff) ? diff : a.ProjectNumber.localeCompare(b.ProjectNumber);
  });
}

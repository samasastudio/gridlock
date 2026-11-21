import type { IsoCalendarDate } from "@samasastudio/gridlock-core/schemas";

const ESCAPED_AST_METACHAR_PATTERN = /\\([\\<>{}`*_~[\]])/g;
const MS_PER_DAY = 86_400_000;
const AVG_DAYS_PER_MONTH = 30.4375;

export interface BuildWindowSummary {
  readonly value: number;
  readonly unitSuffix: string;
  readonly rangeLabel: string;
}

export function unescapeAstProse(value: string): string {
  return value.replace(ESCAPED_AST_METACHAR_PATTERN, "$1");
}

export function computeCostPerSqFtUsd(estimatedCostUsd: number, squareFootage: number): number {
  return Math.round(estimatedCostUsd / squareFootage);
}

function parseIsoDateUtcMs(isoDate: IsoCalendarDate): number {
  const [yearRaw, monthRaw, dayRaw] = isoDate.split("-");
  return Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw));
}

export function computeBuildWindowSummary(
  startDate: IsoCalendarDate,
  completionDate: IsoCalendarDate
): BuildWindowSummary {
  const diffDays = Math.max(
    0,
    Math.round((parseIsoDateUtcMs(completionDate) - parseIsoDateUtcMs(startDate)) / MS_PER_DAY)
  );
  const rangeLabel = `${startDate} → ${completionDate}`;

  if (diffDays < 45) {
    return {
      value: diffDays,
      unitSuffix: diffDays === 1 ? " day" : " days",
      rangeLabel,
    };
  }

  const months = Math.max(1, Math.round(diffDays / AVG_DAYS_PER_MONTH));

  return {
    value: months,
    unitSuffix: months === 1 ? " mo" : " mos",
    rangeLabel,
  };
}

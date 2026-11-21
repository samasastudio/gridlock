import type {
  CitedObservation,
  IsoCalendarDate,
  Observation,
} from "@samasastudio/gridlock-core/schemas";

const ESCAPED_AST_METACHAR_PATTERN = /\\([\\<>{}`*_~[\]])/g;
const MS_PER_DAY = 86_400_000;
const AVG_DAYS_PER_MONTH = 30.4375;

export interface BuildWindowSummary {
  readonly value: number;
  readonly unitSuffix: string;
  readonly rangeLabel: string;
}

export interface TimelineEntryViewModel {
  readonly citedObservation: CitedObservation;
  readonly costPerSqFtUsd: number;
  readonly deltas: readonly string[];
}

export interface ObservationTrajectorySummary {
  readonly snapshotsCount: number;
  readonly milestoneCount: number;
  readonly peakCapitalUsd: number;
  readonly latestCapitalUsd: number;
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

function formatSignedDelta(delta: number, prefix: string, suffix: string): string {
  const sign = delta > 0 ? "+" : "−";
  const magnitude = Math.abs(Math.round(delta)).toLocaleString("en-US");
  return `${sign}${prefix}${magnitude}${suffix}`;
}

function computeObservationDeltas(
  current: Observation,
  previous: Observation | undefined
): readonly string[] {
  if (!previous) {
    return ["Initial filing"];
  }

  const costDelta = current.estimatedCostUsd - previous.estimatedCostUsd;
  const sqftDelta = current.squareFootage - previous.squareFootage;
  const statusChanged = current.status !== previous.status;

  const changes = [
    ...(costDelta !== 0 ? [formatSignedDelta(costDelta, "$", " capital")] : []),
    ...(sqftDelta !== 0 ? [formatSignedDelta(sqftDelta, "", " sq ft")] : []),
    ...(statusChanged
      ? [`${unescapeAstProse(previous.status)} → ${unescapeAstProse(current.status)}`]
      : []),
  ];

  return changes.length > 0 ? changes : ["Scope narrative revision"];
}

function compareCitedObservations(left: CitedObservation, right: CitedObservation): number {
  const timeDiff =
    Date.parse(left.observation.observedAt) - Date.parse(right.observation.observedAt);

  if (timeDiff !== 0) {
    return timeDiff;
  }

  const projectDiff = left.observation.projectNumber.localeCompare(
    right.observation.projectNumber
  );

  if (projectDiff !== 0) {
    return projectDiff;
  }

  return left.observation.id.localeCompare(right.observation.id);
}

export function buildObservationTimelineEntries(
  observations: readonly CitedObservation[]
): readonly TimelineEntryViewModel[] {
  const sortedObservations = [...observations].sort(compareCitedObservations);
  const initialAcc: {
    readonly entries: readonly TimelineEntryViewModel[];
    readonly lastByProject: Readonly<Record<string, Observation>>;
  } = {
    entries: [],
    lastByProject: {},
  };

  return sortedObservations.reduce((acc, item) => {
    const obs = item.observation;
    const previous = acc.lastByProject[obs.projectNumber];
    const entry: TimelineEntryViewModel = {
      citedObservation: item,
      costPerSqFtUsd: computeCostPerSqFtUsd(obs.estimatedCostUsd, obs.squareFootage),
      deltas: computeObservationDeltas(obs, previous),
    };

    return {
      entries: [...acc.entries, entry],
      lastByProject: {
        ...acc.lastByProject,
        [obs.projectNumber]: obs,
      },
    };
  }, initialAcc).entries;
}

export function summarizeObservationTrajectory(
  observations: readonly CitedObservation[]
): ObservationTrajectorySummary {
  const sortedObservations = [...observations].sort(compareCitedObservations);
  const latestEntry = sortedObservations[sortedObservations.length - 1];

  return {
    snapshotsCount: sortedObservations.length,
    milestoneCount: sortedObservations.filter((item) => item.observation.isMilestone).length,
    peakCapitalUsd: sortedObservations.reduce(
      (max, item) => Math.max(max, item.observation.estimatedCostUsd),
      0
    ),
    latestCapitalUsd: latestEntry ? latestEntry.observation.estimatedCostUsd : 0,
  };
}

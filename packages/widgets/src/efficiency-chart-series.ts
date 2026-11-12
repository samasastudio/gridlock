import type { EfficiencyLedger, TelemetryRun } from "@samasastudio/gridlock-core/schemas";

export interface ChartPoint {
  x: number;
  avoidedY: number;
  actualY: number;
  isRepairRun: boolean;
  interactionId?: string;
  recordedAt?: string;
}

export const SVG_WIDTH = 760;
export const SVG_HEIGHT = 156;
export const PAD_X = 10;
export const PAD_TOP = 14;
export const PAD_BOTTOM = 16;

export function buildCumulativeSeries(
  ledger: EfficiencyLedger,
  connectorId?: string
): {
  points: ChartPoint[];
  startDate: string | null;
  endDate: string | null;
  sampledCount: number;
} {
  const sorted: TelemetryRun[] = [...ledger.recentRuns].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const innerWidth = SVG_WIDTH - PAD_X * 2;
  const innerHeight = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const bottomY = PAD_TOP + innerHeight;

  if (sorted.length === 0) {
    const maxVal = Math.max(1, ledger.naiveTokensAvoided, ledger.actualTokensUsed);
    const endAvoidedY = bottomY - (ledger.naiveTokensAvoided / maxVal) * innerHeight;
    const endActualY = bottomY - (ledger.actualTokensUsed / maxVal) * innerHeight;
    return {
      points: [
        { x: PAD_X, avoidedY: bottomY, actualY: bottomY, isRepairRun: false },
        { x: PAD_X + innerWidth, avoidedY: Number(endAvoidedY.toFixed(2)), actualY: Number(endActualY.toFixed(2)), isRepairRun: false },
      ],
      startDate: null,
      endDate: ledger.updatedAt.slice(0, 10),
      sampledCount: ledger.totalRunsCount,
    };
  }

  const windowSeries = sorted.reduce<Array<{ run: TelemetryRun; avoided: number; actual: number }>>((acc, run) => {
    const prev = acc[acc.length - 1];
    acc.push({
      run,
      avoided: (prev?.avoided ?? 0) + run.naiveTokensAvoided,
      actual: (prev?.actual ?? 0) + run.tokensUsed,
    });
    return acc;
  }, []);

  const windowEnd = windowSeries[windowSeries.length - 1]!;
  const preWindowAvoided = Math.max(0, ledger.naiveTokensAvoided - windowEnd.avoided);
  const preWindowActual = Math.max(0, ledger.actualTokensUsed - windowEnd.actual);
  const maxY = Math.max(1, preWindowAvoided + windowEnd.avoided, preWindowActual + windowEnd.actual);
  const toY = (val: number) => Number((bottomY - (val / maxY) * innerHeight).toFixed(2));

  const originPoint: ChartPoint = {
    x: PAD_X,
    avoidedY: toY(preWindowAvoided),
    actualY: toY(preWindowActual),
    isRepairRun: false,
  };
  const stepCount = Math.max(1, windowSeries.length);
  const mappedPoints: ChartPoint[] = windowSeries.map((item, idx) => ({
    x: Number((PAD_X + ((idx + 1) / stepCount) * innerWidth).toFixed(2)),
    avoidedY: toY(preWindowAvoided + item.avoided),
    actualY: toY(preWindowActual + item.actual),
    isRepairRun:
      item.run.execution_mode === "agentic" &&
      item.run.stage === "repair_agent" &&
      item.run.status === "agentic_completed" &&
      (!connectorId || item.run.connectorId === connectorId),
    interactionId: item.run.interactionId,
    recordedAt: item.run.recordedAt,
  }));

  return {
    points: [originPoint, ...mappedPoints],
    startDate: sorted[0]?.recordedAt.slice(0, 10) ?? null,
    endDate: sorted[sorted.length - 1]?.recordedAt.slice(0, 10) ?? null,
    sampledCount: sorted.length,
  };
}

export function toPathD(points: ChartPoint[], key: "avoidedY" | "actualY"): string {
  return points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x} ${pt[key]}`).join(" ");
}

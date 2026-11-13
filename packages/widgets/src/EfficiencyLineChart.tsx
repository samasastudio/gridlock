import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import type { EfficiencyLedger } from "@samasastudio/gridlock-core/schemas";
import { EDITORIAL_EASE } from "./DossierPrimitives.tsx";
import {
  buildCumulativeSeries,
  PAD_BOTTOM,
  PAD_TOP,
  PAD_X,
  SVG_HEIGHT,
  SVG_WIDTH,
  toPathD,
} from "./efficiency-chart-series.ts";

export function EfficiencyLineChart(props: {
  baseId: string;
  ledger: EfficiencyLedger;
  connectorId?: string;
  selectableInteractions?: ReadonlyMap<string, string>;
  activeInteractionId?: string;
  onSelectInteraction?: (interactionId: string) => void;
}) {
  const { activeInteractionId, baseId, connectorId, ledger, onSelectInteraction, selectableInteractions } = props;
  const { points, startDate, endDate, sampledCount } = buildCumulativeSeries(ledger, connectorId);
  const bottomY = SVG_HEIGHT - PAD_BOTTOM;
  const midY = Number(((PAD_TOP + bottomY) / 2).toFixed(2));
  const avoidedLineD = toPathD(points, "avoidedY");
  const actualLineD = toPathD(points, "actualY");
  const lastPt = points[points.length - 1]!;
  const areaD = `${avoidedLineD} L${lastPt.x} ${bottomY} L${PAD_X} ${bottomY} Z`;
  const repairPoints = points.filter((pt) => pt.isRepairRun);

  return (
    <figure className="gridlock-chart-frame" data-chart="cumulative-efficiency" aria-labelledby={`${baseId}-chart-caption`}>
      <figcaption id={`${baseId}-chart-caption`} className="gridlock-chart-header">
        <span className="gridlock-chart-title">Cumulative Tokens Avoided Across Runs</span>
        <span className="gridlock-chart-legend">
          <span className="gridlock-legend-item">
            <span className="gridlock-legend-swatch" data-swatch="avoided" aria-hidden="true" />
            <span>Avoided ({ledger.naiveTokensAvoided.toLocaleString("en-US")})</span>
          </span>
          <span className="gridlock-legend-item">
            <span className="gridlock-legend-swatch" data-swatch="actual" aria-hidden="true" />
            <span>Actual LLM spend ({ledger.actualTokensUsed.toLocaleString("en-US")})</span>
          </span>
        </span>
      </figcaption>

      <svg
        className="gridlock-line-svg"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="group"
        aria-label={`Cumulative tokens avoided climbing to ${ledger.naiveTokensAvoided.toLocaleString("en-US")} versus ${ledger.actualTokensUsed.toLocaleString("en-US")} actual LLM tokens used`}
      >
        <line x1={PAD_X} y1={PAD_TOP} x2={SVG_WIDTH - PAD_X} y2={PAD_TOP} stroke="var(--gridlock-border)" strokeDasharray="2 4" />
        <line x1={PAD_X} y1={midY} x2={SVG_WIDTH - PAD_X} y2={midY} stroke="var(--gridlock-border)" strokeDasharray="2 4" />
        <line x1={PAD_X} y1={bottomY} x2={SVG_WIDTH - PAD_X} y2={bottomY} stroke="var(--gridlock-border-strong)" />
        <motion.path
          key={`area-${avoidedLineD}`}
          d={areaD}
          fill="var(--gridlock-ink)"
          fillOpacity="0.06"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.25, delay: 0.45, ease: EDITORIAL_EASE }}
        />
        <motion.path
          key={`avoided-${avoidedLineD}`}
          data-series="avoided"
          d={avoidedLineD}
          fill="none"
          stroke="var(--gridlock-ink)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.45, delay: 0.12, ease: EDITORIAL_EASE }}
        />
        <motion.path
          key={`actual-${actualLineD}`}
          data-series="actual"
          d={actualLineD}
          fill="none"
          stroke="var(--gridlock-accent)"
          strokeWidth="1.75"
          strokeDasharray="4 4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.95, delay: 0.22, ease: EDITORIAL_EASE }}
        />
        <motion.circle
          key={`tip-${lastPt.x}-${lastPt.avoidedY}`}
          cx={lastPt.x}
          cy={lastPt.avoidedY}
          r="3.5"
          fill="var(--gridlock-ink)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, delay: 1.3, ease: EDITORIAL_EASE }}
        />

        {repairPoints.map((pt, idx) => {
          const versionLabel = pt.interactionId ? selectableInteractions?.get(pt.interactionId) : undefined;
          const interactive = Boolean(pt.interactionId && versionLabel && onSelectInteraction);
          const isSelected = Boolean(interactive && pt.interactionId === activeInteractionId);
          const dateStr = pt.recordedAt?.slice(0, 10) ?? "agentic";
          const markerLabel = versionLabel ? `Out-of-Band Repair ${versionLabel} (${dateStr})` : `Out-of-Band Repair (${dateStr})`;
          const selectMarker = interactive ? () => onSelectInteraction!(pt.interactionId!) : undefined;
          const handleKeyDown = interactive
            ? (e: KeyboardEvent<SVGRectElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectInteraction!(pt.interactionId!);
                }
              }
            : undefined;
          return (
            <motion.rect
              key={`${pt.interactionId ?? idx}`}
              x={pt.x - 4}
              y={pt.actualY - 4}
              width="8"
              height="8"
              fill={isSelected ? "var(--gridlock-accent)" : "var(--gridlock-paper)"}
              stroke="var(--gridlock-accent)"
              strokeWidth="2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.65, delay: 0.55 + idx * 0.24, ease: EDITORIAL_EASE }}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-pressed={interactive ? isSelected : undefined}
              aria-label={interactive ? `Inspect ${markerLabel}` : undefined}
              data-active-marker={isSelected ? "true" : undefined}
              className={interactive ? "gridlock-chart-marker" : undefined}
              onClick={selectMarker}
              onKeyDown={handleKeyDown}
            >
              <title>{markerLabel}</title>
            </motion.rect>
          );
        })}
      </svg>

      <div className="gridlock-chart-axis" aria-hidden="true">
        <span>{startDate ?? "Baseline"}</span>
        <span>{sampledCount.toLocaleString("en-US")} {ledger.recentRuns.length > 0 ? "recent runs" : "total runs"}</span>
        <span>{endDate ?? "Latest"}</span>
      </div>
    </figure>
  );
}

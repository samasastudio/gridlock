import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { LineageNode, PlateLineageResponse } from "@samasastudio/gridlock-core/schemas";
import { DossierNumber, EDITORIAL_EASE } from "./DossierPrimitives.tsx";
import { computePlateLineageKpis } from "./plate-lineage-model.ts";

const LEAD_TRANSITION = { duration: 0.45, ease: EDITORIAL_EASE } as const;
const META_DOT = <span aria-hidden="true">·</span>;

export function PlateWidgetLoadingPlaceholder() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Plate Lineage"
      data-loading-placeholder="plate-lineage"
      className="gridlock-loading-placeholder"
    >
      <div className="gridlock-loading-stats" aria-hidden="true">
        <div className="gridlock-loading-stat" />
        <div className="gridlock-loading-stat" />
        <div className="gridlock-loading-stat" />
      </div>
      <div className="gridlock-loading-chart" aria-hidden="true" />
      <div className="gridlock-loading-sheet" aria-hidden="true" />
    </div>
  );
}

export function PlateHeadlineKpiStrip(props: { lineage: PlateLineageResponse }) {
  const kpis = computePlateLineageKpis(props.lineage);
  const headSublabel = props.lineage.activeCanonicalPlateId
    ? `head ${props.lineage.activeCanonicalPlateId}`
    : "awaiting Turn 1 bootstrap";
  const items = [
    { label: "Canonical Milestones", value: kpis.canonicalMilestonesCount, sub: headSublabel, delay: 0.08 },
    { label: "Scenario Branches", value: kpis.scenarioBranchesCount, sub: "90-day ephemeral projections", delay: 0.2 },
    { label: "Linked Filings", value: kpis.linkedFilingsCount, sub: "distinct TDLR project IDs", delay: 0.32 },
  ];

  return (
    <section className="gridlock-scorecard-section" aria-label="Plate Lineage Metrics">
      <dl className="gridlock-headline-stats">
        {items.map((item) => (
          <motion.div
            key={item.label}
            className="gridlock-headline-stat"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: item.delay, ease: EDITORIAL_EASE }}
          >
            <dt>{item.label}</dt>
            <dd>
              <strong className="gridlock-kpi-value">
                <DossierNumber value={item.value} />
              </strong>
              <span className="gridlock-kpi-sub">{item.sub}</span>
            </dd>
          </motion.div>
        ))}
      </dl>
    </section>
  );
}

export function PlateSummarySection(props: {
  activeNode: LineageNode;
  orderedNodes: readonly LineageNode[];
  children?: ReactNode;
}) {
  const { activeNode, orderedNodes, children } = props;
  const { plate, triggeringObservations } = activeNode;
  const primaryObs = triggeringObservations[0];
  const extraObservations = triggeringObservations.slice(1);

  const parentNode = plate.isBranch
    ? orderedNodes.find(
        (candidate) =>
          (plate.parentPlateId !== null && candidate.plate.plateId === plate.parentPlateId) ||
          (plate.parentInteractionId !== null && candidate.plate.interactionId === plate.parentInteractionId)
      )
    : undefined;
  const parentLabel = parentNode
    ? `Forked from Turn ${parentNode.plate.turnNumber} (${parentNode.plate.plateId})`
    : plate.parentInteractionId
      ? `Forked from ${plate.parentInteractionId}`
      : "Scenario projection";

  const leadText = plate.isBranch
    ? (plate.scenarioPrompt ?? plate.epistemicLabel)
    : primaryObs
      ? primaryObs.scopeOfWork
      : "Corridor baseline canvas initialized prior to incremental filing delta turns.";

  return (
    <div className="gridlock-plate-specimen">
      <motion.p
        key={`lead-${plate.plateId}`}
        className="gridlock-plate-lead"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={LEAD_TRANSITION}
      >
        {leadText}
      </motion.p>
      {plate.isBranch ? (
        <div className="gridlock-inline-meta">
          <span>Unverified projection</span>
          {META_DOT}
          <span>{parentLabel}</span>
          {plate.expiresAt ? (
            <>
              {META_DOT}
              <span>Expires <time dateTime={plate.expiresAt}>{plate.expiresAt.slice(0, 10)}</time></span>
            </>
          ) : null}
        </div>
      ) : primaryObs ? (
        <>
          <div className="gridlock-inline-meta">
            <code>{primaryObs.projectNumber}</code>
            {META_DOT}
            <span>{primaryObs.status}</span>
            {META_DOT}
            <span>{`$${primaryObs.estimatedCostUsd.toLocaleString("en-US")}`}</span>
            {META_DOT}
            <span>{`${primaryObs.squareFootage.toLocaleString("en-US")} sq ft`}</span>
            {META_DOT}
            <time dateTime={primaryObs.observedAt}>{primaryObs.observedAt.slice(0, 10)}</time>
          </div>
          {extraObservations.length > 0 ? (
            <ul className="gridlock-additional-obs" aria-label="Additional triggering observations">
              {extraObservations.map((obs) => (
                <li key={obs.id}>
                  <code>{obs.projectNumber}</code>
                  <span>{` — ${obs.scopeOfWork} `}</span>
                  <span className="gridlock-additional-obs-meta">
                    {`(${obs.status} · $${obs.estimatedCostUsd.toLocaleString("en-US")} · ${obs.squareFootage.toLocaleString("en-US")} sq ft)`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="gridlock-inline-meta">
          <span>{`Baseline Turn ${plate.turnNumber}`}</span>
          {META_DOT}
          <time dateTime={plate.createdAt}>{plate.createdAt.slice(0, 10)}</time>
          {META_DOT}
          <code>{plate.interactionId}</code>
        </div>
      )}
      {children}
    </div>
  );
}

import { useId, type Ref } from "react";
import { MotionConfig, motion } from "motion/react";
import {
  CANONICAL_MILESTONE_LABEL,
  MILESTONE_COST_THRESHOLD_USD,
  ObservationTimelineNodeSchema,
  type CitedObservation,
  type TdlrProjectNumber,
} from "@samasastudio/gridlock-core/schemas";
import { buildObservationTimelineEntries, summarizeObservationTrajectory, unescapeWorkspaceProse, type TimelineEntryViewModel } from "./workspace-card-model.ts";
import { GRIDLOCK_WORKSPACE_CARD_STYLESHEET } from "./workspace-card-styles.ts";
import { CopyCitationButton, DossierNumber, DossierStatusBadge, EDITORIAL_EASE, EXPORT_ARROW_ICON, RELIEF_RETICLE_ICON, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { DossierErrorShell, DossierTitle } from "./RepairChangelogSections.tsx";

const WORKSPACE_CARD_STYLESHEET_NODE = <style href="gridlock-workspace-cards" precedence="default">{GRIDLOCK_WORKSPACE_CARD_STYLESHEET}</style>;
const META_DOT_NODE = <span aria-hidden="true">·</span>;
const INTEGER_FORMAT = { maximumFractionDigits: 0 } as const;
const MILESTONE_MILLIONS_PREFIX = `$${Math.round(MILESTONE_COST_THRESHOLD_USD / 1_000_000)}M+`;

export interface ObservationTimelineProps {
  projectNumbers: readonly TdlrProjectNumber[];
  observations: readonly CitedObservation[];
  nodeId?: string;
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

function ObservationTimelineItem(props: { entry: TimelineEntryViewModel; nodeId?: string }) {
  const { entry, nodeId } = props;
  const { observation: obs, citation } = entry.citedObservation;
  const citationKey = `${nodeId ?? "card"}:${obs.id}:${citation.sha256}`;

  return (
    <li
      className="gridlock-timeline-item"
      data-milestone={obs.isMilestone ? "true" : "false"}
      data-project-number={obs.projectNumber}
    >
      <span aria-hidden="true" className="gridlock-timeline-marker" />
      <div className="gridlock-timeline-head">
        <time dateTime={obs.observedAt}>{obs.observedAt.slice(0, 10)}</time>
        {META_DOT_NODE}
        <code>{obs.projectNumber}</code>
        {obs.isMilestone ? (
          <span className="gridlock-milestone-tag">{`${MILESTONE_MILLIONS_PREFIX} · ${CANONICAL_MILESTONE_LABEL}`}</span>
        ) : null}
      </div>
      <div className="gridlock-delta-strip" aria-label="Filing-to-filing changes">
        {entry.deltas.map((delta) => (
          <span key={delta} className="gridlock-delta-pill">{delta}</span>
        ))}
      </div>
      <p className="gridlock-workspace-lead">{unescapeWorkspaceProse(obs.scopeOfWork)}</p>
      <div className="gridlock-inline-meta">
        <span>{`$${obs.estimatedCostUsd.toLocaleString("en-US")}`}</span>
        {META_DOT_NODE}
        <span>{`${obs.squareFootage.toLocaleString("en-US")} sq ft`}</span>
        {META_DOT_NODE}
        <span>{`$${entry.costPerSqFtUsd.toLocaleString("en-US")} / sq ft`}</span>
        {META_DOT_NODE}
        <span>{unescapeWorkspaceProse(obs.status)}</span>
      </div>
      <div className="gridlock-citations-row" aria-label="Raw Capture citation">
        <span className="gridlock-citation-item">
          <CopyCitationButton
            key={`copy-${citationKey}`}
            value={citation.sha256}
            displayLabel={`sha256:${citation.sha256.slice(0, 12)}`}
            citationKind="Raw Capture SHA-256"
          />
          <a className="gridlock-citation-link" href={citation.sourceUrl} target="_blank" rel="noreferrer noopener">
            <span>{`${citation.connectorId} filing`}</span>
            {EXPORT_ARROW_ICON}
          </a>
        </span>
      </div>
    </li>
  );
}

function ObservationTimelineContent(props: {
  baseId: string;
  projectNumbers: readonly TdlrProjectNumber[];
  observations: readonly CitedObservation[];
  nodeId?: string;
}) {
  const { baseId, projectNumbers, observations, nodeId } = props;
  const summary = summarizeObservationTrajectory(observations);
  const entries = buildObservationTimelineEntries(observations);
  const kpiItems = [
    {
      label: "Snapshots Recorded",
      value: summary.snapshotsCount,
      sub: `${projectNumbers.length} tracked filing${projectNumbers.length === 1 ? "" : "s"}`,
      delay: 0.08,
    },
    {
      label: `${MILESTONE_MILLIONS_PREFIX} Milestones`,
      value: summary.milestoneCount,
      sub: `>= $${MILESTONE_COST_THRESHOLD_USD.toLocaleString("en-US")} threshold`,
      delay: 0.2,
    },
    {
      label: "Peak Capital",
      value: summary.peakCapitalUsd,
      prefix: "$",
      sub: `latest $${summary.latestCapitalUsd.toLocaleString("en-US")}`,
      delay: 0.32,
    },
  ];

  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle
          baseId={baseId}
          title="Filing Observation Trajectory"
          connectorId={projectNumbers.length === 1 ? projectNumbers[0] : undefined}
        />
        <div className="gridlock-header-controls">
          <DossierStatusBadge
            tone={summary.milestoneCount > 0 ? "alert" : "healthy"}
            label={`${summary.milestoneCount} ${MILESTONE_MILLIONS_PREFIX} milestone${summary.milestoneCount === 1 ? "" : "s"}`}
          />
        </div>
      </header>

      {projectNumbers.length > 1 ? (
        <div className="gridlock-tracked-projects" aria-label="Tracked TDLR project numbers">
          {projectNumbers.map((projectNumber) => (
            <code key={projectNumber} className="gridlock-project-chip">{projectNumber}</code>
          ))}
        </div>
      ) : null}

      {observations.length === 0 ? (
        <p className="gridlock-empty-row" data-empty-timeline="true">
          {RELIEF_RETICLE_ICON}
          <span>{`0 citable observations remain in active window${projectNumbers.length > 0 ? ` for ${projectNumbers.join(", ")}` : ""}.`}</span>
        </p>
      ) : (
        <>
          <dl className="gridlock-headline-stats">
            {kpiItems.map((item) => (
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
                    <DossierNumber value={item.value} prefix={item.prefix} format={INTEGER_FORMAT} />
                  </strong>
                  <span className="gridlock-kpi-sub">{item.sub}</span>
                </dd>
              </motion.div>
            ))}
          </dl>

          <ol className="gridlock-timeline-rail">
            {entries.map((entry) => (
              <ObservationTimelineItem key={entry.citedObservation.observation.id} entry={entry} nodeId={nodeId} />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

export function ObservationTimeline(props: ObservationTimelineProps) {
  const { projectNumbers, observations, nodeId, theme = "inherit", ref } = props;
  const baseId = useId();
  const parsed = ObservationTimelineNodeSchema.safeParse({
    nodeId: nodeId ?? "standalone-observation-timeline",
    component: "ObservationTimeline",
    projectNumbers,
    observations,
  });

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={ref}
        aria-labelledby={`${baseId}-title`}
        className="gridlock-dossier-surface gridlock-workspace-card gridlock-observation-timeline"
        data-gridlock-theme={theme}
        data-workspace-card="ObservationTimeline"
        data-node-id={nodeId}
      >
        {WORKSPACE_CARD_STYLESHEET_NODE}
        {!parsed.success ? (
          <DossierErrorShell
            baseId={baseId}
            title="Filing Observation Trajectory"
            errorPrefix="Malformed ObservationTimeline props:"
            message={parsed.error.issues[0]?.message ?? "Invalid observation timeline payload"}
          />
        ) : (
          <ObservationTimelineContent
            baseId={baseId}
            projectNumbers={parsed.data.projectNumbers}
            observations={parsed.data.observations}
            nodeId={nodeId}
          />
        )}
      </section>
    </MotionConfig>
  );
}

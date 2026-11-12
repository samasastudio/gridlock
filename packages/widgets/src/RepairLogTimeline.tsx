import { useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import type { RepairChangelogEntry, RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { ALERT_TRIANGLE_ICON, CopyCitationButton, DossierNumber, EDITORIAL_EASE, VERIFIED_CHECK_ICON } from "./DossierPrimitives.tsx";

function SelectorDiffTable({ entry, captionId }: { entry: RepairChangelogEntry; captionId: string }) {
  return (
    <div tabIndex={0} role="region" aria-labelledby={captionId} className="gridlock-diff-scroll">
      <table className="gridlock-diff-table">
        <caption id={captionId}>
          ConnectorConfig v{entry.previousVersion} → v{entry.promotedVersion} ({entry.selectorDiffs.length} {entry.selectorDiffs.length === 1 ? "selector" : "selectors"} patched)
        </caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {entry.selectorDiffs.map((diff) => (
            <tr key={diff.field}>
              <th scope="row"><code>{diff.field}</code></th>
              <td className="gridlock-diff-before">
                <span aria-hidden="true">− </span>
                <code>{diff.before || "(empty)"}</code>
              </td>
              <td className="gridlock-diff-after">
                <span aria-hidden="true">+ </span>
                <code>{diff.after || "(empty)"}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RepairLogTimelineSection(props: {
  baseId: string;
  changelog: RepairChangelogResponse;
  activeEntry?: RepairChangelogEntry;
  onSelectEntry: (entryId: string) => void;
}) {
  const { activeEntry, baseId, changelog, onSelectEntry } = props;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const entries = changelog.entries;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (entries.length <= 1) return;
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % entries.length
        : event.key === "ArrowLeft"
          ? (index - 1 + entries.length) % entries.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? entries.length - 1
              : -1;
    if (nextIndex === -1) return;
    event.preventDefault();
    const target = entries[nextIndex];
    if (!target) return;
    onSelectEntry(target.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <section className="gridlock-changelog-section">
      <div className="gridlock-changelog-bar">
        <h3 className="gridlock-section-heading">Repair Changelog</h3>
        {activeEntry ? (
          <div role="tablist" aria-label="Promoted ConnectorConfig versions" className="gridlock-tab-list">
            {entries.map((entry, idx) => {
              const isSelected = entry.id === activeEntry.id;
              return (
                <button
                  key={entry.id}
                  ref={(node) => { tabRefs.current[idx] = node; }}
                  id={`${baseId}-tab-${entry.id}`}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  aria-controls={`${baseId}-panel-${entry.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  className="gridlock-version-tab"
                  onClick={() => onSelectEntry(entry.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, idx)}
                >
                  <span>v{entry.previousVersion} → v{entry.promotedVersion}</span>
                  {isSelected ? (
                    <motion.span
                      aria-hidden="true"
                      layoutId={`${baseId}-active-version-tab`}
                      className="gridlock-tab-indicator"
                      transition={{ type: "spring", visualDuration: 0.55, bounce: 0.05 }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {!activeEntry ? (
        <p className="gridlock-empty-row">
          {changelog.connectorStatus === "healthy" ? (
            <>
              {VERIFIED_CHECK_ICON}
              <span><strong>100% deterministic uptime</strong> — 0 autonomous selector repairs required on ConnectorConfig <code>v{changelog.activeVersion}</code>.</span>
            </>
          ) : (
            <>
              {ALERT_TRIANGLE_ICON}
              <span>0 promoted selector repairs recorded while ConnectorConfig <code>v{changelog.activeVersion}</code> is in <code>{changelog.connectorStatus}</code> state.</span>
            </>
          )}
        </p>
      ) : (
        <article
          id={`${baseId}-panel-${activeEntry.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeEntry.id}`}
          className="gridlock-specimen-panel"
        >
          <motion.p
            key={`cause-${activeEntry.id}`}
            className="gridlock-root-cause"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: EDITORIAL_EASE }}
          >
            {activeEntry.rootCauseSummary}
          </motion.p>

          <div className="gridlock-inline-meta">
            <time dateTime={activeEntry.patchPromotedAt}>{activeEntry.patchPromotedAt.slice(0, 10)}</time>
            <span aria-hidden="true">·</span>
            <DossierNumber value={activeEntry.mttrMs} suffix=" ms heal" />
            <span aria-hidden="true">·</span>
            <DossierNumber value={activeEntry.subsequentDeterministicRunsServed} suffix=" runs amortized" />
            <span aria-hidden="true">·</span>
            <span className="gridlock-verified-inline">
              {VERIFIED_CHECK_ICON}
              <span>
                {activeEntry.totalFixturesVerified} replay verified ({activeEntry.historicalFixturesPassed}/{activeEntry.historicalFixturesTested} historical)
              </span>
            </span>
            <CopyCitationButton
              value={activeEntry.quarantinedArtifactHash}
              displayLabel={`sha256:${activeEntry.quarantinedArtifactHash.slice(0, 12)}`}
              citationKind="Source Artifact SHA-256"
            />
          </div>

          <details key={`patch-${activeEntry.id}`} className="gridlock-patch-disclosure">
            <summary className="gridlock-patch-summary">
              <span>Inspect patch ({activeEntry.selectorDiffs.length} {activeEntry.selectorDiffs.length === 1 ? "selector" : "selectors"})</span>
            </summary>
            <div className="gridlock-patch-body">
              <div className="gridlock-invariant-strip">
                <span><strong>Broken invariant:</strong> <code>{activeEntry.brokenInvariants.join("; ")}</code></span>
                <span className="gridlock-provenance-meta">
                  <span>{activeEntry.repairTokensUsed.toLocaleString("en-US")} tokens (${activeEntry.estimatedRepairCostUsd.toFixed(5)})</span>
                  <CopyCitationButton
                    value={activeEntry.interactionId}
                    displayLabel={activeEntry.interactionId}
                    citationKind="Interaction ID"
                  />
                </span>
              </div>
              <SelectorDiffTable entry={activeEntry} captionId={`${baseId}-diff-${activeEntry.id}`} />
            </div>
          </details>
        </article>
      )}
    </section>
  );
}

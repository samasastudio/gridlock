import { motion, useReducedMotion } from "motion/react";
import type { RepairChangelogEntry, RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { DossierNumber, EDITORIAL_EASE } from "./RepairLogSections.tsx";

function SelectorDiffInspector({ entry, captionId }: { entry: RepairChangelogEntry; captionId: string }) {
  const countLabel = `${entry.selectorDiffs.length} ${entry.selectorDiffs.length === 1 ? "field" : "fields"} patched`;
  return (
    <details open className="gridlock-diff-details">
      <summary>
        <span>
          <span aria-hidden="true" className="gridlock-diff-chevron">▸</span>
          Selector Diff Inspector ({countLabel})
        </span>
        <span className="gridlock-eyebrow">v{entry.previousVersion} → v{entry.promotedVersion}</span>
      </summary>
      <div tabIndex={0} role="region" aria-labelledby={captionId} className="gridlock-diff-scroll">
        <table className="gridlock-diff-table">
          <caption id={captionId}>ConnectorConfig v{entry.previousVersion} to v{entry.promotedVersion} selector diffs</caption>
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
    </details>
  );
}

export function RepairLogTimelineSection({ baseId, changelog }: { baseId: string; changelog: RepairChangelogResponse }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section>
      <div className="gridlock-section-bar">
        <h3 className="gridlock-section-heading">02 / Verified Self-Healing Timeline</h3>
        <span className="gridlock-eyebrow">Sandbox Replay Gate</span>
      </div>
      {changelog.entries.length === 0 ? (
        <div className="gridlock-empty-panel">
          {changelog.connectorStatus === "healthy" ? (
            <p><strong>● 100% deterministic uptime</strong> — 0 autonomous selector repairs required on ConnectorConfig <code>v{changelog.activeVersion}</code>.</p>
          ) : (
            <p>▲ 0 promoted selector repairs recorded while ConnectorConfig <code>v{changelog.activeVersion}</code> is in <code>{changelog.connectorStatus}</code> state.</p>
          )}
        </div>
      ) : (
        <ol role="list" className="gridlock-timeline-list">
          {changelog.entries.map((entry, idx) => (
            <motion.li
              key={entry.id}
              className="gridlock-timeline-item"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: Math.min(idx * 0.08, 0.24), ease: EDITORIAL_EASE }}
            >
              <article className="gridlock-timeline-card">
                <div className="gridlock-specimen-head">
                  <h4 className="gridlock-specimen-title">
                    <span className="gridlock-patch-pill">Patch v{entry.previousVersion} → v{entry.promotedVersion}</span>
                    <span>ConnectorConfig <code>v{entry.previousVersion}</code> → <code>v{entry.promotedVersion}</code></span>
                  </h4>
                  <time className="gridlock-timestamp" dateTime={entry.patchPromotedAt}>{entry.patchPromotedAt}</time>
                </div>

                <p className="gridlock-root-cause">{entry.rootCauseSummary}</p>

                <dl className="gridlock-specimen-metrics">
                  <div className="gridlock-specimen-cell">
                    <dt>Autonomous MTTR</dt>
                    <dd><DossierNumber value={entry.mttrMs} suffix=" ms" /></dd>
                  </div>
                  <div className="gridlock-specimen-cell">
                    <dt>Heal Amortization</dt>
                    <dd><DossierNumber value={entry.subsequentDeterministicRunsServed} /> subsequent deterministic runs served</dd>
                  </div>
                  <div className="gridlock-specimen-cell">
                    <dt>Sandbox Replay Gate</dt>
                    <dd>✓ {entry.historicalFixturesPassed}/{entry.historicalFixturesTested} historical passed ({entry.totalFixturesVerified} total verified)</dd>
                  </div>
                  <div className="gridlock-specimen-cell">
                    <dt>Provenance &amp; Cost</dt>
                    <dd>
                      {entry.repairTokensUsed.toLocaleString("en-US")} tokens (${entry.estimatedRepairCostUsd.toFixed(6)}) · <code>sha256:{entry.quarantinedArtifactHash.slice(0, 12)}</code> · <code>{entry.interactionId}</code>
                    </dd>
                  </div>
                </dl>

                <div className="gridlock-invariant-strip">
                  <strong>! Broken Invariants:</strong> <code>{entry.brokenInvariants.join("; ")}</code>
                </div>

                <SelectorDiffInspector entry={entry} captionId={`${baseId}-diff-${entry.id}`} />
              </article>
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
}

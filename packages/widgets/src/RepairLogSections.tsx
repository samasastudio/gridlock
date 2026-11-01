import type {
  ConnectorStatus,
  EfficiencyLedger,
  RepairChangelogEntry,
  RepairChangelogResponse,
} from "@samasastudio/gridlock-core";

export const RELIEF_RETICLE_ICON = (
  <svg width="18" height="18" viewBox="0 -18 18 18" fill="none" aria-hidden="true">
    <rect x="1" y="-17" width="16" height="16" stroke="var(--relief-sky-mid, #6e7c87)" strokeWidth="1.25" />
    <path d="M3 -5 L7 -11 L11 -8 L15 -14" stroke="var(--relief-coral-mid, #e06d53)" strokeWidth="1.5" />
  </svg>
);

export function ConnectorHealthBanner(props: { connectorStatus: ConnectorStatus; activeVersion: number }) {
  if (props.connectorStatus === "healthy") return null;
  const detail =
    props.connectorStatus === "selector_anomaly"
      ? `Connector degraded (selector_anomaly on ConnectorConfig v${props.activeVersion}): Source Artifact quarantined while the Out-of-Band Repair Agent verifies a candidate selector patch in the Sandbox Replay Gate.`
      : `Connector paused (blocked_by_waf on ConnectorConfig v${props.activeVersion}): polite access gate halted ingestion at 0 Gemini tokens to respect portal WAF / rate-limit boundaries.`;
  return (
    <div role="alert" className="gridlock-banner">
      <p><strong>Degraded Connector State:</strong> {detail}</p>
    </div>
  );
}

export function RepairLogErrorBanner(props: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="gridlock-banner">
      <p><strong>Unable to load Repair Changelog:</strong> {props.message}</p>
      {props.onRetry ? (
        <button type="button" className="gridlock-action-btn" onClick={props.onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

export function EfficiencyScorecardPanel({ ledger }: { ledger: EfficiencyLedger }) {
  return (
    <section>
      <h3>Efficiency Ledger Scorecard</h3>
      <dl className="gridlock-scorecard-grid">
        <div className="gridlock-metric-tile">
          <dt>Naive Tokens Avoided vs. Actual Used</dt>
          <dd><strong>{ledger.naiveTokensAvoided.toLocaleString("en-US")}</strong> avoided · <span>{ledger.actualTokensUsed.toLocaleString("en-US")}</span> used</dd>
        </div>
        <div className="gridlock-metric-tile">
          <dt>Token Reduction</dt>
          <dd><strong>{ledger.tokenReductionPercentage.toFixed(2)}%</strong></dd>
        </div>
        <div className="gridlock-metric-tile">
          <dt>Deterministic Execution Ratio</dt>
          <dd><strong>{ledger.deterministicExecutionPercentage.toFixed(2)}%</strong> ({ledger.deterministicRunsCount.toLocaleString("en-US")}/{ledger.totalRunsCount.toLocaleString("en-US")} runs)</dd>
        </div>
        <div className="gridlock-metric-tile">
          <dt>Estimated Civic Compute Saved</dt>
          <dd><strong>${ledger.estimatedCostSavedUsd.toFixed(4)}</strong> · {ledger.subsequentDeterministicRunsServed.toLocaleString("en-US")} runs amortized</dd>
        </div>
      </dl>
    </section>
  );
}

function SelectorDiffInspector({ entry, captionId }: { entry: RepairChangelogEntry; captionId: string }) {
  return (
    <details open>
      <summary>
        Selector Diff Inspector ({entry.selectorDiffs.length} {entry.selectorDiffs.length === 1 ? "field" : "fields"} patched)
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
                <td><code>{diff.before || "(empty)"}</code></td>
                <td><code>{diff.after || "(empty)"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function RepairLogTimelineSection({ baseId, changelog }: { baseId: string; changelog: RepairChangelogResponse }) {
  return (
    <section>
      <h3>Verified Self-Healing Timeline</h3>
      {changelog.entries.length === 0 ? (
        <div className="gridlock-empty-panel">
          {changelog.connectorStatus === "healthy" ? (
            <p><strong>100% deterministic uptime</strong> — 0 autonomous selector repairs required on ConnectorConfig <code>v{changelog.activeVersion}</code>.</p>
          ) : (
            <p>0 promoted selector repairs recorded while ConnectorConfig <code>v{changelog.activeVersion}</code> is in <code>{changelog.connectorStatus}</code> state.</p>
          )}
        </div>
      ) : (
        <ol role="list" className="gridlock-timeline-list">
          {changelog.entries.map((entry) => (
            <li key={entry.id} className="gridlock-timeline-item">
              <article className="gridlock-timeline-card">
                <h4>
                  ConnectorConfig <code>v{entry.previousVersion}</code> → <code>v{entry.promotedVersion}</code> · <time dateTime={entry.patchPromotedAt}>{entry.patchPromotedAt}</time>
                </h4>
                <p>{entry.rootCauseSummary}</p>
                <p><strong>Autonomous MTTR:</strong> {entry.mttrMs.toLocaleString("en-US")} ms · <strong>Heal Amortization:</strong> {entry.subsequentDeterministicRunsServed.toLocaleString("en-US")} subsequent deterministic runs served</p>
                <p><strong>Sandbox Replay Gate:</strong> {entry.historicalFixturesPassed}/{entry.historicalFixturesTested} historical fixtures passed ({entry.totalFixturesVerified} total verified) · <strong>Repair Cost:</strong> {entry.repairTokensUsed.toLocaleString("en-US")} tokens (${entry.estimatedRepairCostUsd.toFixed(6)})</p>
                <p><strong>Broken Invariants:</strong> {entry.brokenInvariants.join("; ")} · <strong>Source Artifact:</strong> <code>sha256:{entry.quarantinedArtifactHash.slice(0, 12)}</code> · <strong>Interaction:</strong> <code>{entry.interactionId}</code></p>
                <SelectorDiffInspector entry={entry} captionId={`${baseId}-diff-${entry.id}`} />
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

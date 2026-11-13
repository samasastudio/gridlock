import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { ConnectorStatus, EfficiencyLedger } from "@samasastudio/gridlock-core/schemas";
import {
  ALERT_TRIANGLE_ICON,
  DossierNumber,
  EDITORIAL_EASE,
  RELIEF_RETICLE_ICON,
  RULE_DRAW_EASE,
} from "./DossierPrimitives.tsx";

export function DossierTitle({ baseId, connectorId }: { baseId: string; connectorId?: string }) {
  return (
    <div className="gridlock-title-block">
      <h2 id={`${baseId}-title`} className="gridlock-dossier-title">
        {RELIEF_RETICLE_ICON}
        <span>Autonomous Repair Changelog</span>
        {connectorId ? <code className="gridlock-connector-chip">{connectorId}</code> : null}
      </h2>
      <motion.div
        aria-hidden="true"
        className="gridlock-title-rule"
        style={{ originX: 0 }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.95, delay: 0.08, ease: RULE_DRAW_EASE }}
      />
    </div>
  );
}

export function DossierErrorShell(props: { baseId: string; message: string; onRetry?: () => void }) {
  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={props.baseId} />
      </header>
      <RepairLogErrorBanner message={props.message} onRetry={props.onRetry} />
    </>
  );
}

export function RepairLogLoadingPlaceholder() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Repair Changelog"
      data-loading-placeholder="repair-log"
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

export function ConnectorHealthBanner(props: { connectorStatus: ConnectorStatus; activeVersion: number }) {
  if (props.connectorStatus === "healthy") return null;
  const detail =
    props.connectorStatus === "selector_anomaly"
      ? `Connector degraded (selector_anomaly on ConnectorConfig v${props.activeVersion}): Source Artifact quarantined while the Out-of-Band Repair Agent verifies a candidate selector patch in the Sandbox Replay Gate.`
      : `Connector paused (blocked_by_waf on ConnectorConfig v${props.activeVersion}): polite access gate halted ingestion at 0 Gemini tokens to respect portal WAF / rate-limit boundaries.`;
  return (
    <div role="alert" className="gridlock-banner">
      <div className="gridlock-banner-copy">
        <span className="gridlock-banner-icon">{ALERT_TRIANGLE_ICON}</span>
        <p><strong>Degraded Connector State:</strong> {detail}</p>
      </div>
    </div>
  );
}

export function RepairLogErrorBanner(props: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="gridlock-banner">
      <div className="gridlock-banner-copy">
        <span className="gridlock-banner-icon">{ALERT_TRIANGLE_ICON}</span>
        <p><strong>Unable to load Repair Changelog:</strong> {props.message}</p>
      </div>
      {props.onRetry ? (
        <button type="button" className="gridlock-action-btn" onClick={props.onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

export function EfficiencyScorecardPanel(props: { ledger: EfficiencyLedger; children?: ReactNode }) {
  const { children, ledger } = props;
  return (
    <section className="gridlock-scorecard-section" aria-label="Efficiency Ledger">
      <dl className="gridlock-headline-stats">
        <motion.div className="gridlock-headline-stat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.08, ease: EDITORIAL_EASE }}>
          <dt>Token Reduction</dt>
          <dd>
            <strong className="gridlock-kpi-value"><DossierNumber value={ledger.tokenReductionPercentage} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="%" /></strong>
            <span className="gridlock-kpi-sub">{ledger.deterministicRunsCount.toLocaleString("en-US")}/{ledger.totalRunsCount.toLocaleString("en-US")} deterministic runs</span>
          </dd>
        </motion.div>
        <motion.div className="gridlock-headline-stat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.2, ease: EDITORIAL_EASE }}>
          <dt>Tokens Avoided</dt>
          <dd>
            <strong className="gridlock-kpi-value"><DossierNumber value={ledger.naiveTokensAvoided} /></strong>
            <span className="gridlock-kpi-sub">vs. {ledger.actualTokensUsed.toLocaleString("en-US")} actual LLM tokens</span>
          </dd>
        </motion.div>
        <motion.div className="gridlock-headline-stat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.32, ease: EDITORIAL_EASE }}>
          <dt>Civic Compute Saved</dt>
          <dd>
            <strong className="gridlock-kpi-value"><DossierNumber value={ledger.estimatedCostSavedUsd} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} prefix="$" /></strong>
            <span className="gridlock-kpi-sub">{ledger.subsequentDeterministicRunsServed.toLocaleString("en-US")} post-heal runs amortized</span>
          </dd>
        </motion.div>
      </dl>
      {children}
    </section>
  );
}

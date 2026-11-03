import { motion, useReducedMotion } from "motion/react";
import { AnimateNumber, type AnimateNumberProps } from "motion-plus/react";
import type { ConnectorStatus, EfficiencyLedger } from "@samasastudio/gridlock-core/schemas";

export const EDITORIAL_EASE = [0.22, 1, 0.36, 1] as const;

export const RELIEF_RETICLE_ICON = (
  <svg width="20" height="20" viewBox="0 -20 20 20" fill="none" aria-hidden="true">
    <rect x="1" y="-19" width="18" height="18" stroke="var(--relief-sky-mid, #6e7c87)" strokeWidth="1.25" />
    <path d="M3 -5 L7.5 -12.5 L12 -9 L17 -16" stroke="var(--relief-coral-mid, #e06d53)" strokeWidth="1.6" />
  </svg>
);

export const EXPORT_ARROW_ICON = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export function DossierNumber(props: {
  value: number;
  format?: AnimateNumberProps["format"];
  prefix?: string;
  suffix?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <AnimateNumber
      locales="en-US"
      format={props.format}
      prefix={props.prefix}
      suffix={props.suffix}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.55, ease: EDITORIAL_EASE }}
    >
      {props.value}
    </AnimateNumber>
  );
}

export function ConnectorStatusBadge(props: { connectorStatus: ConnectorStatus; activeVersion: number }) {
  const glyph = props.connectorStatus === "healthy" ? "●" : props.connectorStatus === "selector_anomaly" ? "▲" : "■";
  const tone = props.connectorStatus === "healthy" ? "healthy" : "alert";
  return (
    <span className="gridlock-status-badge" data-tone={tone}>
      <span aria-hidden="true">{glyph}</span>
      <span>v{props.activeVersion} · {props.connectorStatus}</span>
    </span>
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
      <p><strong>▲ Degraded Connector State:</strong> {detail}</p>
    </div>
  );
}

export function RepairLogErrorBanner(props: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="gridlock-banner">
      <p><strong>▲ Unable to load Repair Changelog:</strong> {props.message}</p>
      {props.onRetry ? (
        <button type="button" className="gridlock-action-btn" onClick={props.onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

export function EfficiencyScorecardPanel({ ledger }: { ledger: EfficiencyLedger }) {
  const prefersReducedMotion = useReducedMotion();
  const reductionRatio = Math.max(0, Math.min(1, ledger.tokenReductionPercentage / 100));
  const tickCount = 16;
  const litTicks = Math.round((Math.max(0, Math.min(100, ledger.deterministicExecutionPercentage)) / 100) * tickCount);

  return (
    <section className="gridlock-scorecard-section">
      <div className="gridlock-section-bar">
        <h3 className="gridlock-section-heading">01 / Efficiency Ledger Scorecard</h3>
        <span className="gridlock-eyebrow">Counterfactual Telemetry</span>
      </div>
      <dl className="gridlock-scorecard-grid">
        <div className="gridlock-metric-tile">
          <dt>Naive Tokens Avoided vs. Actual Used</dt>
          <dd>
            <strong className="gridlock-kpi-value"><DossierNumber value={ledger.naiveTokensAvoided} /></strong>
            <span className="gridlock-kpi-sub">avoided · {ledger.actualTokensUsed.toLocaleString("en-US")} actual tokens used</span>
          </dd>
        </div>

        <div className="gridlock-metric-tile">
          <dt>Token Reduction</dt>
          <dd>
            <strong className="gridlock-kpi-value">
              <DossierNumber value={ledger.tokenReductionPercentage} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="%" />
            </strong>
            <svg data-telemetry-meter="token-reduction" className="gridlock-meter-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width="100" height="6" fill="var(--gridlock-border)" />
              <motion.rect
                x="0"
                y="0"
                width="100"
                height="6"
                fill="var(--gridlock-accent)"
                style={{ originX: 0 }}
                initial={prefersReducedMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: reductionRatio }}
                transition={{ duration: 0.75, ease: EDITORIAL_EASE }}
              />
            </svg>
          </dd>
        </div>

        <div className="gridlock-metric-tile">
          <dt>Deterministic Execution Ratio</dt>
          <dd>
            <strong className="gridlock-kpi-value">
              <DossierNumber value={ledger.deterministicExecutionPercentage} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="%" />
            </strong>
            <span className="gridlock-kpi-sub">{ledger.deterministicRunsCount.toLocaleString("en-US")}/{ledger.totalRunsCount.toLocaleString("en-US")} runs</span>
            <svg data-telemetry-meter="deterministic-runs" className="gridlock-meter-svg" viewBox="0 0 160 6" preserveAspectRatio="none" aria-hidden="true">
              {Array.from({ length: tickCount }, (_, idx) => (
                <rect
                  key={idx}
                  x={idx * 10}
                  y="0"
                  width="8"
                  height="6"
                  fill={idx < litTicks ? "var(--gridlock-ink)" : "var(--gridlock-border)"}
                />
              ))}
            </svg>
          </dd>
        </div>

        <div className="gridlock-metric-tile" data-accent="kiln">
          <dt>Estimated Civic Compute Saved</dt>
          <dd>
            <strong className="gridlock-kpi-value">
              <DossierNumber value={ledger.estimatedCostSavedUsd} format={{ minimumFractionDigits: 4, maximumFractionDigits: 4 }} prefix="$" />
            </strong>
            <span className="gridlock-kpi-sub">{ledger.subsequentDeterministicRunsServed.toLocaleString("en-US")} runs amortized</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

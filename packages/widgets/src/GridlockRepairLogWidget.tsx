import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EfficiencyLedgerSchema, RepairChangelogResponseSchema, type EfficiencyLedger, type RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { buildRepairChangelogUrl, fetchRepairLogSnapshot, type RepairLogQuery, type RepairLogSnapshotResult } from "./repair-log-client.ts";
import { GRIDLOCK_REPAIR_LOG_STYLESHEET } from "./repair-log-styles.ts";
import {
  ConnectorHealthBanner,
  ConnectorStatusBadge,
  EDITORIAL_EASE,
  EfficiencyScorecardPanel,
  EXPORT_ARROW_ICON,
  RELIEF_RETICLE_ICON,
  RepairLogErrorBanner,
} from "./RepairLogSections.tsx";
import { RepairLogTimelineSection } from "./RepairLogTimeline.tsx";

export type GridlockWidgetTheme = "inherit" | "diurnal" | "nocturnal";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-repair-log-widget" precedence="default">{GRIDLOCK_REPAIR_LOG_STYLESHEET}</style>;
const LOADING_PROGRESS_NODE = <progress className="gridlock-progress" aria-label="Loading Repair Changelog" />;
const SAFE_SNAPSHOT_PROMISES = new WeakMap<Promise<RepairLogSnapshotResult>, Promise<RepairLogSnapshotResult>>();

interface RepairLogWidgetBaseProps {
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

export type GridlockRepairLogWidgetProps =
  | (RepairLogWidgetBaseProps & Partial<RepairLogQuery> & {
      changelog: RepairChangelogResponse;
      efficiencyLedger: EfficiencyLedger;
      snapshotPromise?: undefined;
      onRetry?: undefined;
    })
  | (RepairLogWidgetBaseProps & RepairLogQuery & {
      changelog?: undefined;
      efficiencyLedger?: undefined;
      snapshotPromise?: Promise<RepairLogSnapshotResult>;
      onRetry?: () => void;
    });

function matchesQuery(a: RepairLogQuery, b: RepairLogQuery): boolean {
  return a.apiBaseUrl === b.apiBaseUrl && a.connectorId === b.connectorId && a.limit === b.limit;
}

function toSafeSnapshotPromise(promise: Promise<RepairLogSnapshotResult>): Promise<RepairLogSnapshotResult> {
  const cached = SAFE_SNAPSHOT_PROMISES.get(promise);
  if (cached) return cached;
  const safe = promise.catch(
    (error: unknown): RepairLogSnapshotResult => ({
      ok: false,
      message: error instanceof Error ? error.message : "Network error loading Repair Changelog",
    })
  );
  SAFE_SNAPSHOT_PROMISES.set(promise, safe);
  return safe;
}

function DossierTitle({ baseId, connectorId }: { baseId: string; connectorId?: string }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="gridlock-title-block">
      <span className="gridlock-eyebrow">Seam 02 · Autonomous Repair Archive</span>
      <h2 id={`${baseId}-title`} className="gridlock-dossier-title">
        {RELIEF_RETICLE_ICON}
        <span>Autonomous Repair Changelog</span>
        {connectorId ? <code className="gridlock-connector-chip">{connectorId}</code> : null}
      </h2>
      <motion.div
        aria-hidden="true"
        className="gridlock-title-rule"
        initial={prefersReducedMotion ? false : { scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.65, ease: EDITORIAL_EASE }}
      />
    </div>
  );
}

function DossierErrorShell(props: { baseId: string; message: string; onRetry?: () => void }) {
  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={props.baseId} />
      </header>
      <RepairLogErrorBanner message={props.message} onRetry={props.onRetry} />
    </>
  );
}

function LoadedDossierContent(props: Partial<RepairLogQuery> & { baseId: string; changelog: RepairChangelogResponse; efficiencyLedger: EfficiencyLedger }) {
  const { apiBaseUrl, baseId, changelog, connectorId, efficiencyLedger, limit } = props;
  const markdownHref = apiBaseUrl !== undefined ? buildRepairChangelogUrl({ apiBaseUrl, connectorId: connectorId ?? changelog.connectorId, limit, format: "md" }) : undefined;
  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} connectorId={changelog.connectorId} />
        <div className="gridlock-header-controls">
          <ConnectorStatusBadge connectorStatus={changelog.connectorStatus} activeVersion={changelog.activeVersion} />
          {markdownHref ? (
            <a className="gridlock-md-link" href={markdownHref}>
              <span>Export Field Notes (.md)</span>
              {EXPORT_ARROW_ICON}
            </a>
          ) : null}
        </div>
      </header>
      <ConnectorHealthBanner connectorStatus={changelog.connectorStatus} activeVersion={changelog.activeVersion} />
      <EfficiencyScorecardPanel ledger={efficiencyLedger} />
      <RepairLogTimelineSection baseId={baseId} changelog={changelog} />
    </>
  );
}

function PromiseDossierBoundary(props: Partial<RepairLogQuery> & { snapshotPromise: Promise<RepairLogSnapshotResult>; baseId: string; onRetry: () => void }) {
  const result = use(props.snapshotPromise);
  if (!result.ok) return <DossierErrorShell baseId={props.baseId} message={result.message} onRetry={props.onRetry} />;
  return <LoadedDossierContent baseId={props.baseId} changelog={result.changelog} efficiencyLedger={result.efficiencyLedger} apiBaseUrl={props.apiBaseUrl} connectorId={props.connectorId} limit={props.limit} />;
}

export function GridlockRepairLogWidget(props: GridlockRepairLogWidgetProps) {
  const { changelog, efficiencyLedger, apiBaseUrl, connectorId, limit, snapshotPromise, onRetry, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: RepairLogQuery; promise: Promise<RepairLogSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: RepairLogQuery; sourcePromise?: Promise<RepairLogSnapshotResult>; promise: Promise<RepairLogSnapshotResult> } | null>(null);

  const isStaticMode = changelog !== undefined;

  useEffect(() => {
    const effectController = !isStaticMode && apiBaseUrl !== undefined && !snapshotPromise ? new AbortController() : null;
    if (effectController && apiBaseUrl !== undefined) {
      const query: RepairLogQuery = { apiBaseUrl, connectorId, limit };
      setEffectEntry({ query, promise: fetchRepairLogSnapshot({ ...query, signal: effectController.signal }) });
    }
    return () => {
      effectController?.abort();
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      setRetryEntry(null);
    };
  }, [apiBaseUrl, connectorId, isStaticMode, limit, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (apiBaseUrl === undefined) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    const query: RepairLogQuery = { apiBaseUrl, connectorId, limit };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchRepairLogSnapshot({ ...query, signal: controller.signal }) });
  };

  const currentQuery = apiBaseUrl !== undefined ? { apiBaseUrl, connectorId, limit } : null;
  const activeRetryPromise = currentQuery && retryEntry && retryEntry.sourcePromise === snapshotPromise && matchesQuery(retryEntry.query, currentQuery) ? retryEntry.promise : null;
  const activeEffectPromise = currentQuery && !snapshotPromise && effectEntry && matchesQuery(effectEntry.query, currentQuery) ? effectEntry.promise : null;
  const rawActivePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const activePromise = rawActivePromise ? toSafeSnapshotPromise(rawActivePromise) : null;
  const loadingShell = (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} />
      </header>
      {LOADING_PROGRESS_NODE}
    </>
  );
  const parsedStatic = changelog !== undefined
    ? { changelog: RepairChangelogResponseSchema.safeParse(changelog), ledger: EfficiencyLedgerSchema.safeParse(efficiencyLedger) }
    : null;

  return (
    <section ref={ref} aria-labelledby={`${baseId}-title`} className="gridlock-repair-widget" data-gridlock-theme={theme}>
      {WIDGET_STYLESHEET_NODE}
      {parsedStatic ? (
        !parsedStatic.changelog.success || !parsedStatic.ledger.success ? (
          <DossierErrorShell baseId={baseId} message="Malformed Repair Changelog or Efficiency Ledger props" />
        ) : (
          <LoadedDossierContent baseId={baseId} changelog={parsedStatic.changelog.data} efficiencyLedger={parsedStatic.ledger.data} apiBaseUrl={apiBaseUrl} connectorId={connectorId} limit={limit} />
        )
      ) : activePromise ? (
        <Suspense fallback={loadingShell}>
          <PromiseDossierBoundary snapshotPromise={activePromise} baseId={baseId} apiBaseUrl={apiBaseUrl} connectorId={connectorId} limit={limit} onRetry={handleRetry} />
        </Suspense>
      ) : (
        loadingShell
      )}
    </section>
  );
}

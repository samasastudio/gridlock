import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { EfficiencyLedgerSchema, RepairChangelogResponseSchema, type EfficiencyLedger, type RepairChangelogResponse } from "@samasastudio/gridlock-core";
import { buildRepairChangelogUrl, fetchRepairLogSnapshot, type RepairLogQuery, type RepairLogSnapshotResult } from "./repair-log-client.ts";
import { GRIDLOCK_REPAIR_LOG_STYLESHEET } from "./repair-log-styles.ts";
import { ConnectorHealthBanner, EfficiencyScorecardPanel, RELIEF_RETICLE_ICON, RepairLogErrorBanner, RepairLogTimelineSection } from "./RepairLogSections.tsx";

export type GridlockWidgetTheme = "inherit" | "diurnal" | "nocturnal";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-repair-log-widget" precedence="default">{GRIDLOCK_REPAIR_LOG_STYLESHEET}</style>;
const LOADING_PROGRESS_NODE = <progress aria-label="Loading Repair Changelog" />;

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

function DossierTitle({ baseId, connectorId }: { baseId: string; connectorId?: string }) {
  return (
    <h2 id={`${baseId}-title`}>
      {RELIEF_RETICLE_ICON} Autonomous Repair Changelog{connectorId ? <> — <code>{connectorId}</code></> : null}
    </h2>
  );
}

function DossierErrorShell(props: { baseId: string; message: string; onRetry?: () => void }) {
  return (
    <>
      <DossierTitle baseId={props.baseId} />
      <RepairLogErrorBanner message={props.message} onRetry={props.onRetry} />
    </>
  );
}

function LoadedDossierContent(props: { baseId: string; changelog: RepairChangelogResponse; efficiencyLedger: EfficiencyLedger; markdownHref?: string }) {
  const { baseId, changelog, efficiencyLedger, markdownHref } = props;
  return (
    <>
      <header className="gridlock-repair-header">
        <div>
          <DossierTitle baseId={baseId} connectorId={changelog.connectorId} />
          <p>Active Config <code>v{changelog.activeVersion}</code> · Status <code>{changelog.connectorStatus}</code></p>
        </div>
        {markdownHref ? <a className="gridlock-md-link" href={markdownHref}>Export Field Notes (.md)</a> : null}
      </header>
      <ConnectorHealthBanner connectorStatus={changelog.connectorStatus} activeVersion={changelog.activeVersion} />
      <EfficiencyScorecardPanel ledger={efficiencyLedger} />
      <RepairLogTimelineSection baseId={baseId} changelog={changelog} />
    </>
  );
}

function PromiseDossierBoundary(props: { snapshotPromise: Promise<RepairLogSnapshotResult>; baseId: string; markdownHref?: string; onRetry: () => void }) {
  const result = use(props.snapshotPromise);
  if (!result.ok) return <DossierErrorShell baseId={props.baseId} message={result.message} onRetry={props.onRetry} />;
  return <LoadedDossierContent baseId={props.baseId} changelog={result.changelog} efficiencyLedger={result.efficiencyLedger} markdownHref={props.markdownHref} />;
}

export function GridlockRepairLogWidget(props: GridlockRepairLogWidgetProps) {
  const { changelog, efficiencyLedger, apiBaseUrl, connectorId, limit, snapshotPromise, onRetry, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: RepairLogQuery; promise: Promise<RepairLogSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: RepairLogQuery; sourcePromise?: Promise<RepairLogSnapshotResult>; promise: Promise<RepairLogSnapshotResult> } | null>(null);

  useEffect(() => () => retryAbortRef.current?.abort(), []);

  useEffect(() => {
    if (changelog || !apiBaseUrl || snapshotPromise) return;
    const controller = new AbortController();
    const query: RepairLogQuery = { apiBaseUrl, connectorId, limit };
    setEffectEntry({ query, promise: fetchRepairLogSnapshot({ ...query, signal: controller.signal }) });
    return () => controller.abort();
  }, [apiBaseUrl, changelog, connectorId, limit, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (!apiBaseUrl) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    const query: RepairLogQuery = { apiBaseUrl, connectorId, limit };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchRepairLogSnapshot({ ...query, signal: controller.signal }) });
  };

  const markdownHref = apiBaseUrl ? buildRepairChangelogUrl({ apiBaseUrl, connectorId, limit, format: "md" }) : undefined;
  const currentQuery = apiBaseUrl ? { apiBaseUrl, connectorId, limit } : null;
  const activeRetryPromise = currentQuery && retryEntry && retryEntry.sourcePromise === snapshotPromise && matchesQuery(retryEntry.query, currentQuery) ? retryEntry.promise : null;
  const activeEffectPromise = currentQuery && !snapshotPromise && effectEntry && matchesQuery(effectEntry.query, currentQuery) ? effectEntry.promise : null;
  const activePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const loadingShell = <><DossierTitle baseId={baseId} />{LOADING_PROGRESS_NODE}</>;
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
          <LoadedDossierContent baseId={baseId} changelog={parsedStatic.changelog.data} efficiencyLedger={parsedStatic.ledger.data} markdownHref={markdownHref} />
        )
      ) : activePromise ? (
        <Suspense fallback={loadingShell}>
          <PromiseDossierBoundary snapshotPromise={activePromise} baseId={baseId} markdownHref={markdownHref} onRetry={handleRetry} />
        </Suspense>
      ) : (
        loadingShell
      )}
    </section>
  );
}

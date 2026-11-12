import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { MotionConfig } from "motion/react";
import { EfficiencyLedgerSchema, RepairChangelogResponseSchema, type EfficiencyLedger, type RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { buildRepairChangelogUrl, fetchRepairLogSnapshot, type RepairLogQuery, type RepairLogSnapshotResult } from "./repair-log-client.ts";
import { ConnectorStatusBadge, EXPORT_ARROW_ICON, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { EfficiencyLineChart } from "./EfficiencyLineChart.tsx";
import { GRIDLOCK_REPAIR_LOG_STYLESHEET } from "./repair-log-styles.ts";
import {
  ConnectorHealthBanner,
  DossierErrorShell,
  DossierTitle,
  EfficiencyScorecardPanel,
  RepairLogLoadingPlaceholder,
} from "./RepairLogSections.tsx";
import { RepairLogTimelineSection } from "./RepairLogTimeline.tsx";

export type { GridlockWidgetTheme } from "./DossierPrimitives.tsx";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-repair-log-widget" precedence="default">{GRIDLOCK_REPAIR_LOG_STYLESHEET}</style>;
const LOADING_PLACEHOLDER_NODE = <RepairLogLoadingPlaceholder />;
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
  return a.apiBaseUrl === b.apiBaseUrl && a.connectorId === b.connectorId && a.limit === b.limit && a.runsLimit === b.runsLimit;
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

function LoadedDossierContent(props: {
  baseId: string;
  changelog: RepairChangelogResponse;
  efficiencyLedger: EfficiencyLedger;
  query?: Partial<RepairLogQuery>;
}) {
  const { baseId, changelog, efficiencyLedger, query } = props;
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const activeEntry = changelog.entries.find((entry) => entry.id === selectedEntryId) ?? changelog.entries[changelog.entries.length - 1];
  const selectableInteractions = new Map(
    changelog.entries.map((entry) => [entry.interactionId, `v${entry.previousVersion} → v${entry.promotedVersion}`])
  );
  const markdownHref =
    query?.apiBaseUrl !== undefined
      ? buildRepairChangelogUrl({
          apiBaseUrl: query.apiBaseUrl,
          connectorId: query.connectorId ?? changelog.connectorId,
          limit: query.limit,
          format: "md",
        })
      : undefined;

  const handleSelectInteraction = (interactionId: string) => {
    const matching = changelog.entries.find((entry) => entry.interactionId === interactionId);
    if (matching) setSelectedEntryId(matching.id);
  };

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
      <EfficiencyScorecardPanel ledger={efficiencyLedger}>
        <EfficiencyLineChart
          baseId={baseId}
          ledger={efficiencyLedger}
          connectorId={changelog.connectorId}
          selectableInteractions={selectableInteractions}
          activeInteractionId={activeEntry?.interactionId}
          onSelectInteraction={handleSelectInteraction}
        />
      </EfficiencyScorecardPanel>
      <RepairLogTimelineSection
        baseId={baseId}
        changelog={changelog}
        activeEntry={activeEntry}
        onSelectEntry={setSelectedEntryId}
      />
    </>
  );
}

function PromiseDossierBoundary(props: {
  snapshotPromise: Promise<RepairLogSnapshotResult>;
  baseId: string;
  query?: Partial<RepairLogQuery>;
  onRetry: () => void;
}) {
  const result = use(props.snapshotPromise);
  if (!result.ok) return <DossierErrorShell baseId={props.baseId} message={result.message} onRetry={props.onRetry} />;
  return <LoadedDossierContent baseId={props.baseId} changelog={result.changelog} efficiencyLedger={result.efficiencyLedger} query={props.query} />;
}

export function GridlockRepairLogWidget(props: GridlockRepairLogWidgetProps) {
  const { changelog, efficiencyLedger, apiBaseUrl, connectorId, limit, runsLimit, snapshotPromise, onRetry, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: RepairLogQuery; promise: Promise<RepairLogSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: RepairLogQuery; sourcePromise?: Promise<RepairLogSnapshotResult>; promise: Promise<RepairLogSnapshotResult> } | null>(null);
  const isStaticMode = changelog !== undefined;

  useEffect(() => {
    const effectController = !isStaticMode && apiBaseUrl !== undefined && !snapshotPromise ? new AbortController() : null;
    if (effectController && apiBaseUrl !== undefined) {
      const query: RepairLogQuery = { apiBaseUrl, connectorId, limit, runsLimit };
      setEffectEntry({ query, promise: fetchRepairLogSnapshot({ ...query, signal: effectController.signal }) });
    }
    return () => {
      effectController?.abort();
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      setRetryEntry(null);
    };
  }, [apiBaseUrl, connectorId, isStaticMode, limit, runsLimit, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (apiBaseUrl === undefined) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    const query: RepairLogQuery = { apiBaseUrl, connectorId, limit, runsLimit };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchRepairLogSnapshot({ ...query, signal: controller.signal }) });
  };

  const currentQuery = apiBaseUrl !== undefined ? { apiBaseUrl, connectorId, limit, runsLimit } : null;
  const activeRetryPromise = currentQuery && retryEntry && retryEntry.sourcePromise === snapshotPromise && matchesQuery(retryEntry.query, currentQuery) ? retryEntry.promise : null;
  const activeEffectPromise = currentQuery && !snapshotPromise && effectEntry && matchesQuery(effectEntry.query, currentQuery) ? effectEntry.promise : null;
  const rawActivePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const activePromise = rawActivePromise ? toSafeSnapshotPromise(rawActivePromise) : null;
  const loadingShell = (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} connectorId={connectorId} />
      </header>
      {LOADING_PLACEHOLDER_NODE}
    </>
  );
  const parsedStatic = changelog !== undefined
    ? { changelog: RepairChangelogResponseSchema.safeParse(changelog), ledger: EfficiencyLedgerSchema.safeParse(efficiencyLedger) }
    : null;

  return (
    <MotionConfig reducedMotion="user">
      <section ref={ref} aria-labelledby={`${baseId}-title`} className="gridlock-dossier-surface gridlock-repair-widget" data-gridlock-theme={theme}>
        {WIDGET_STYLESHEET_NODE}
        {parsedStatic ? (
          !parsedStatic.changelog.success || !parsedStatic.ledger.success ? (
            <DossierErrorShell baseId={baseId} message="Malformed Repair Changelog or Efficiency Ledger props" />
          ) : (
            <LoadedDossierContent baseId={baseId} changelog={parsedStatic.changelog.data} efficiencyLedger={parsedStatic.ledger.data} query={{ apiBaseUrl, connectorId, limit, runsLimit }} />
          )
        ) : activePromise ? (
          <Suspense fallback={loadingShell}>
            <PromiseDossierBoundary snapshotPromise={activePromise} baseId={baseId} query={{ apiBaseUrl, connectorId, limit, runsLimit }} onRetry={handleRetry} />
          </Suspense>
        ) : (
          loadingShell
        )}
      </section>
    </MotionConfig>
  );
}

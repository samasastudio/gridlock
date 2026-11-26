import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { MotionConfig } from "motion/react";
import { EfficiencyScorecardSchema, RepairChangelogResponseSchema, type EfficiencyScorecard, type RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { buildRepairChangelogUrl, fetchRepairChangelogSnapshot, type RepairChangelogQuery, type RepairChangelogSnapshotResult } from "./repair-changelog-client.ts";
import { ConnectorStatusBadge, EXPORT_ARROW_ICON, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { EfficiencyLineChart } from "./EfficiencyLineChart.tsx";
import { GRIDLOCK_REPAIR_CHANGELOG_STYLESHEET } from "./repair-changelog-styles.ts";
import {
  ConnectorHealthBanner,
  DossierErrorShell,
  DossierTitle,
  EfficiencyScorecardPanel,
  RepairChangelogLoadingPlaceholder,
} from "./RepairChangelogSections.tsx";
import { RepairChangelogTimelineSection } from "./RepairChangelogTimeline.tsx";

export type { GridlockWidgetTheme } from "./DossierPrimitives.tsx";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-repair-changelog-widget" precedence="default">{GRIDLOCK_REPAIR_CHANGELOG_STYLESHEET}</style>;
const LOADING_PLACEHOLDER_NODE = <RepairChangelogLoadingPlaceholder />;
const SAFE_SNAPSHOT_PROMISES = new WeakMap<Promise<RepairChangelogSnapshotResult>, Promise<RepairChangelogSnapshotResult>>();

interface RepairChangelogWidgetBaseProps {
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

export type GridlockRepairChangelogWidgetProps =
  | (RepairChangelogWidgetBaseProps & Partial<RepairChangelogQuery> & {
      changelog: RepairChangelogResponse;
      efficiencyScorecard: EfficiencyScorecard;
      snapshotPromise?: undefined;
      onRetry?: undefined;
    })
  | (RepairChangelogWidgetBaseProps & RepairChangelogQuery & {
      changelog?: undefined;
      efficiencyScorecard?: undefined;
      snapshotPromise?: Promise<RepairChangelogSnapshotResult>;
      onRetry?: () => void;
    });

function matchesQuery(a: RepairChangelogQuery, b: RepairChangelogQuery): boolean {
  return a.apiBaseUrl === b.apiBaseUrl && a.connectorId === b.connectorId && a.limit === b.limit && a.runsLimit === b.runsLimit;
}

function toSafeSnapshotPromise(promise: Promise<RepairChangelogSnapshotResult>): Promise<RepairChangelogSnapshotResult> {
  const cached = SAFE_SNAPSHOT_PROMISES.get(promise);
  if (cached) return cached;
  const safe = promise.catch(
    (error: unknown): RepairChangelogSnapshotResult => ({
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
  efficiencyScorecard: EfficiencyScorecard;
  query?: Partial<RepairChangelogQuery>;
}) {
  const { baseId, changelog, efficiencyScorecard, query } = props;
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
      <EfficiencyScorecardPanel scorecard={efficiencyScorecard}>
        <EfficiencyLineChart
          baseId={baseId}
          scorecard={efficiencyScorecard}
          connectorId={changelog.connectorId}
          selectableInteractions={selectableInteractions}
          activeInteractionId={activeEntry?.interactionId}
          onSelectInteraction={handleSelectInteraction}
        />
      </EfficiencyScorecardPanel>
      <RepairChangelogTimelineSection
        baseId={baseId}
        changelog={changelog}
        activeEntry={activeEntry}
        onSelectEntry={setSelectedEntryId}
      />
    </>
  );
}

function PromiseDossierBoundary(props: {
  snapshotPromise: Promise<RepairChangelogSnapshotResult>;
  baseId: string;
  query?: Partial<RepairChangelogQuery>;
  onRetry: () => void;
}) {
  const result = use(props.snapshotPromise);
  if (!result.ok) return <DossierErrorShell baseId={props.baseId} message={result.message} onRetry={props.onRetry} />;
  return <LoadedDossierContent baseId={props.baseId} changelog={result.changelog} efficiencyScorecard={result.efficiencyScorecard} query={props.query} />;
}

export function GridlockRepairChangelogWidget(props: GridlockRepairChangelogWidgetProps) {
  const { changelog, efficiencyScorecard, apiBaseUrl, connectorId, limit, runsLimit, snapshotPromise, onRetry, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: RepairChangelogQuery; promise: Promise<RepairChangelogSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: RepairChangelogQuery; sourcePromise?: Promise<RepairChangelogSnapshotResult>; promise: Promise<RepairChangelogSnapshotResult> } | null>(null);
  const isStaticMode = changelog !== undefined;

  useEffect(() => {
    const effectController = !isStaticMode && apiBaseUrl !== undefined && !snapshotPromise ? new AbortController() : null;
    if (effectController && apiBaseUrl !== undefined) {
      const query: RepairChangelogQuery = { apiBaseUrl, connectorId, limit, runsLimit };
      setEffectEntry({ query, promise: fetchRepairChangelogSnapshot({ ...query, signal: effectController.signal }) });
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
    const query: RepairChangelogQuery = { apiBaseUrl, connectorId, limit, runsLimit };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchRepairChangelogSnapshot({ ...query, signal: controller.signal }) });
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
    ? { changelog: RepairChangelogResponseSchema.safeParse(changelog), scorecard: EfficiencyScorecardSchema.safeParse(efficiencyScorecard) }
    : null;

  return (
    <MotionConfig reducedMotion="user">
      <section ref={ref} aria-labelledby={`${baseId}-title`} className="gridlock-dossier-surface gridlock-repair-widget" data-gridlock-theme={theme}>
        {WIDGET_STYLESHEET_NODE}
        {parsedStatic ? (
          !parsedStatic.changelog.success || !parsedStatic.scorecard.success ? (
            <DossierErrorShell baseId={baseId} message="Malformed Repair Changelog or Efficiency Scorecard props" />
          ) : (
            <LoadedDossierContent baseId={baseId} changelog={parsedStatic.changelog.data} efficiencyScorecard={parsedStatic.scorecard.data} query={{ apiBaseUrl, connectorId, limit, runsLimit }} />
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

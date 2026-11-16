import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { MotionConfig } from "motion/react";
import { PlateLineageResponseSchema, type PlateLineageResponse } from "@samasastudio/gridlock-core/schemas";
import { DossierStatusBadge, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { fetchPlateLineageSnapshot, type PlateLineageQuery, type PlateLineageSnapshotResult } from "./plate-lineage-client.ts";
import { orderLineageNodes, resolveActiveLineageNode } from "./plate-lineage-model.ts";
import { GRIDLOCK_PLATE_WIDGET_STYLESHEET } from "./plate-widget-styles.ts";
import { PlateFrameStage } from "./PlateFrameStage.tsx";
import { PlateProvenanceSection } from "./PlateProvenanceSection.tsx";
import { PlateHeadlineKpiStrip, PlateSummarySection, PlateWidgetLoadingPlaceholder } from "./PlateSummarySection.tsx";
import { DossierErrorShell, DossierTitle } from "./RepairLogSections.tsx";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-plate-widget" precedence="default">{GRIDLOCK_PLATE_WIDGET_STYLESHEET}</style>;
const LOADING_PLACEHOLDER_NODE = <PlateWidgetLoadingPlaceholder />;
const SAFE_SNAPSHOT_PROMISES = new WeakMap<Promise<PlateLineageSnapshotResult>, Promise<PlateLineageSnapshotResult>>();
const LINEAGE_TITLE = "Corridor Plate Lineage";
const LINEAGE_ERROR_PREFIX = "Unable to load Plate Lineage:";

interface PlateViewOptions {
  apiBaseUrl?: string;
  lineageId?: string;
  selectedPlateId?: string;
  initialPlateId?: string;
  onSelectPlate?: (plateId: string) => void;
  assetUrlOverrides?: Readonly<Record<string, string>>;
}

interface PlateWidgetBaseProps extends Omit<PlateViewOptions, "apiBaseUrl" | "lineageId"> {
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

export type GridlockPlateWidgetProps =
  | (PlateWidgetBaseProps & Partial<PlateLineageQuery> & {
      lineage: PlateLineageResponse;
      snapshotPromise?: undefined;
      onRetry?: undefined;
    })
  | (PlateWidgetBaseProps & PlateLineageQuery & {
      lineage?: undefined;
      snapshotPromise?: Promise<PlateLineageSnapshotResult>;
      onRetry?: () => void;
    });

function matchesLineageQuery(a: PlateLineageQuery, b: PlateLineageQuery): boolean {
  return a.apiBaseUrl === b.apiBaseUrl && a.lineageId === b.lineageId;
}

function toSafeSnapshotPromise(promise: Promise<PlateLineageSnapshotResult>): Promise<PlateLineageSnapshotResult> {
  const cached = SAFE_SNAPSHOT_PROMISES.get(promise);
  if (cached) return cached;
  const safe = promise.catch(
    (error: unknown): PlateLineageSnapshotResult => ({
      ok: false,
      message: error instanceof Error ? error.message : "Network error loading Plate Lineage",
    })
  );
  SAFE_SNAPSHOT_PROMISES.set(promise, safe);
  return safe;
}

function LoadedPlateDossierContent(props: {
  baseId: string;
  lineage: PlateLineageResponse;
  viewOptions: PlateViewOptions;
}) {
  const { baseId, lineage, viewOptions } = props;
  const [internalPlateId, setInternalPlateId] = useState<string | null>(viewOptions.initialPlateId ?? null);
  const orderedNodes = orderLineageNodes(lineage.nodes);
  const activeNode = resolveActiveLineageNode({
    orderedNodes,
    activeCanonicalPlateId: lineage.activeCanonicalPlateId,
    selectedPlateId: viewOptions.selectedPlateId ?? internalPlateId,
    initialPlateId: viewOptions.initialPlateId,
  });

  const handleSelectPlate = (plateId: string) => {
    if (viewOptions.selectedPlateId === undefined) setInternalPlateId(plateId);
    viewOptions.onSelectPlate?.(plateId);
  };

  const frameCountLabel = `${orderedNodes.length} ${orderedNodes.length === 1 ? "Visual Plate" : "Visual Plates"}`;

  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title={LINEAGE_TITLE} connectorId={lineage.lineageId} />
        <div className="gridlock-header-controls">
          <DossierStatusBadge tone="healthy" label={frameCountLabel} />
        </div>
      </header>
      <PlateHeadlineKpiStrip lineage={lineage} />
      <PlateFrameStage
        baseId={baseId}
        nodes={orderedNodes}
        activePlateId={activeNode?.plate.plateId ?? null}
        onSelectPlate={handleSelectPlate}
        apiBaseUrl={viewOptions.apiBaseUrl}
        assetUrlOverrides={viewOptions.assetUrlOverrides}
      >
        {activeNode ? (
          <PlateSummarySection activeNode={activeNode} orderedNodes={orderedNodes}>
            <PlateProvenanceSection lineage={lineage} activeNode={activeNode} onSelectPlate={handleSelectPlate} />
          </PlateSummarySection>
        ) : null}
      </PlateFrameStage>
    </>
  );
}

function PromisePlateBoundary(props: {
  snapshotPromise: Promise<PlateLineageSnapshotResult>;
  baseId: string;
  viewOptions: PlateViewOptions;
  onRetry: () => void;
}) {
  const result = use(props.snapshotPromise);
  if (!result.ok) {
    return <DossierErrorShell baseId={props.baseId} title={LINEAGE_TITLE} connectorId={props.viewOptions.lineageId} errorPrefix={LINEAGE_ERROR_PREFIX} message={result.message} onRetry={props.onRetry} />;
  }
  return <LoadedPlateDossierContent key={`${result.lineage.lineageId}::${props.viewOptions.initialPlateId ?? ""}`} baseId={props.baseId} lineage={result.lineage} viewOptions={props.viewOptions} />;
}

export function GridlockPlateWidget(props: GridlockPlateWidgetProps) {
  const { lineage, apiBaseUrl, lineageId, snapshotPromise, onRetry, selectedPlateId, initialPlateId, onSelectPlate, assetUrlOverrides, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: PlateLineageQuery; promise: Promise<PlateLineageSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: PlateLineageQuery; sourcePromise?: Promise<PlateLineageSnapshotResult>; promise: Promise<PlateLineageSnapshotResult> } | null>(null);
  const isStaticMode = lineage !== undefined;

  useEffect(() => {
    const effectController = !isStaticMode && apiBaseUrl !== undefined && !snapshotPromise ? new AbortController() : null;
    if (effectController && apiBaseUrl !== undefined) {
      const query: PlateLineageQuery = { apiBaseUrl, lineageId };
      setEffectEntry({ query, promise: fetchPlateLineageSnapshot({ ...query, signal: effectController.signal }) });
    }
    return () => {
      effectController?.abort();
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      setRetryEntry(null);
    };
  }, [apiBaseUrl, isStaticMode, lineageId, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (apiBaseUrl === undefined) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    const query: PlateLineageQuery = { apiBaseUrl, lineageId };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchPlateLineageSnapshot({ ...query, signal: controller.signal }) });
  };

  const viewOptions: PlateViewOptions = { apiBaseUrl, lineageId, selectedPlateId, initialPlateId, onSelectPlate, assetUrlOverrides };
  const currentQuery = apiBaseUrl !== undefined ? { apiBaseUrl, lineageId } : null;
  const activeRetryPromise = currentQuery && retryEntry && retryEntry.sourcePromise === snapshotPromise && matchesLineageQuery(retryEntry.query, currentQuery) ? retryEntry.promise : null;
  const activeEffectPromise = currentQuery && !snapshotPromise && effectEntry && matchesLineageQuery(effectEntry.query, currentQuery) ? effectEntry.promise : null;
  const rawActivePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const activePromise = rawActivePromise ? toSafeSnapshotPromise(rawActivePromise) : null;
  const loadingShell = (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title={LINEAGE_TITLE} connectorId={lineageId} />
      </header>
      {LOADING_PLACEHOLDER_NODE}
    </>
  );
  const parsedStatic = lineage !== undefined ? PlateLineageResponseSchema.safeParse(lineage) : null;

  return (
    <MotionConfig reducedMotion="user">
      <section ref={ref} aria-labelledby={`${baseId}-title`} className="gridlock-dossier-surface gridlock-plate-widget" data-gridlock-theme={theme}>
        {WIDGET_STYLESHEET_NODE}
        {parsedStatic ? (
          !parsedStatic.success ? (
            <DossierErrorShell baseId={baseId} title={LINEAGE_TITLE} connectorId={lineageId} errorPrefix={LINEAGE_ERROR_PREFIX} message="Malformed Plate Lineage props" />
          ) : (
            <LoadedPlateDossierContent key={`${parsedStatic.data.lineageId}::${viewOptions.initialPlateId ?? ""}`} baseId={baseId} lineage={parsedStatic.data} viewOptions={viewOptions} />
          )
        ) : activePromise ? (
          <Suspense fallback={loadingShell}>
            <PromisePlateBoundary snapshotPromise={activePromise} baseId={baseId} viewOptions={viewOptions} onRetry={handleRetry} />
          </Suspense>
        ) : (
          loadingShell
        )}
      </section>
    </MotionConfig>
  );
}

import { Fragment, Suspense, use, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { MotionConfig } from "motion/react";
import type { GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { DOSSIER_BASE_STYLESHEET_NODE } from "./dossier-styles.ts";
import { DossierErrorShell, DossierTitle } from "./RepairChangelogSections.tsx";

export type DossierSnapshotOutcome =
  | { ok: true }
  | { ok: false; message: string; statusCode?: number; errorCode?: string };

const SAFE_SNAPSHOT_PROMISES = new WeakMap<Promise<unknown>, Promise<unknown>>();

function toSafeSnapshotPromise<TResult extends DossierSnapshotOutcome>(
  promise: Promise<TResult>,
  fallbackMessage: string
): Promise<TResult> {
  const cached = SAFE_SNAPSHOT_PROMISES.get(promise) as Promise<TResult> | undefined;
  if (cached) return cached;
  const safe = promise.catch(
    (error: unknown): TResult =>
      ({
        ok: false,
        message: error instanceof Error ? error.message : fallbackMessage,
      }) as TResult
  );
  SAFE_SNAPSHOT_PROMISES.set(promise, safe);
  return safe;
}

export interface DossierShellHeader {
  title?: string;
  subjectId?: string;
  errorPrefix?: string;
}

function PromiseSnapshotBoundary<TData, TResult extends DossierSnapshotOutcome>(props: {
  snapshotPromise: Promise<TResult>;
  baseId: string;
  header: DossierShellHeader;
  onRetry: () => void;
  extractData: (result: Extract<TResult, { ok: true }>) => TData;
  getContentKey: (data: TData) => string;
  renderLoaded: (baseId: string, data: TData) => ReactNode;
}) {
  const result = use(props.snapshotPromise);
  if (!result.ok) {
    return (
      <DossierErrorShell
        baseId={props.baseId}
        title={props.header.title}
        connectorId={props.header.subjectId}
        errorPrefix={props.header.errorPrefix}
        message={result.message}
        onRetry={props.onRetry}
      />
    );
  }
  const data = props.extractData(result as Extract<TResult, { ok: true }>);
  return <Fragment key={props.getContentKey(data)}>{props.renderLoaded(props.baseId, data)}</Fragment>;
}

export interface DossierSnapshotShellProps<TData, TResult extends DossierSnapshotOutcome> {
  widgetClassName: string;
  stylesheetNode: ReactNode;
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
  header: DossierShellHeader;
  networkErrorFallback: string;
  loadingPlaceholder: ReactNode;
  staticResult: { ok: true; data: TData } | { ok: false; message: string } | null;
  queryKey: string | null;
  snapshotPromise?: Promise<TResult>;
  onRetry?: () => void;
  fetchSnapshot: (signal: AbortSignal) => Promise<TResult>;
  extractData: (result: Extract<TResult, { ok: true }>) => TData;
  getContentKey: (data: TData) => string;
  renderLoaded: (baseId: string, data: TData) => ReactNode;
}

export function DossierSnapshotShell<TData, TResult extends DossierSnapshotOutcome>(
  props: DossierSnapshotShellProps<TData, TResult>
) {
  const {
    widgetClassName, stylesheetNode, theme = "inherit", ref, header,
    networkErrorFallback, loadingPlaceholder, staticResult, queryKey, snapshotPromise,
    onRetry, fetchSnapshot, extractData, getContentKey, renderLoaded,
  } = props;

  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const fetchSnapshotRef = useRef(fetchSnapshot);
  fetchSnapshotRef.current = fetchSnapshot;
  const [effectEntry, setEffectEntry] = useState<{ queryKey: string; promise: Promise<TResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ queryKey: string; sourcePromise?: Promise<TResult>; promise: Promise<TResult> } | null>(null);
  const isStaticMode = staticResult !== null;

  useEffect(() => {
    const effectController = !isStaticMode && queryKey !== null && !snapshotPromise ? new AbortController() : null;
    if (effectController && queryKey !== null) {
      setEffectEntry({ queryKey, promise: fetchSnapshotRef.current(effectController.signal) });
    }
    return () => {
      effectController?.abort();
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      setEffectEntry(null);
      setRetryEntry(null);
    };
  }, [isStaticMode, queryKey, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (queryKey === null) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    setRetryEntry({ queryKey, sourcePromise: snapshotPromise, promise: fetchSnapshotRef.current(controller.signal) });
  };

  const activeRetryPromise =
    queryKey !== null && retryEntry && retryEntry.sourcePromise === snapshotPromise && retryEntry.queryKey === queryKey
      ? retryEntry.promise : null;
  const activeEffectPromise =
    queryKey !== null && !snapshotPromise && effectEntry && effectEntry.queryKey === queryKey
      ? effectEntry.promise : null;
  const rawActivePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const activePromise = rawActivePromise ? toSafeSnapshotPromise(rawActivePromise, networkErrorFallback) : null;

  const loadingShell = (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title={header.title} connectorId={header.subjectId} />
      </header>
      {loadingPlaceholder}
    </>
  );

  return (
    <MotionConfig reducedMotion="user">
      <section ref={ref} aria-labelledby={`${baseId}-title`} className={`gridlock-dossier-surface ${widgetClassName}`} data-gridlock-theme={theme}>
        {DOSSIER_BASE_STYLESHEET_NODE}
        {stylesheetNode}
        {staticResult ? (
          !staticResult.ok ? (
            <DossierErrorShell baseId={baseId} title={header.title} connectorId={header.subjectId} errorPrefix={header.errorPrefix} message={staticResult.message} />
          ) : (
            <Fragment key={getContentKey(staticResult.data)}>{renderLoaded(baseId, staticResult.data)}</Fragment>
          )
        ) : activePromise ? (
          <Suspense fallback={loadingShell}>
            <PromiseSnapshotBoundary
              snapshotPromise={activePromise}
              baseId={baseId}
              header={header}
              onRetry={handleRetry}
              extractData={extractData}
              getContentKey={getContentKey}
              renderLoaded={renderLoaded}
            />
          </Suspense>
        ) : (
          loadingShell
        )}
      </section>
    </MotionConfig>
  );
}

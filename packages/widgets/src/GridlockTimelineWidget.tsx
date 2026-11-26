import { Suspense, use, useEffect, useId, useRef, useState, type Ref } from "react";
import { MotionConfig } from "motion/react";
import { FrameTimelineResponseSchema, type FrameTimelineResponse } from "@samasastudio/gridlock-core/schemas";
import { DossierStatusBadge, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { fetchFrameTimelineSnapshot, type FrameTimelineQuery, type FrameTimelineSnapshotResult } from "./frame-timeline-client.ts";
import { GRIDLOCK_PLATE_WIDGET_STYLESHEET } from "./plate-widget-styles.ts";
import { TimelineFrameStage } from "./TimelineFrameStage.tsx";
import { TimelineProvenanceSection } from "./TimelineProvenanceSection.tsx";
import { TimelineScenarioBranchSection } from "./TimelineScenarioBranchSection.tsx";
import { TimelineHeadlineKpiStrip, TimelineSummarySection, TimelineWidgetLoadingPlaceholder } from "./TimelineSummarySection.tsx";
import { DossierErrorShell, DossierTitle } from "./RepairChangelogSections.tsx";
import { useTimelineBranching } from "./useTimelineBranching.ts";

const WIDGET_STYLESHEET_NODE = <style href="gridlock-plate-widget" precedence="default">{GRIDLOCK_PLATE_WIDGET_STYLESHEET}</style>;
const LOADING_PLACEHOLDER_NODE = <TimelineWidgetLoadingPlaceholder />;
const SAFE_SNAPSHOT_PROMISES = new WeakMap<Promise<FrameTimelineSnapshotResult>, Promise<FrameTimelineSnapshotResult>>();
const TIMELINE_TITLE = "Corridor Frame Timeline";
const TIMELINE_ERROR_PREFIX = "Unable to load Frame Timeline:";

interface TimelineViewOptions {
  apiBaseUrl?: string;
  timelineId?: string;
  selectedIllustrationId?: string;
  initialIllustrationId?: string;
  onSelectIllustration?: (illustrationId: string) => void;
  assetUrlOverrides?: Readonly<Record<string, string>>;
}

interface TimelineWidgetBaseProps extends Omit<TimelineViewOptions, "apiBaseUrl" | "timelineId"> {
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

export type GridlockTimelineWidgetProps =
  | (TimelineWidgetBaseProps & Partial<FrameTimelineQuery> & {
      timeline: FrameTimelineResponse;
      snapshotPromise?: undefined;
      onRetry?: undefined;
    })
  | (TimelineWidgetBaseProps & FrameTimelineQuery & {
      timeline?: undefined;
      snapshotPromise?: Promise<FrameTimelineSnapshotResult>;
      onRetry?: () => void;
    });

function matchesTimelineQuery(a: FrameTimelineQuery, b: FrameTimelineQuery): boolean {
  return a.apiBaseUrl === b.apiBaseUrl && a.timelineId === b.timelineId;
}

function toSafeSnapshotPromise(promise: Promise<FrameTimelineSnapshotResult>): Promise<FrameTimelineSnapshotResult> {
  const cached = SAFE_SNAPSHOT_PROMISES.get(promise);
  if (cached) return cached;
  const safe = promise.catch(
    (error: unknown): FrameTimelineSnapshotResult => ({
      ok: false,
      message: error instanceof Error ? error.message : "Network error loading Frame Timeline",
    })
  );
  SAFE_SNAPSHOT_PROMISES.set(promise, safe);
  return safe;
}

function LoadedTimelineDossierContent(props: {
  baseId: string;
  timeline: FrameTimelineResponse;
  viewOptions: TimelineViewOptions;
}) {
  const { baseId, timeline, viewOptions } = props;
  const branching = useTimelineBranching({
    baseTimeline: timeline,
    apiBaseUrl: viewOptions.apiBaseUrl,
    selectedIllustrationId: viewOptions.selectedIllustrationId,
    initialIllustrationId: viewOptions.initialIllustrationId,
    onSelectIllustration: viewOptions.onSelectIllustration,
  });
  const { effectiveTimeline, orderedNodes, activeNode } = branching;
  const frameCountLabel = `${orderedNodes.length} ${orderedNodes.length === 1 ? "Generated Illustration" : "Generated Illustrations"}`;

  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title={TIMELINE_TITLE} connectorId={effectiveTimeline.timelineId} />
        <div className="gridlock-header-controls">
          <DossierStatusBadge tone="healthy" label={frameCountLabel} />
        </div>
      </header>
      <TimelineHeadlineKpiStrip timeline={effectiveTimeline} />
      <TimelineFrameStage
        baseId={baseId}
        nodes={orderedNodes}
        edges={effectiveTimeline.edges}
        activeCanonicalIllustrationId={effectiveTimeline.activeCanonicalIllustrationId}
        activeIllustrationId={activeNode?.plate.illustrationId ?? null}
        isComparing={branching.isComparing}
        onCompareChange={branching.setIsComparing}
        onSelectIllustration={branching.selectIllustration}
        apiBaseUrl={viewOptions.apiBaseUrl}
        assetUrlOverrides={viewOptions.assetUrlOverrides}
      >
        {activeNode ? (
          <TimelineSummarySection activeNode={activeNode} orderedNodes={orderedNodes}>
            {viewOptions.apiBaseUrl !== undefined ? (
              <TimelineScenarioBranchSection
                baseId={baseId}
                activeNode={branching.branchTargetNode ?? activeNode}
                scenarioPrompt={branching.scenarioPrompt}
                isSubmitting={branching.isSubmitting}
                error={branching.branchError}
                onPromptChange={branching.updateScenarioPrompt}
                onSubmitBranch={(parentInteractionId) => {
                  void branching.submitScenarioBranch(parentInteractionId);
                }}
              />
            ) : null}
            <TimelineProvenanceSection
              timeline={effectiveTimeline}
              activeNode={activeNode}
              onSelectIllustration={branching.selectIllustration}
            />
          </TimelineSummarySection>
        ) : null}
      </TimelineFrameStage>
    </>
  );
}

function PromiseTimelineBoundary(props: {
  snapshotPromise: Promise<FrameTimelineSnapshotResult>;
  baseId: string;
  viewOptions: TimelineViewOptions;
  onRetry: () => void;
}) {
  const result = use(props.snapshotPromise);
  if (!result.ok) {
    return <DossierErrorShell baseId={props.baseId} title={TIMELINE_TITLE} connectorId={props.viewOptions.timelineId} errorPrefix={TIMELINE_ERROR_PREFIX} message={result.message} onRetry={props.onRetry} />;
  }
  return <LoadedTimelineDossierContent key={`${result.timeline.timelineId}::${props.viewOptions.initialIllustrationId ?? ""}::${props.viewOptions.apiBaseUrl ?? "::static"}`} baseId={props.baseId} timeline={result.timeline} viewOptions={props.viewOptions} />;
}

export function GridlockTimelineWidget(props: GridlockTimelineWidgetProps) {
  const { timeline, apiBaseUrl, timelineId, snapshotPromise, onRetry, selectedIllustrationId, initialIllustrationId, onSelectIllustration, assetUrlOverrides, theme = "inherit", ref } = props;
  const baseId = useId();
  const retryAbortRef = useRef<AbortController | null>(null);
  const [effectEntry, setEffectEntry] = useState<{ query: FrameTimelineQuery; promise: Promise<FrameTimelineSnapshotResult> } | null>(null);
  const [retryEntry, setRetryEntry] = useState<{ query: FrameTimelineQuery; sourcePromise?: Promise<FrameTimelineSnapshotResult>; promise: Promise<FrameTimelineSnapshotResult> } | null>(null);
  const isStaticMode = timeline !== undefined;

  useEffect(() => {
    const effectController = !isStaticMode && apiBaseUrl !== undefined && !snapshotPromise ? new AbortController() : null;
    if (effectController && apiBaseUrl !== undefined) {
      const query: FrameTimelineQuery = { apiBaseUrl, timelineId };
      setEffectEntry({ query, promise: fetchFrameTimelineSnapshot({ ...query, signal: effectController.signal }) });
    }
    return () => {
      effectController?.abort();
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      setRetryEntry(null);
    };
  }, [apiBaseUrl, isStaticMode, timelineId, snapshotPromise]);

  const handleRetry = () => {
    onRetry?.();
    if (apiBaseUrl === undefined) return;
    retryAbortRef.current?.abort();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    const query: FrameTimelineQuery = { apiBaseUrl, timelineId };
    setRetryEntry({ query, sourcePromise: snapshotPromise, promise: fetchFrameTimelineSnapshot({ ...query, signal: controller.signal }) });
  };

  const viewOptions: TimelineViewOptions = { apiBaseUrl, timelineId, selectedIllustrationId, initialIllustrationId, onSelectIllustration, assetUrlOverrides };
  const currentQuery = apiBaseUrl !== undefined ? { apiBaseUrl, timelineId } : null;
  const activeRetryPromise = currentQuery && retryEntry && retryEntry.sourcePromise === snapshotPromise && matchesTimelineQuery(retryEntry.query, currentQuery) ? retryEntry.promise : null;
  const activeEffectPromise = currentQuery && !snapshotPromise && effectEntry && matchesTimelineQuery(effectEntry.query, currentQuery) ? effectEntry.promise : null;
  const rawActivePromise = activeRetryPromise ?? snapshotPromise ?? activeEffectPromise;
  const activePromise = rawActivePromise ? toSafeSnapshotPromise(rawActivePromise) : null;
  const loadingShell = (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title={TIMELINE_TITLE} connectorId={timelineId} />
      </header>
      {LOADING_PLACEHOLDER_NODE}
    </>
  );
  const parsedStatic = timeline !== undefined ? FrameTimelineResponseSchema.safeParse(timeline) : null;

  return (
    <MotionConfig reducedMotion="user">
      <section ref={ref} aria-labelledby={`${baseId}-title`} className="gridlock-dossier-surface gridlock-plate-widget" data-gridlock-theme={theme}>
        {WIDGET_STYLESHEET_NODE}
        {parsedStatic ? (
          !parsedStatic.success ? (
            <DossierErrorShell baseId={baseId} title={TIMELINE_TITLE} connectorId={timelineId} errorPrefix={TIMELINE_ERROR_PREFIX} message="Malformed Frame Timeline props" />
          ) : (
            <LoadedTimelineDossierContent key={`${parsedStatic.data.timelineId}::${viewOptions.initialIllustrationId ?? ""}::${viewOptions.apiBaseUrl !== undefined ? "live" : "static"}`} baseId={baseId} timeline={parsedStatic.data} viewOptions={viewOptions} />
          )
        ) : activePromise ? (
          <Suspense fallback={loadingShell}>
            <PromiseTimelineBoundary snapshotPromise={activePromise} baseId={baseId} viewOptions={viewOptions} onRetry={handleRetry} />
          </Suspense>
        ) : (
          loadingShell
        )}
      </section>
    </MotionConfig>
  );
}

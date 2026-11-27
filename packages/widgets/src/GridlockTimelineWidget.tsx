import type { Ref } from "react";
import { FrameTimelineResponseSchema, type FrameTimelineResponse } from "@samasastudio/gridlock-core/schemas";
import { DossierStatusBadge, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { DossierSnapshotShell } from "./DossierSnapshotShell.tsx";
import { fetchFrameTimelineSnapshot, type FrameTimelineQuery, type FrameTimelineSnapshotResult } from "./frame-timeline-client.ts";
import { GRIDLOCK_TIMELINE_WIDGET_STYLESHEET } from "./timeline-widget-styles.ts";
import { TimelineFrameStage } from "./TimelineFrameStage.tsx";
import { TimelineProvenanceSection } from "./TimelineProvenanceSection.tsx";
import { TimelineScenarioBranchSection } from "./TimelineScenarioBranchSection.tsx";
import { TimelineHeadlineKpiStrip, TimelineSummarySection, TimelineWidgetLoadingPlaceholder } from "./TimelineSummarySection.tsx";
import { DossierTitle } from "./RepairChangelogSections.tsx";
import { useTimelineBranching } from "./useTimelineBranching.ts";

const WIDGET_STYLESHEET_NODE = (
  <style href="gridlock-timeline-widget" precedence="default">{GRIDLOCK_TIMELINE_WIDGET_STYLESHEET}</style>
);
const LOADING_PLACEHOLDER_NODE = <TimelineWidgetLoadingPlaceholder />;
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

export function GridlockTimelineWidget(props: GridlockTimelineWidgetProps) {
  const { timeline, apiBaseUrl, timelineId, snapshotPromise, onRetry, selectedIllustrationId, initialIllustrationId, onSelectIllustration, assetUrlOverrides, theme = "inherit", ref } = props;
  const viewOptions: TimelineViewOptions = { apiBaseUrl, timelineId, selectedIllustrationId, initialIllustrationId, onSelectIllustration, assetUrlOverrides };
  const parsedStatic = timeline !== undefined ? FrameTimelineResponseSchema.safeParse(timeline) : null;
  const staticResult = parsedStatic
    ? parsedStatic.success
      ? ({ ok: true, data: parsedStatic.data } as const)
      : ({ ok: false, message: "Malformed Frame Timeline props" } as const)
    : null;
  const queryKey = apiBaseUrl !== undefined ? JSON.stringify([apiBaseUrl, timelineId ?? null]) : null;
  const contentScope = timeline !== undefined ? (apiBaseUrl !== undefined ? "live" : "static") : (apiBaseUrl ?? "::static");

  return (
    <DossierSnapshotShell
      widgetClassName="gridlock-timeline-widget"
      stylesheetNode={WIDGET_STYLESHEET_NODE}
      theme={theme}
      ref={ref}
      header={{ title: TIMELINE_TITLE, subjectId: timelineId, errorPrefix: TIMELINE_ERROR_PREFIX }}
      networkErrorFallback="Network error loading Frame Timeline"
      loadingPlaceholder={LOADING_PLACEHOLDER_NODE}
      staticResult={staticResult}
      queryKey={queryKey}
      snapshotPromise={snapshotPromise}
      onRetry={onRetry}
      fetchSnapshot={(signal) => fetchFrameTimelineSnapshot({ apiBaseUrl: apiBaseUrl ?? "", timelineId, signal })}
      extractData={(result) => result.timeline}
      getContentKey={(data) => `${data.timelineId}::${initialIllustrationId ?? ""}::${contentScope}`}
      renderLoaded={(baseId, data) => (
        <LoadedTimelineDossierContent baseId={baseId} timeline={data} viewOptions={viewOptions} />
      )}
    />
  );
}

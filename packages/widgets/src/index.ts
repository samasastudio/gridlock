import { ProjectSchema, type Project } from "@samasastudio/gridlock-core/schemas";

export const GRIDLOCK_WIDGET_MANIFEST = {
  packageName: "@samasastudio/gridlock-widgets",
  widgets: [
    "GridlockTimelineWidget",
    "GridlockConsoleWidget",
    "GridlockRepairChangelogWidget",
  ] as const,
};

export function formatProjectCitationBadge(projectInput: Project): string {
  const project = ProjectSchema.parse(projectInput);
  return `${project.projectNumber} · ${project.county} County · sha256:${project.latestRawCaptureHash.slice(0, 12)}`;
}

export {
  ConnectorStatusBadge,
  CopyCitationButton,
  DossierNumber,
  DossierStatusBadge,
  EDITORIAL_EASE,
  useIsReducedMotion,
  type GridlockWidgetTheme,
} from "./DossierPrimitives.tsx";
export {
  GridlockRepairChangelogWidget,
  type GridlockRepairChangelogWidgetProps,
} from "./GridlockRepairChangelogWidget.tsx";
export {
  buildRepairChangelogUrl,
  fetchRepairChangelogSnapshot,
  type RepairChangelogQuery,
  type RepairChangelogSnapshotResult,
} from "./repair-changelog-client.ts";
export {
  buildFrameTimelineUrl,
  buildIllustrationAssetUrl,
  buildScenarioBranchUrl,
  fetchFrameTimelineSnapshot,
  submitScenarioBranch,
  type FrameTimelineQuery,
  type FrameTimelineSnapshotResult,
  type SubmitScenarioBranchOptions,
  type SubmitScenarioBranchResult,
} from "./frame-timeline-client.ts";
export { TimelineFrameStage, type TimelineFrameStageProps } from "./TimelineFrameStage.tsx";
export { GridlockTimelineWidget, type GridlockTimelineWidgetProps } from "./GridlockTimelineWidget.tsx";
export { ProjectDossierCard, type ProjectDossierCardProps } from "./ProjectDossierCard.tsx";
export { ObservationTimeline, type ObservationTimelineProps } from "./ObservationTimeline.tsx";
export { MetricComparisonTable, type MetricComparisonTableProps } from "./MetricComparisonTable.tsx";

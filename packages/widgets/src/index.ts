import { ProjectSchema, type Project } from "@samasastudio/gridlock-core";

export const GRIDLOCK_WIDGET_MANIFEST = {
  packageName: "@samasastudio/gridlock-widgets",
  widgets: [
    "GridlockPlateWidget",
    "GridlockConsoleWidget",
    "GridlockRepairLogWidget",
  ] as const,
};

export function formatProjectCitationBadge(projectInput: Project): string {
  const project = ProjectSchema.parse(projectInput);
  return `${project.projectNumber} · ${project.county} County · sha256:${project.latestSourceArtifactHash.slice(0, 12)}`;
}

export { GridlockRepairLogWidget, type GridlockRepairLogWidgetProps, type GridlockWidgetTheme } from "./GridlockRepairLogWidget.tsx";
export { buildRepairChangelogUrl, fetchRepairLogSnapshot, type RepairLogQuery, type RepairLogSnapshotResult } from "./repair-log-client.ts";

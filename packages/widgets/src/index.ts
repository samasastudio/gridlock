import { ProjectSchema, type Project } from "@samasastudio/gridlock-core/schemas";

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
  GridlockRepairLogWidget,
  type GridlockRepairLogWidgetProps,
} from "./GridlockRepairLogWidget.tsx";
export { buildRepairChangelogUrl, fetchRepairLogSnapshot, type RepairLogQuery, type RepairLogSnapshotResult } from "./repair-log-client.ts";

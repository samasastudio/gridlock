import { useState, type Ref } from "react";
import { EfficiencyScorecardSchema, RepairChangelogResponseSchema, type EfficiencyScorecard, type RepairChangelogResponse } from "@samasastudio/gridlock-core/schemas";
import { buildRepairChangelogUrl, fetchRepairChangelogSnapshot, type RepairChangelogQuery, type RepairChangelogSnapshotResult } from "./repair-changelog-client.ts";
import { ConnectorStatusBadge, EXPORT_ARROW_ICON, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { DossierSnapshotShell } from "./DossierSnapshotShell.tsx";
import { EfficiencyLineChart } from "./EfficiencyLineChart.tsx";
import { GRIDLOCK_REPAIR_CHANGELOG_STYLESHEET } from "./repair-changelog-styles.ts";
import {
  ConnectorHealthBanner,
  DossierTitle,
  EfficiencyScorecardPanel,
  RepairChangelogLoadingPlaceholder,
} from "./RepairChangelogSections.tsx";
import { RepairChangelogTimelineSection } from "./RepairChangelogTimeline.tsx";

export type { GridlockWidgetTheme } from "./DossierPrimitives.tsx";

const WIDGET_STYLESHEET_NODE = (
  <style href="gridlock-repair-changelog-widget" precedence="default">{GRIDLOCK_REPAIR_CHANGELOG_STYLESHEET}</style>
);
const LOADING_PLACEHOLDER_NODE = <RepairChangelogLoadingPlaceholder />;

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

interface RepairChangelogSnapshotData {
  changelog: RepairChangelogResponse;
  efficiencyScorecard: EfficiencyScorecard;
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

export function GridlockRepairChangelogWidget(props: GridlockRepairChangelogWidgetProps) {
  const { changelog, efficiencyScorecard, apiBaseUrl, connectorId, limit, runsLimit, snapshotPromise, onRetry, theme = "inherit", ref } = props;
  const parsedStatic = changelog !== undefined
    ? { changelog: RepairChangelogResponseSchema.safeParse(changelog), scorecard: EfficiencyScorecardSchema.safeParse(efficiencyScorecard) }
    : null;
  const staticResult = parsedStatic
    ? parsedStatic.changelog.success && parsedStatic.scorecard.success
      ? ({
          ok: true,
          data: {
            changelog: parsedStatic.changelog.data,
            efficiencyScorecard: parsedStatic.scorecard.data,
          },
        } as const)
      : ({ ok: false, message: "Malformed Repair Changelog or Efficiency Scorecard props" } as const)
    : null;
  const queryKey =
    apiBaseUrl !== undefined
      ? JSON.stringify([apiBaseUrl, connectorId ?? null, limit ?? null, runsLimit ?? null])
      : null;

  return (
    <DossierSnapshotShell<RepairChangelogSnapshotData, RepairChangelogSnapshotResult>
      widgetClassName="gridlock-repair-widget"
      stylesheetNode={WIDGET_STYLESHEET_NODE}
      theme={theme}
      ref={ref}
      header={{ subjectId: connectorId }}
      networkErrorFallback="Network error loading Repair Changelog"
      loadingPlaceholder={LOADING_PLACEHOLDER_NODE}
      staticResult={staticResult}
      queryKey={queryKey}
      snapshotPromise={snapshotPromise}
      onRetry={onRetry}
      fetchSnapshot={(signal) =>
        fetchRepairChangelogSnapshot({ apiBaseUrl: apiBaseUrl ?? "", connectorId, limit, runsLimit, signal })
      }
      extractData={(result) => ({
        changelog: result.changelog,
        efficiencyScorecard: result.efficiencyScorecard,
      })}
      getContentKey={(data) =>
        `${data.changelog.connectorId}::${apiBaseUrl ?? "::static"}::${connectorId ?? ""}::${limit ?? ""}::${runsLimit ?? ""}`
      }
      renderLoaded={(baseId, data) => (
        <LoadedDossierContent
          baseId={baseId}
          changelog={data.changelog}
          efficiencyScorecard={data.efficiencyScorecard}
          query={{ apiBaseUrl, connectorId, limit, runsLimit }}
        />
      )}
    />
  );
}

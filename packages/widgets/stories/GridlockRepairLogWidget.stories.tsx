import type { ComponentType } from "react";
import { DEFAULT_EFFICIENCY_LEDGER, type EfficiencyLedger, type RepairChangelogEntry } from "@samasastudio/gridlock-core";
import { GridlockRepairLogWidget, type GridlockRepairLogWidgetProps } from "../src/index.ts";

export interface StoryMeta<TProps> {
  title: string;
  component: ComponentType<TProps>;
  tags?: readonly string[];
}

export interface StoryObj<TProps> {
  args: TProps;
}

const HEALED_LEDGER: EfficiencyLedger = {
  ...DEFAULT_EFFICIENCY_LEDGER,
  totalRunsCount: 15, deterministicRunsCount: 14, agenticRunsCount: 1,
  naiveTokensAvoided: 350_000, actualTokensUsed: 380,
  tokenReductionPercentage: 99.89, deterministicExecutionPercentage: 93.33,
  estimatedCostSavedUsd: 0.87405, averageRepairMttrMs: 1850,
  subsequentDeterministicRunsServed: 14, updatedAt: "2026-10-27T14:30:00.000Z",
};

const PROMOTED_HEAL_ENTRY: RepairChangelogEntry = {
  id: "repair_tdlr_v1_v2", connectorId: "tdlr-tabs", previousVersion: 1, promotedVersion: 2,
  quarantinedArtifactHash: "b".repeat(64),
  brokenInvariants: ['Missing detailContainerSelector ".project-details" in portal HTML'],
  selectorDiffs: [
    { field: "detailContainerSelector", before: ".project-details", after: ".project-details, .tabs-project-details-v2" },
    { field: "fieldLabels.estimatedCost", before: "Estimated Cost:", after: "Estimated Cost: | Total Estimated Cost:" },
  ],
  rootCauseSummary: "TDLR wrapped filing attributes in .tabs-project-details-v2 and renamed Estimated Cost label.",
  historicalFixturesTested: 1, historicalFixturesPassed: 1, totalFixturesVerified: 2,
  anomalyDetectedAt: "2026-10-27T14:00:00.000Z", patchPromotedAt: "2026-10-27T14:00:01.850Z",
  mttrMs: 1850, interactionId: "inter_widget_heal_v2", repairTokensUsed: 380,
  estimatedRepairCostUsd: 0.00095, subsequentDeterministicRunsServed: 14, expiresAt: null,
};

export const repairLogWidgetMeta: StoryMeta<GridlockRepairLogWidgetProps> = {
  title: "Gridlock/Seam 2/GridlockRepairLogWidget",
  component: GridlockRepairLogWidget,
  tags: ["autodocs"],
};

export default repairLogWidgetMeta;

export const HealthyZeroAnomalies: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "healthy", activeVersion: 1, entries: [] },
    efficiencyLedger: { ...DEFAULT_EFFICIENCY_LEDGER, totalRunsCount: 12, deterministicRunsCount: 12, naiveTokensAvoided: 300_000, estimatedCostSavedUsd: 0.75 },
    theme: "diurnal",
  },
};

export const HealedWithAmortization: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "healthy", activeVersion: 2, entries: [PROMOTED_HEAL_ENTRY] },
    efficiencyLedger: HEALED_LEDGER,
    theme: "diurnal",
  },
};

export const SelectorAnomalyDegraded: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "selector_anomaly", activeVersion: 2, entries: [PROMOTED_HEAL_ENTRY] },
    efficiencyLedger: HEALED_LEDGER,
    theme: "diurnal",
  },
};

export const BlockedByWafDegraded: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "blocked_by_waf", activeVersion: 2, entries: [PROMOTED_HEAL_ENTRY] },
    efficiencyLedger: HEALED_LEDGER,
    theme: "diurnal",
  },
};

export const NocturnalTheme: StoryObj<GridlockRepairLogWidgetProps> = {
  args: { ...HealedWithAmortization.args, theme: "nocturnal" },
};

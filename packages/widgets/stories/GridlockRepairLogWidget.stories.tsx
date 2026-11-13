import type { ComponentType } from "react";
import { DEFAULT_EFFICIENCY_LEDGER, type EfficiencyLedger, type RepairChangelogEntry, type TelemetryRun } from "@samasastudio/gridlock-core/schemas";
import { GridlockRepairLogWidget, type GridlockRepairLogWidgetProps } from "../src/index.ts";

export interface StoryMeta<TProps> {
  title: string;
  component: ComponentType<TProps>;
  tags?: readonly string[];
}

export interface StoryObj<TProps> {
  args: TProps;
}

function makeDetRun(runId: string, hashChar: string, avoided: number, durationMs: number, recordedAt: string): TelemetryRun {
  return {
    runId, stage: "tdlr_ingest", connectorId: "tdlr-tabs", projectNumber: "TABS2027003697",
    sourceArtifactHash: hashChar.repeat(64), execution_mode: "deterministic",
    status: durationMs < 20 ? "unchanged_artifact" : "ingested", durationMs, rawByteLength: avoided * 4,
    tokensUsed: 0, naiveTokensAvoided: avoided, estimatedCostSavedUsd: Number((avoided * 0.0000025).toFixed(4)),
    recordedAt, expiresAt: null,
  };
}

function makeAgentRun(runId: string, hashChar: string, tokensUsed: number, durationMs: number, interactionId: string, recordedAt: string): TelemetryRun {
  return {
    runId, stage: "repair_agent", connectorId: "tdlr-tabs", sourceArtifactHash: hashChar.repeat(64),
    execution_mode: "agentic", status: "agentic_completed", durationMs, rawByteLength: 102_400,
    tokensUsed, naiveTokensAvoided: 0, estimatedCostSavedUsd: 0, interactionId, recordedAt, expiresAt: null,
  };
}

function makeDegradedRun(runId: string, hashChar: string, status: "selector_anomaly" | "blocked_by_waf", durationMs: number, recordedAt: string): TelemetryRun {
  return {
    runId, stage: "tdlr_ingest", connectorId: "tdlr-tabs", sourceArtifactHash: hashChar.repeat(64),
    execution_mode: "deterministic", status, durationMs, rawByteLength: 40_960,
    tokensUsed: 0, naiveTokensAvoided: 0, estimatedCostSavedUsd: 0, recordedAt, expiresAt: null,
  };
}

const RECENT_TELEMETRY_RUNS: TelemetryRun[] = [
  makeDetRun("run_tdlr_det_019", "1", 62_000, 54, "2026-10-23T14:00:00.000Z"),
  makeDetRun("run_tdlr_det_020", "2", 78_000, 47, "2026-10-25T14:00:00.000Z"),
  makeAgentRun("run_tdlr_repair_v2", "b", 380, 1850, "inter_widget_heal_v2", "2026-10-27T14:00:01.850Z"),
  makeDetRun("run_tdlr_det_022", "3", 94_000, 44, "2026-10-28T14:00:00.000Z"),
  makeDetRun("run_tdlr_det_023", "4", 82_000, 12, "2026-10-30T14:00:00.000Z"),
  makeDetRun("run_tdlr_det_024", "a", 96_000, 42, "2026-11-01T14:00:00.000Z"),
  makeAgentRun("run_tdlr_repair_v3", "c", 410, 1420, "inter_widget_heal_v3", "2026-11-03T14:00:01.420Z"),
  makeDetRun("run_tdlr_det_027", "5", 118_000, 39, "2026-11-03T18:00:00.000Z"),
  makeDetRun("run_tdlr_det_028", "d", 120_000, 11, "2026-11-04T14:00:00.000Z"),
];

const ZERO_ANOMALY_RUNS = RECENT_TELEMETRY_RUNS.filter((run) => run.execution_mode === "deterministic").slice(0, 4);
const ANOMALY_RUN = makeDegradedRun("run_tdlr_anom_029", "e", "selector_anomaly", 31, "2026-11-05T14:00:00.000Z");
const WAF_BLOCKED_RUN = makeDegradedRun("run_tdlr_waf_030", "f", "blocked_by_waf", 8, "2026-11-06T14:00:00.000Z");

const HEALED_LEDGER: EfficiencyLedger = {
  ...DEFAULT_EFFICIENCY_LEDGER,
  totalRunsCount: 28, deterministicRunsCount: 26, agenticRunsCount: 2,
  deterministicExecutionRatio: 0.9286, deterministicExecutionPercentage: 92.86,
  naiveTokensAvoided: 650_000, actualTokensUsed: 790, tokenReductionPercentage: 99.88,
  estimatedCostSavedUsd: 1.623, actualCostUsd: 0.001975, averageRepairMttrMs: 1635,
  subsequentDeterministicRunsServed: 26, updatedAt: "2026-11-04T14:00:00.000Z",
  recentRuns: RECENT_TELEMETRY_RUNS,
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

const PROMOTED_HEAL_ENTRY_V3: RepairChangelogEntry = {
  id: "repair_tdlr_v2_v3", connectorId: "tdlr-tabs", previousVersion: 2, promotedVersion: 3,
  quarantinedArtifactHash: "c".repeat(64),
  brokenInvariants: ['Missing definitionListSelector "dl.dl-horizontal" and squareFootage term in portal HTML'],
  selectorDiffs: [
    { field: "definitionListSelector", before: "dl.dl-horizontal", after: "dl.dl-horizontal, dl.tabs-filing-spec" },
    { field: "fieldLabels.squareFootage", before: "Square Footage:", after: "Square Footage: | Gross Square Footage:" },
  ],
  rootCauseSummary: "TDLR replaced Bootstrap dl-horizontal markup with dl.tabs-filing-spec and relabeled Square Footage on campus fit-out filings.",
  historicalFixturesTested: 2, historicalFixturesPassed: 2, totalFixturesVerified: 3,
  anomalyDetectedAt: "2026-11-03T14:00:00.000Z", patchPromotedAt: "2026-11-03T14:00:01.420Z",
  mttrMs: 1420, interactionId: "inter_widget_heal_v3", repairTokensUsed: 410,
  estimatedRepairCostUsd: 0.001025, subsequentDeterministicRunsServed: 12, expiresAt: null,
};

const PROMOTED_ENTRIES = [PROMOTED_HEAL_ENTRY, PROMOTED_HEAL_ENTRY_V3];

const repairLogWidgetMeta: StoryMeta<GridlockRepairLogWidgetProps> = {
  title: "Gridlock/Seam 2/GridlockRepairLogWidget",
  component: GridlockRepairLogWidget,
  tags: ["autodocs"],
};

export default repairLogWidgetMeta;

export const HealthyZeroAnomalies: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "healthy", activeVersion: 1, entries: [] },
    efficiencyLedger: {
      ...DEFAULT_EFFICIENCY_LEDGER, totalRunsCount: 4, deterministicRunsCount: 4,
      naiveTokensAvoided: 316_000, estimatedCostSavedUsd: 0.79, updatedAt: "2026-10-30T14:00:00.000Z", recentRuns: ZERO_ANOMALY_RUNS,
    },
    theme: "diurnal",
  },
};

export const HealedWithAmortization: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "healthy", activeVersion: 3, entries: PROMOTED_ENTRIES },
    efficiencyLedger: HEALED_LEDGER,
    theme: "diurnal",
  },
};

export const SelectorAnomalyDegraded: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "selector_anomaly", activeVersion: 3, entries: PROMOTED_ENTRIES },
    efficiencyLedger: {
      ...HEALED_LEDGER, totalRunsCount: 29, failedOrBlockedRunsCount: 1,
      deterministicExecutionRatio: 0.8966, deterministicExecutionPercentage: 89.66,
      updatedAt: "2026-11-05T14:00:00.000Z", recentRuns: [...RECENT_TELEMETRY_RUNS, ANOMALY_RUN],
    },
    theme: "diurnal",
  },
};

export const BlockedByWafDegraded: StoryObj<GridlockRepairLogWidgetProps> = {
  args: {
    changelog: { connectorId: "tdlr-tabs", connectorStatus: "blocked_by_waf", activeVersion: 3, entries: PROMOTED_ENTRIES },
    efficiencyLedger: {
      ...HEALED_LEDGER, totalRunsCount: 30, failedOrBlockedRunsCount: 2,
      deterministicExecutionRatio: 0.8667, deterministicExecutionPercentage: 86.67,
      updatedAt: "2026-11-06T14:00:00.000Z", recentRuns: [...RECENT_TELEMETRY_RUNS, ANOMALY_RUN, WAF_BLOCKED_RUN],
    },
    theme: "diurnal",
  },
};

export const NocturnalTheme: StoryObj<GridlockRepairLogWidgetProps> = {
  args: { ...HealedWithAmortization.args, theme: "nocturnal" },
};

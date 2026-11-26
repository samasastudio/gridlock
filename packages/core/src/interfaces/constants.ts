import {
  TdlrFieldLabelsSchema,
  type ConnectorConfig,
  type TdlrSearchFilter,
} from "./filing-models.ts";
import type { UiAstComponentType } from "./investigate-ast-models.ts";
import type { EfficiencyScorecard } from "./run-record-models.ts";

export const GRIDLOCK_USER_AGENT =
  "GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)";

export const DEFAULT_TDLR_BASE_URL = "https://www.tdlr.texas.gov";
export const ARTIFACT_BUCKET_URI = "gs://gridlock-artifacts";
export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const MILESTONE_COST_THRESHOLD_USD = 25_000_000;
export const MIN_POLITE_DELAY_MS = 1_500;
export const MAX_RECORDS_PER_RUN = 100;
export const MAX_CONCURRENCY = 1;

export const NAIVE_COST_PER_TOKEN_USD = 0.0000025;
export const DEFAULT_GCP_PROJECT_ID = "gridlock-civic-atlas";
export const REPAIR_AGENT_MODEL = "gemini-3.8-flash" as const;
export const PAINTER_AGENT_MODEL = "gemini-3-pro-image" as const;
export const INVESTIGATION_PLANNER_MODEL = "gemini-3.8-flash" as const;
export const DEFAULT_LINEAGE_ID = "texas-corridor-main" as const;
export const SCENARIO_BRANCH_WATERMARK =
  "Scenario Branch / Unverified Projection" as const;
export const CANONICAL_MILESTONE_LABEL =
  "Canonical Filing Milestone" as const;
export const MAX_SCENARIO_PROMPT_LENGTH = 1_000;
export const DEFAULT_MAX_BRANCHES_PER_LINEAGE = 25;
export const MAX_WORKSPACE_NODES = 6;
export const MAX_PROJECTS_PER_CARD = 10;
export const MAX_INVESTIGATE_QUERY_LENGTH = 1_000;
export const MAX_INVESTIGATE_BODY_BYTES = 131_072;
export const MAX_PLANNER_CATALOG_PROJECTS = 50;
export const CONNECTOR_HEALTH_RECENT_RUNS_LIMIT = 10;

export const DEFAULT_TDLR_SEARCH_FILTERS: readonly TdlrSearchFilter[] = [
  { field: "ProjectName", value: "Data Center" },
  { field: "ProjectName", value: "Datacenter" },
  { field: "FacilityName", value: "Data Center" },
  { field: "OwnerName", value: "Datacenter" },
  { field: "OwnerName", value: "QTS" },
  { field: "OwnerName", value: "CyrusOne" },
  { field: "OwnerName", value: "Compass" },
  { field: "OwnerName", value: "Colovore" },
];

export const DEFAULT_EFFICIENCY_SCORECARD: EfficiencyScorecard = {
  ledgerId: "efficiency_scorecard",
  deterministicRunsCount: 0,
  agenticRunsCount: 0,
  failedOrBlockedRunsCount: 0,
  totalRunsCount: 0,
  deterministicExecutionRatio: 1,
  deterministicExecutionPercentage: 100,
  naiveTokensAvoided: 0,
  actualTokensUsed: 0,
  tokenReductionPercentage: 100,
  estimatedCostSavedUsd: 0,
  actualCostUsd: 0,
  imageGenerationsAvoided: 0,
  visualPlateCacheHits: 0,
  uncachedImageGenerationsCount: 0,
  visualPlateCacheEfficiencyPercentage: 100,
  averageRepairMttrMs: 0,
  subsequentDeterministicRunsServed: 0,
  updatedAt: "2026-10-25T00:00:00.000Z",
  expiresAt: null,
  recentRuns: [],
};

export const DEFAULT_TDLR_CONNECTOR_CONFIG: ConnectorConfig = {
  connectorId: "tdlr-tabs",
  version: 1,
  status: "healthy",
  detailContainerSelector: ".project-details",
  definitionListSelector: "dl.dl-horizontal",
  termSelector: "dt",
  descriptionSelector: "dd",
  fieldLabels: {
    projectName: "Project Name:",
    projectNumber: "Project Number:",
    facilityName: "Facility Name:",
    locationAddress: "Location Address:",
    county: "Location County:",
    startDate: "Start Date:",
    completionDate: "Completion Date:",
    estimatedCost: "Estimated Cost:",
    typeOfWork: "Type of Work:",
    scopeOfWork: "Scope of Work:",
    squareFootage: "Square Footage:",
    currentStatus: "Current Status:",
    ownerName: "Owner Name:",
    designFirmName: "Design Firm Name:",
  },
  updatedAt: "2026-10-25T00:00:00.000Z",
};

export const CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    detailContainerSelector: { type: "string" },
    definitionListSelector: { type: "string" },
    termSelector: { type: "string" },
    descriptionSelector: { type: "string" },
    fieldLabels: {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(TdlrFieldLabelsSchema.shape).map((key) => [
          key,
          { type: "string" },
        ])
      ),
    },
    rootCauseSummary: { type: "string" },
  },
  required: ["rootCauseSummary"],
};

const PLANNED_PROJECT_NUMBERS_JSON_SCHEMA: Record<string, unknown> = {
  type: "array",
  minItems: 1,
  maxItems: MAX_PROJECTS_PER_CARD,
  items: { type: "string" },
};

function buildPlannerCardJsonSchema(
  component: UiAstComponentType,
  extraProperties: Record<string, unknown>,
  requiredExtraKeys: readonly string[]
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      nodeId: { type: "string" },
      component: { type: "string", enum: [component] },
      ...extraProperties,
    },
    required: ["nodeId", "component", ...requiredExtraKeys],
  };
}

export const PLANNER_LAYOUT_SPEC_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      maxItems: MAX_WORKSPACE_NODES,
      items: {
        anyOf: [
          buildPlannerCardJsonSchema(
            "ProjectDossierCard",
            { projectNumber: { type: "string" } },
            ["projectNumber"]
          ),
          buildPlannerCardJsonSchema(
            "VisualPlateScrubber",
            {
              lineageId: { type: "string" },
              initialPlateId: { type: "string" },
            },
            ["lineageId"]
          ),
          buildPlannerCardJsonSchema(
            "ObservationTimeline",
            { projectNumbers: PLANNED_PROJECT_NUMBERS_JSON_SCHEMA },
            ["projectNumbers"]
          ),
          buildPlannerCardJsonSchema(
            "MetricComparisonTable",
            { projectNumbers: PLANNED_PROJECT_NUMBERS_JSON_SCHEMA },
            ["projectNumbers"]
          ),
          buildPlannerCardJsonSchema(
            "ConnectorHealthCard",
            { connectorId: { type: "string" } },
            ["connectorId"]
          ),
        ],
      },
    },
  },
  required: ["nodes"],
};

import { z } from "zod";

export const Sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected 64-character lowercase hex SHA-256 hash");

export type Sha256Hash = z.infer<typeof Sha256HashSchema>;

export const TdlrProjectNumberSchema = z
  .string()
  .regex(/^TABS\d+$/, "Expected TDLR TABS project number (e.g. TABS2027003697)");

export type TdlrProjectNumber = z.infer<typeof TdlrProjectNumberSchema>;

export const ConnectorStatusSchema = z.enum([
  "healthy",
  "selector_anomaly",
  "blocked_by_waf",
]);

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const TdlrFieldLabelsSchema = z.object({
  projectName: z.string().min(1),
  projectNumber: z.string().min(1),
  facilityName: z.string().min(1),
  locationAddress: z.string().min(1),
  county: z.string().min(1),
  startDate: z.string().min(1),
  completionDate: z.string().min(1),
  estimatedCost: z.string().min(1),
  typeOfWork: z.string().min(1),
  scopeOfWork: z.string().min(1),
  squareFootage: z.string().min(1),
  currentStatus: z.string().min(1),
  ownerName: z.string().min(1),
  designFirmName: z.string().min(1).optional(),
});

export type TdlrFieldLabels = z.infer<typeof TdlrFieldLabelsSchema>;

export const ConnectorConfigSchema = z.object({
  connectorId: z.string().min(1),
  version: z.number().int().positive(),
  status: ConnectorStatusSchema,
  detailContainerSelector: z.string().min(1),
  definitionListSelector: z.string().min(1),
  termSelector: z.string().min(1),
  descriptionSelector: z.string().min(1),
  fieldLabels: TdlrFieldLabelsSchema,
  updatedAt: z.string().datetime(),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export const SourceArtifactSchema = z.object({
  sha256: Sha256HashSchema,
  connectorId: z.string().min(1),
  sourceUrl: z.string().url(),
  contentType: z.string().min(1),
  rawByteLength: z.number().int().nonnegative(),
  compressedByteLength: z.number().int().positive(),
  storageUri: z.string().startsWith("gs://"),
  capturedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  referencedByMilestone: z.boolean().default(false),
});

export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const ProjectSchema = z.object({
  projectNumber: TdlrProjectNumberSchema,
  projectName: z.string().min(1),
  facilityName: z.string().min(1),
  ownerName: z.string().min(1),
  designFirmName: z.string().min(1).optional(),
  locationAddress: z.string().min(1),
  county: z.string().min(1),
  estimatedCostUsd: z.number().positive(),
  squareFootage: z.number().positive(),
  typeOfWork: z.string().min(1),
  scopeOfWork: z.string().min(1),
  currentStatus: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestSourceArtifactHash: Sha256HashSchema,
  updatedAt: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ObservationSchema = z.object({
  id: z.string().min(1),
  projectNumber: TdlrProjectNumberSchema,
  sourceArtifactHash: Sha256HashSchema,
  observedAt: z.string().datetime(),
  status: z.string().min(1),
  estimatedCostUsd: z.number().positive(),
  squareFootage: z.number().positive(),
  scopeOfWork: z.string().min(1),
  isMilestone: z.boolean(),
});

export type Observation = z.infer<typeof ObservationSchema>;

export const TdlrSearchRowSchema = z.object({
  ProjectCreatedOn: z.string().min(1),
  ProjectNumber: TdlrProjectNumberSchema,
  ProjectName: z.string().min(1),
  FacilityName: z.string().optional().default(""),
  OwnerName: z.string().optional().default(""),
  ScopeOfWork: z.string().optional().default(""),
  ProjectStatus: z.number().int().optional(),
  EstimatedCost: z.number().optional(),
});

export type TdlrSearchRow = z.infer<typeof TdlrSearchRowSchema>;

export const ExecutionModeSchema = z.enum(["deterministic", "agentic"]);

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const TelemetryRunStatusSchema = z.enum([
  "ingested",
  "unchanged_artifact",
  "selector_anomaly",
  "blocked_by_waf",
  "aborted",
  "agentic_completed",
  "agentic_failed",
]);

export type TelemetryRunStatus = z.infer<typeof TelemetryRunStatusSchema>;

export const TelemetrySpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  stage: z.string().min(1),
  execution_mode: ExecutionModeSchema,
  status: TelemetryRunStatusSchema,
  durationMs: z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  naiveTokensAvoided: z.number().int().nonnegative(),
  interactionId: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
    .optional(),
});

export type TelemetrySpan = z.infer<typeof TelemetrySpanSchema>;

export const TelemetryRunSchema = z.object({
  runId: z.string().min(1),
  stage: z.string().min(1),
  connectorId: z.string().min(1).optional(),
  projectNumber: TdlrProjectNumberSchema.optional(),
  sourceArtifactHash: Sha256HashSchema.optional(),
  execution_mode: ExecutionModeSchema,
  status: TelemetryRunStatusSchema,
  durationMs: z.number().nonnegative(),
  rawByteLength: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  naiveTokensAvoided: z.number().int().nonnegative(),
  estimatedCostSavedUsd: z.number().nonnegative(),
  interactionId: z.string().min(1).optional(),
  recordedAt: z.string().datetime(),
  expiresAt: z.null(),
});

export type TelemetryRun = z.infer<typeof TelemetryRunSchema>;

export const EfficiencyLedgerSchema = z.object({
  ledgerId: z.string().min(1),
  deterministicRunsCount: z.number().int().nonnegative(),
  agenticRunsCount: z.number().int().nonnegative(),
  failedOrBlockedRunsCount: z.number().int().nonnegative(),
  totalRunsCount: z.number().int().nonnegative(),
  deterministicExecutionRatio: z.number().min(0).max(1),
  deterministicExecutionPercentage: z.number().min(0).max(100),
  naiveTokensAvoided: z.number().int().nonnegative(),
  actualTokensUsed: z.number().int().nonnegative(),
  tokenReductionPercentage: z.number().min(0).max(100),
  estimatedCostSavedUsd: z.number().nonnegative(),
  actualCostUsd: z.number().nonnegative(),
  imageGenerationsAvoided: z.number().int().nonnegative(),
  visualPlateCacheHits: z.number().int().nonnegative(),
  visualPlateCacheEfficiencyPercentage: z.number().min(0).max(100),
  averageRepairMttrMs: z.number().nonnegative(),
  subsequentDeterministicRunsServed: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  expiresAt: z.null(),
  recentRuns: z.array(TelemetryRunSchema),
});

export type EfficiencyLedger = z.infer<typeof EfficiencyLedgerSchema>;

export const SelectorDiffEntrySchema = z.object({
  field: z.string().min(1),
  before: z.string(),
  after: z.string(),
});

export type SelectorDiffEntry = z.infer<typeof SelectorDiffEntrySchema>;

export const CandidateSelectorPatchSchema = z.object({
  detailContainerSelector: z.string().min(1).optional(),
  definitionListSelector: z.string().min(1).optional(),
  termSelector: z.string().min(1).optional(),
  descriptionSelector: z.string().min(1).optional(),
  fieldLabels: TdlrFieldLabelsSchema.partial().optional(),
  rootCauseSummary: z.string().min(1),
});

export type CandidateSelectorPatch = z.infer<
  typeof CandidateSelectorPatchSchema
>;

export const RepairChangelogEntrySchema = z.object({
  id: z.string().min(1),
  connectorId: z.string().min(1),
  previousVersion: z.number().int().positive(),
  promotedVersion: z.number().int().positive(),
  quarantinedArtifactHash: Sha256HashSchema,
  brokenInvariants: z.array(z.string().min(1)).min(1),
  selectorDiffs: z.array(SelectorDiffEntrySchema).min(1),
  rootCauseSummary: z.string().min(1),
  historicalFixturesTested: z.number().int().nonnegative(),
  historicalFixturesPassed: z.number().int().nonnegative(),
  totalFixturesVerified: z.number().int().positive(),
  anomalyDetectedAt: z.string().datetime(),
  patchPromotedAt: z.string().datetime(),
  mttrMs: z.number().nonnegative(),
  interactionId: z.string().min(1),
  repairTokensUsed: z.number().int().nonnegative(),
  estimatedRepairCostUsd: z.number().nonnegative(),
  subsequentDeterministicRunsServed: z.number().int().nonnegative(),
  expiresAt: z.null(),
});

export type RepairChangelogEntry = z.infer<typeof RepairChangelogEntrySchema>;

export const DEFAULT_EFFICIENCY_LEDGER: EfficiencyLedger = {
  ledgerId: "telemetry_summary",
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

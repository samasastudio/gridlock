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
});

export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const ProjectSchema = z.object({
  projectNumber: TdlrProjectNumberSchema,
  projectName: z.string().min(1),
  facilityName: z.string().min(1),
  ownerName: z.string().min(1),
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
  },
  updatedAt: "2026-10-25T00:00:00.000Z",
};

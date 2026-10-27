import { z } from "zod";
import { Sha256HashSchema, TdlrProjectNumberSchema } from "./primitives.ts";

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

export interface SiteAccessInput {
  status: number;
  headers?: Record<string, string | undefined>;
  body: string;
  robotsTxt?: string;
  targetPath?: string;
  userAgent?: string;
  now?: Date;
}

export type SiteAccessCheckResult =
  | {
      allowed: true;
      status: "ok";
      tokensUsed: 0;
    }
  | {
      allowed: false;
      status: "blocked_by_waf";
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

export type IngestFilingResult =
  | {
      status: "ingested";
      sourceArtifact: SourceArtifact;
      project: Project;
      observation: Observation;
    }
  | {
      status: "unchanged_artifact";
      sourceArtifact: SourceArtifact;
    }
  | {
      status: "selector_anomaly";
      sourceArtifact: SourceArtifact;
      invariantErrors: string[];
    }
  | {
      status: "blocked_by_waf";
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

export type TdlrDiscoveryMode = "backfill" | "daily";

export interface TdlrSearchFilter {
  field: "ProjectName" | "FacilityName" | "OwnerName";
  value: string;
}

export type TdlrDiscoverySweepResult =
  | {
      status: "completed";
      mode: TdlrDiscoveryMode;
      discoveredCount: number;
      ingestedProjectNumbers: string[];
      results: IngestFilingResult[];
      circuitBreakerTripped: boolean;
      skippedByCircuitBreakerCount: number;
      tokensUsed: 0;
    }
  | {
      status: "blocked_by_waf";
      mode: TdlrDiscoveryMode;
      reason: string;
      retryAfterSeconds?: number;
      tokensUsed: 0;
    };

import type { Buffer } from "node:buffer";
import {
  ARTIFACT_BUCKET_URI,
  CANONICAL_MILESTONE_LABEL,
  LineageEdgeSchema,
  LineageNodeSchema,
  PAINTER_AGENT_MODEL,
  SCENARIO_BRANCH_WATERMARK,
  VisualPlateLineageSchema,
  VisualPlateSchema,
  type GeminiInteractionResponse,
  type Observation,
  type VisualPlate,
  type VisualPlateLineage,
} from "../../interfaces/index.ts";

export type PainterStage =
  | "painter_milestone_gate"
  | "painter_bootstrap"
  | "painter_milestone_delta"
  | "painter_branch_lineage";

export interface PainterCompletedTurn {
  interaction: GeminiInteractionResponse;
  rebootstrappedFromParentWebp: boolean;
  priorTokensUsed: number;
}

export interface PainterInteractionFailure {
  ok: false;
  kind: "non_completed_status" | "missing_id" | "thrown_error";
  reason: string;
  diagnosticMessage: string;
  tokensUsed: number;
  interactionId?: string;
  interactionStatus?: string;
  httpStatus?: number;
  errorCodes: readonly string[];
}

export type PainterTurnAttemptResult =
  | { ok: true; turn: PainterCompletedTurn }
  | PainterInteractionFailure;

const NON_INTERACTION_FAULT_RE =
  /\b(?:401|403|429|5\d\d)\b|api[\s_-]*key|oauth|credential|unauthenticated|permission[\s_-]*denied|quota|rate[\s_-]*limit|\bmodels\/|\bmodel\b.*\bnot[\s_-]*found\b/i;
const EXPIRED_ERROR_CODE_RE =
  /(?:previous_)?interaction.*(?:expir|not[\s_-]*found|invalid|reject)|^not_found$/i;
const INTERACTION_TARGET_RE = /\bprevious_interaction(?:_id)?\b|\binteraction(?:[\s_-]*id)?\b/i;
const INTERACTION_FAULT_RE = /\b404\b|not[\s_-]*found|expir|invalid|reject|unknown|ttl/i;

export function buildWebpMultimodalInput(
  text: string,
  webpBuffer: Buffer
): Array<Record<string, unknown>> {
  return [
    { type: "text", text },
    { type: "image", mime_type: "image/webp", data: webpBuffer.toString("base64") },
  ];
}

export function classifyNonCompletedInteraction(
  interaction: GeminiInteractionResponse,
  tokensUsed: number,
  trimmedId: string | undefined
): PainterInteractionFailure {
  const status = interaction.status ?? "missing";
  const errorCodes = (interaction.errors ?? []).flatMap((e) => (e.code ? [e.code] : []));
  const messages = (interaction.errors ?? []).flatMap((e) => (e.message ? [e.message] : []));
  const diagnosticMessage = messages.join("; ");
  const suffix = diagnosticMessage.length > 0 ? `: ${diagnosticMessage}` : "";
  return {
    ok: false,
    kind: "non_completed_status",
    reason: `Gemini painter interaction returned non-completed status "${status}"${suffix}`,
    diagnosticMessage,
    tokensUsed,
    interactionStatus: status,
    errorCodes,
    ...(trimmedId ? { interactionId: trimmedId } : {}),
  };
}

export function classifyThrownPainterError(error: unknown): PainterInteractionFailure {
  const errObj = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const httpStatus =
    typeof errObj?.status === "number"
      ? errObj.status
      : typeof errObj?.code === "number"
        ? errObj.code
        : undefined;
  const errorCodes = typeof errObj?.code === "string" ? [errObj.code] : [];
  const diagnosticMessage = error instanceof Error ? error.message : "Gemini painter interaction failed";
  return {
    ok: false,
    kind: "thrown_error",
    reason: diagnosticMessage,
    diagnosticMessage,
    tokensUsed: 0,
    errorCodes,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

export function isExpiredOrRejectedPreviousInteraction(failure: PainterInteractionFailure): boolean {
  if (failure.kind === "missing_id") return false;
  if (failure.kind === "non_completed_status" && failure.interactionStatus !== "failed") return false;
  if (failure.httpStatus !== undefined && failure.httpStatus !== 400 && failure.httpStatus !== 404) return false;
  if (NON_INTERACTION_FAULT_RE.test(failure.diagnosticMessage)) return false;
  if (failure.errorCodes.some((code) => EXPIRED_ERROR_CODE_RE.test(code))) return true;
  if (failure.httpStatus === 404) return true;
  return INTERACTION_TARGET_RE.test(failure.diagnosticMessage) && INTERACTION_FAULT_RE.test(failure.diagnosticMessage);
}

export function evaluateMilestoneObservations(
  observations: readonly Observation[],
  existingPlates: readonly VisualPlate[]
): Observation[] {
  const alreadyPaintedIds = new Set(
    existingPlates
      .filter((plate) => !plate.isBranch)
      .flatMap((plate) => plate.triggeringObservationIds)
  );

  return observations.filter((obs) => obs.isMilestone && !alreadyPaintedIds.has(obs.id));
}

export function comparePlatesChronologically(a: VisualPlate, b: VisualPlate): number {
  return a.turnNumber !== b.turnNumber
    ? a.turnNumber - b.turnNumber
    : a.createdAt.localeCompare(b.createdAt);
}

export function selectActiveCanonicalPlate(existingPlates: readonly VisualPlate[]): VisualPlate | null {
  return existingPlates
    .filter((plate) => !plate.isBranch)
    .reduce<VisualPlate | null>(
      (latest, candidate) =>
        latest === null || comparePlatesChronologically(latest, candidate) <= 0 ? candidate : latest,
      null
    );
}

export function formatObservationsSummary(observations: readonly Observation[]): string {
  return observations
    .map((obs) => `${obs.projectNumber} (${obs.status}, $${obs.estimatedCostUsd.toLocaleString("en-US")}, ${obs.squareFootage.toLocaleString("en-US")} sq ft: ${obs.scopeOfWork})`)
    .join("; ");
}

export function synthesizeBootstrapPrompt(lineageId: string, observations: readonly Observation[]): string {
  return `Bootstrap Atlas Dossier technical topographical plate for corridor lineage "${lineageId}" incorporating initial milestone observations: ${formatObservationsSummary(observations)}`;
}

export function synthesizeMilestoneDeltaPrompt(
  lineageId: string,
  parentPlate: VisualPlate,
  observations: readonly Observation[]
): string {
  return `Paint incremental milestone delta onto corridor lineage "${lineageId}" from parent plate ${parentPlate.plateId} (turn ${parentPlate.turnNumber}) while strictly preserving exact camera angle, topography, Atlas Dossier typography, and all existing corridor infrastructure: ${formatObservationsSummary(observations)}`;
}

export function synthesizeScenarioBranchPrompt(parentPlate: VisualPlate, scenarioPrompt: string): string {
  return `Fork speculative scenario branch from parent plate ${parentPlate.plateId} (interaction ${parentPlate.interactionId}) with watermark "${SCENARIO_BRANCH_WATERMARK}", preserving parent camera angle, topography, and Atlas Dossier typography: ${scenarioPrompt}`;
}

export function buildVisualPlateLineage(params: {
  lineageId: string;
  plates: readonly VisualPlate[];
  observationsById: ReadonlyMap<string, Observation>;
}): VisualPlateLineage {
  const sortedPlates = [...params.plates].sort(comparePlatesChronologically);
  const plateByInteractionId = new Map(sortedPlates.map((plate) => [plate.interactionId, plate]));
  const edges = sortedPlates.flatMap((plate) => {
    if (!plate.parentInteractionId) return [];
    const parentPlate = plateByInteractionId.get(plate.parentInteractionId);
    return [
      LineageEdgeSchema.parse({
        fromInteractionId: plate.parentInteractionId,
        toInteractionId: plate.interactionId,
        fromPlateId: parentPlate?.plateId ?? plate.parentPlateId ?? "unknown",
        toPlateId: plate.plateId,
        isBranch: plate.isBranch,
      }),
    ];
  });
  const nodes = sortedPlates.map((plate) =>
    LineageNodeSchema.parse({
      plate,
      observations: plate.triggeringObservationIds.flatMap((obsId) => {
        const found = params.observationsById.get(obsId);
        return found ? [found] : [];
      }),
      childInteractionIds: edges.filter((e) => e.fromInteractionId === plate.interactionId).map((e) => e.toInteractionId),
    })
  );
  const rootPlate = sortedPlates.find((p) => !p.isBranch && p.parentInteractionId === null) ?? sortedPlates[0] ?? null;
  const activeCanonical = selectActiveCanonicalPlate(sortedPlates);
  return VisualPlateLineageSchema.parse({
    lineageId: params.lineageId,
    rootInteractionId: rootPlate?.interactionId ?? null,
    activeCanonicalPlateId: activeCanonical?.plateId ?? null,
    nodes,
    edges,
  });
}

export type VisualPlateTurnSpec = {
  turnNumber: number;
  parentInteractionId: string | null;
  parentPlateId: string | null;
  observations: readonly Observation[];
  prompt: string;
} & (
  | { isBranch: false }
  | { isBranch: true; scenarioPrompt: string; expiresAt: string }
);

export function buildVisualPlateRecord(
  params: VisualPlateTurnSpec & {
    lineageId: string;
    interactionId: string;
    rebootstrappedFromParentWebp: boolean;
    webpBuffer: Buffer;
    sha256: string;
    createdAt: string;
  }
): VisualPlate {
  const prefix = params.isBranch ? "branch" : "plate";
  const plateId = `${prefix}_${params.lineageId}_t${params.turnNumber}_${params.sha256.slice(0, 8)}`;
  const storagePath = params.isBranch
    ? `${ARTIFACT_BUCKET_URI}/branches/ephemeral/${params.lineageId}/${plateId}.webp`
    : `${ARTIFACT_BUCKET_URI}/plates/${params.lineageId}/${plateId}.webp`;
  return VisualPlateSchema.parse({
    plateId,
    lineageId: params.lineageId,
    turnNumber: params.turnNumber,
    model: PAINTER_AGENT_MODEL,
    interactionId: params.interactionId,
    parentInteractionId: params.parentInteractionId,
    parentPlateId: params.parentPlateId,
    rebootstrappedFromParentWebp: params.rebootstrappedFromParentWebp,
    projectNumbers: Array.from(new Set(params.observations.map((obs) => obs.projectNumber))),
    triggeringObservationIds: params.observations.map((obs) => obs.id),
    sourceArtifactHashes: Array.from(new Set(params.observations.map((obs) => obs.sourceArtifactHash))),
    prompt: params.prompt,
    storageUri: storagePath,
    mimeType: "image/webp",
    byteLength: params.webpBuffer.byteLength,
    sha256: params.sha256,
    isBranch: params.isBranch,
    ...(params.isBranch ? { scenarioPrompt: params.scenarioPrompt } : {}),
    epistemicLabel: params.isBranch ? SCENARIO_BRANCH_WATERMARK : CANONICAL_MILESTONE_LABEL,
    watermarkText: params.isBranch ? SCENARIO_BRANCH_WATERMARK : null,
    createdAt: params.createdAt,
    expiresAt: params.isBranch ? params.expiresAt : null,
  });
}

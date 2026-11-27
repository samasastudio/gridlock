import {
  BranchIllustrationResponseSchema,
  FrameTimelineResponseSchema,
  type BranchIllustrationRequest,
  type BranchIllustrationResponse,
  type FrameTimelineResponse,
} from "@samasastudio/gridlock-core/schemas";
import { buildApiEndpointUrl, fetchValidatedJson, type DossierHttpError } from "./dossier-http-client.ts";

export interface FrameTimelineQuery {
  apiBaseUrl: string;
  timelineId?: string;
}

export type FrameTimelineSnapshotResult =
  | { ok: true; timeline: FrameTimelineResponse }
  | DossierHttpError;

export function buildFrameTimelineUrl(options: FrameTimelineQuery): string {
  return buildApiEndpointUrl(options.apiBaseUrl, "/api/illustrations/timeline", {
    timeline_id: options.timelineId,
  });
}

export function buildIllustrationAssetUrl(apiBaseUrl: string, assetPath: string): string {
  return buildApiEndpointUrl(apiBaseUrl, assetPath);
}

export async function fetchFrameTimelineSnapshot(
  options: FrameTimelineQuery & { signal?: AbortSignal }
): Promise<FrameTimelineSnapshotResult> {
  const result = await fetchValidatedJson({
    url: buildFrameTimelineUrl(options),
    schema: FrameTimelineResponseSchema,
    resourceLabel: "Frame Timeline",
    init: { signal: options.signal },
  });
  return result.ok ? { ok: true, timeline: result.data } : result;
}

export interface SubmitScenarioBranchOptions extends BranchIllustrationRequest {
  apiBaseUrl: string;
  signal?: AbortSignal;
}

export type SubmitScenarioBranchResult =
  | { ok: true; branch: BranchIllustrationResponse }
  | DossierHttpError;

export function buildScenarioBranchUrl(apiBaseUrl: string): string {
  return buildApiEndpointUrl(apiBaseUrl, "/api/illustrations/branch");
}

export async function submitScenarioBranch(
  options: SubmitScenarioBranchOptions
): Promise<SubmitScenarioBranchResult> {
  const trimmedTimelineId = options.timelineId?.trim();
  const payload: BranchIllustrationRequest = {
    interactionId: options.interactionId.trim(),
    scenarioPrompt: options.scenarioPrompt.trim(),
    ...(trimmedTimelineId ? { timelineId: trimmedTimelineId } : {}),
  };

  const result = await fetchValidatedJson({
    url: buildScenarioBranchUrl(options.apiBaseUrl),
    schema: BranchIllustrationResponseSchema,
    resourceLabel: "Scenario Branch",
    networkErrorVerb: "submitting",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal,
    },
  });
  return result.ok ? { ok: true, branch: result.data } : result;
}

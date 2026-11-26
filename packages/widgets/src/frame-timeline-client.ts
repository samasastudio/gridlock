import {
  BranchIllustrationResponseSchema,
  FrameTimelineResponseSchema,
  type BranchIllustrationRequest,
  type BranchIllustrationResponse,
  type FrameTimelineResponse,
} from "@samasastudio/gridlock-core/schemas";

export interface FrameTimelineQuery {
  apiBaseUrl: string;
  timelineId?: string;
}

export type FrameTimelineSnapshotResult =
  | { ok: true; timeline: FrameTimelineResponse }
  | { ok: false; message: string; statusCode?: number };

export function buildFrameTimelineUrl(options: FrameTimelineQuery): string {
  const base = options.apiBaseUrl.replace(/\/+$/, "");
  const trimmedId = options.timelineId?.trim();
  if (!trimmedId) return `${base}/api/illustrations/timeline`;
  const query = new URLSearchParams([["timeline_id", trimmedId]]).toString();
  return `${base}/api/illustrations/timeline?${query}`;
}

export function buildIllustrationAssetUrl(apiBaseUrl: string, assetPath: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = `/${assetPath.replace(/^\/+/, "")}`;
  return `${base}${normalizedPath}`;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message.length > 0 ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchFrameTimelineSnapshot(
  options: FrameTimelineQuery & { signal?: AbortSignal }
): Promise<FrameTimelineSnapshotResult> {
  try {
    const res = await globalThis.fetch(buildFrameTimelineUrl(options), { signal: options.signal });
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        message: await readErrorMessage(res, `Frame Timeline HTTP ${res.status}`),
      };
    }
    const raw: unknown = await res.json();
    const parsed = FrameTimelineResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Malformed Frame Timeline payload" };
    }
    return { ok: true, timeline: parsed.data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Network error loading Frame Timeline",
    };
  }
}

export interface SubmitScenarioBranchOptions extends BranchIllustrationRequest {
  apiBaseUrl: string;
  signal?: AbortSignal;
}

export type SubmitScenarioBranchResult =
  | { ok: true; branch: BranchIllustrationResponse }
  | { ok: false; message: string; statusCode?: number; errorCode?: string };

export function buildScenarioBranchUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return `${base}/api/illustrations/branch`;
}

async function parseJsonBody(
  res: Response
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await res.json() };
  } catch {
    return { ok: false };
  }
}

async function readErrorEnvelope(
  res: Response,
  fallback: string
): Promise<{ message: string; errorCode?: string }> {
  const parsed = await parseJsonBody(res);
  const body = (parsed.ok && typeof parsed.value === "object" ? parsed.value : null) as {
    error?: unknown;
    message?: unknown;
  } | null;

  const message =
    typeof body?.message === "string" && body.message.length > 0 ? body.message : fallback;
  const errorCode =
    typeof body?.error === "string" && body.error.length > 0 ? body.error : undefined;

  return errorCode !== undefined ? { message, errorCode } : { message };
}

async function postBranchJson(
  url: string,
  payload: BranchIllustrationRequest,
  signal?: AbortSignal
): Promise<{ ok: true; response: Response } | { ok: false; message: string }> {
  try {
    const response = await globalThis.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Network error submitting Scenario Branch",
    };
  }
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

  const postResult = await postBranchJson(
    buildScenarioBranchUrl(options.apiBaseUrl),
    payload,
    options.signal
  );
  if (!postResult.ok) {
    return postResult;
  }

  if (!postResult.response.ok) {
    const envelope = await readErrorEnvelope(
      postResult.response,
      `Scenario Branch HTTP ${postResult.response.status}`
    );
    return { ok: false, statusCode: postResult.response.status, ...envelope };
  }

  const rawBody = await parseJsonBody(postResult.response);
  const parsed = rawBody.ok ? BranchIllustrationResponseSchema.safeParse(rawBody.value) : null;
  if (!parsed?.success) {
    return { ok: false, message: "Malformed Scenario Branch payload" };
  }

  return { ok: true, branch: parsed.data };
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { BranchIllustrationRequestSchema } from "../interfaces/index.ts";
import { branchIllustration } from "../use-cases/branch-illustration.ts";
import {
  getFrameTimeline,
  getGeneratedIllustrationAsset,
} from "../use-cases/get-frame-timeline.ts";
import type { GridlockHttpDeps } from "./http-server.ts";
import {
  parseQueryOrSendBadRequest,
  readJsonObjectBody,
  sendJson,
  sendMethodNotAllowed,
  sendWebp,
} from "./http-utils.ts";

const ASSET_PREFIX = "/api/illustrations/assets/";

const EmptyQueryParamsSchema = z.object({}).strict();

const TimelineQueryParamsSchema = z
  .object({
    timeline_id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^(?!\.\.?$)[^\s/]+$/)
      .optional(),
  })
  .strict();

export function matchIllustrationAssetId(pathname: string): string | null {
  if (!pathname.startsWith(ASSET_PREFIX)) {
    return null;
  }
  const file = pathname.slice(ASSET_PREFIX.length);
  if (!file.endsWith(".webp") || file.includes("/")) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(file.slice(0, -5));
    return decoded.length > 0 &&
      decoded !== "." &&
      decoded !== ".." &&
      !/[\s/]/.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export async function handleGetFrameTimeline(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET", "Only GET is supported on /api/illustrations/timeline");
    return;
  }

  const query = parseQueryOrSendBadRequest(
    res,
    parsedUrl.searchParams,
    TimelineQueryParamsSchema
  );
  if (!query) return;

  const { timeline_id } = query;
  const result = await getFrameTimeline(
    {
      ...(timeline_id !== undefined ? { timelineId: timeline_id } : {}),
      ...(deps.now ? { now: deps.now() } : {}),
    },
    { repository: deps.repository }
  );
  if (!result.ok) {
    sendJson(res, 500, { error: result.error, message: result.message });
    return;
  }

  sendJson(res, 200, result.timeline);
}

export async function handleGetIllustrationAsset(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  illustrationId: string,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET", `Only GET is supported on ${parsedUrl.pathname}`);
    return;
  }

  if (!parseQueryOrSendBadRequest(res, parsedUrl.searchParams, EmptyQueryParamsSchema)) {
    return;
  }

  const result = await getGeneratedIllustrationAsset(
    {
      illustrationId,
      ...(deps.now ? { now: deps.now() } : {}),
    },
    { repository: deps.repository }
  );
  if (!result.ok) {
    const statusCode = result.error === "illustration_not_found" ? 404 : 500;
    sendJson(res, statusCode, { error: result.error, message: result.message });
    return;
  }

  sendWebp(res, result.webpBuffer, { immutable: !result.plate.isBranch });
}

export async function handlePostIllustrationBranch(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST", "Only POST is supported on /api/illustrations/branch");
    return;
  }

  if (!parseQueryOrSendBadRequest(res, parsedUrl.searchParams, EmptyQueryParamsSchema)) {
    return;
  }

  const bodyResult = await readJsonObjectBody(req, res);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.error, message: bodyResult.message });
    return;
  }

  const parsedBody = BranchIllustrationRequestSchema.safeParse(bodyResult.value);
  if (!parsedBody.success) {
    const message = parsedBody.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    sendJson(res, 400, {
      error: "invalid_request_body",
      message,
      issues: parsedBody.error.issues,
    });
    return;
  }

  const outcome = await branchIllustration(parsedBody.data, deps);
  sendJson(
    res,
    outcome.status,
    outcome.ok
      ? outcome.response
      : { error: outcome.error, message: outcome.message }
  );
}

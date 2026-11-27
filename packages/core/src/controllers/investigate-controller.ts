import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  InvestigatePlanRequestSchema,
  MAX_INVESTIGATE_BODY_BYTES,
} from "../interfaces/index.ts";
import { runUiOrchestrationAgent } from "../use-cases/run-ui-orchestration-agent.ts";
import type { GridlockHttpDeps } from "./http-server.ts";
import {
  parseQueryOrSendBadRequest,
  readJsonObjectBody,
  sendJson,
  sendMethodNotAllowed,
} from "./http-utils.ts";

const EmptyQueryParamsSchema = z.object({}).strict();

export async function handlePostInvestigatePlan(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "POST") {
    sendMethodNotAllowed(
      res,
      "POST",
      "Only POST is supported on /api/investigate/plan"
    );
    return;
  }

  if (!parseQueryOrSendBadRequest(res, parsedUrl.searchParams, EmptyQueryParamsSchema)) {
    return;
  }

  const bodyResult = await readJsonObjectBody(
    req,
    res,
    MAX_INVESTIGATE_BODY_BYTES
  );
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.error, message: bodyResult.message });
    return;
  }

  const parsedBody = InvestigatePlanRequestSchema.safeParse(bodyResult.value);
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

  const outcome = await runUiOrchestrationAgent(
    {
      ...parsedBody.data,
      ...(deps.now ? { now: deps.now() } : {}),
    },
    {
      repository: deps.repository,
      ...(deps.geminiClient !== undefined
        ? { geminiClient: deps.geminiClient }
        : {}),
      ...(deps.spanSink !== undefined ? { spanSink: deps.spanSink } : {}),
    }
  );
  sendJson(
    res,
    outcome.status,
    outcome.ok
      ? outcome.response
      : { error: outcome.error, message: outcome.message }
  );
}

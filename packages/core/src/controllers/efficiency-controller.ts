import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ExecutionModeSchema,
  PositiveIntegerStringSchema,
  type GridlockRepository,
} from "../interfaces/index.ts";
import { getEfficiencyScorecard } from "../use-cases/get-efficiency-scorecard.ts";
import {
  parseQueryOrSendBadRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-utils.ts";

const EfficiencyQueryParamsSchema = z
  .object({
    limit: PositiveIntegerStringSchema.pipe(
      z.number().int().min(1).max(365)
    ).optional(),
    execution_mode: ExecutionModeSchema.optional(),
  })
  .strict();

export async function handleGetEfficiencyScorecard(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: {
    repository: GridlockRepository;
  }
): Promise<void> {
  if (req.method !== "GET") {
    sendMethodNotAllowed(
      res,
      "GET",
      "Only GET is supported on /api/efficiency/scorecard"
    );
    return;
  }

  const query = parseQueryOrSendBadRequest(
    res,
    parsedUrl.searchParams,
    EfficiencyQueryParamsSchema
  );
  if (!query) return;

  const result = await getEfficiencyScorecard(
    {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.execution_mode !== undefined
        ? { executionMode: query.execution_mode }
        : {}),
    },
    deps
  );

  if (!result.ok) {
    sendJson(res, 500, {
      error: result.error,
      message: result.message,
    });
    return;
  }

  sendJson(res, 200, result.scorecard);
}

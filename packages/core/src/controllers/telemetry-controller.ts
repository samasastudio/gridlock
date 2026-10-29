import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ExecutionModeSchema,
  PositiveIntegerStringSchema,
  type GridlockRepository,
} from "../interfaces/index.ts";
import { getEfficiencyScorecard } from "../use-cases/get-efficiency-scorecard.ts";
import { sendJson } from "./http-utils.ts";

export const EfficiencyQueryParamsSchema = z
  .object({
    limit: PositiveIntegerStringSchema.pipe(
      z.number().int().min(1).max(365)
    ).optional(),
    execution_mode: ExecutionModeSchema.optional(),
  })
  .strict();

export async function handleGetEfficiencyTelemetry(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: {
    repository: GridlockRepository;
  }
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, {
      error: "method_not_allowed",
      message: "Only GET is supported on /api/telemetry/efficiency",
    });
    return;
  }

  const rawQuery = Array.from(parsedUrl.searchParams.entries()).reduce<
    Record<string, string>
  >((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});

  const parsedQuery = EfficiencyQueryParamsSchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    sendJson(res, 400, {
      error: "invalid_query_parameters",
      message: parsedQuery.error.issues
        .map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`)
        .join("; "),
      issues: parsedQuery.error.issues,
    });
    return;
  }

  const result = await getEfficiencyScorecard(
    {
      ...(parsedQuery.data.limit !== undefined
        ? { limit: parsedQuery.data.limit }
        : {}),
      ...(parsedQuery.data.execution_mode !== undefined
        ? { executionMode: parsedQuery.data.execution_mode }
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

  sendJson(res, 200, result.ledger);
}

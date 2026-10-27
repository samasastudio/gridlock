import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  EfficiencyLedgerSchema,
  ExecutionModeSchema,
  PositiveIntegerStringSchema,
  type GridlockRepository,
} from "../interfaces/index.ts";
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

  const rawQuery: Record<string, string> = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    rawQuery[key] = value;
  }

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

  try {
    const ledgerCandidate = await deps.repository.getEfficiencyLedger({
      ...(parsedQuery.data.limit !== undefined
        ? { limit: parsedQuery.data.limit }
        : {}),
      ...(parsedQuery.data.execution_mode !== undefined
        ? { executionMode: parsedQuery.data.execution_mode }
        : {}),
    });
    const validatedLedger = EfficiencyLedgerSchema.safeParse(ledgerCandidate);
    if (!validatedLedger.success) {
      sendJson(res, 500, {
        error: "telemetry_ledger_error",
        message:
          "Stored EfficiencyLedger document failed runtime schema validation",
      });
      return;
    }

    sendJson(res, 200, validatedLedger.data);
  } catch (error) {
    sendJson(res, 500, {
      error: "telemetry_ledger_error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to read EfficiencyLedger telemetry",
    });
  }
}

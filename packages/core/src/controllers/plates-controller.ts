import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getPlateLineage } from "../use-cases/get-plate-lineage.ts";
import type { GridlockHttpDeps } from "./http-server.ts";
import {
  parseSingleValueSearchParams,
  sendJson,
  sendMethodNotAllowed,
} from "./http-utils.ts";

const LineageQueryParamsSchema = z
  .object({
    lineage_id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^(?!\.\.?$)[^\s/]+$/)
      .optional(),
  })
  .strict();

export async function handleGetPlateLineage(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET", "Only GET is supported on /api/plates/lineage");
    return;
  }

  const parsedQuery = parseSingleValueSearchParams(
    parsedUrl.searchParams,
    LineageQueryParamsSchema
  );
  if (!parsedQuery.ok) {
    sendJson(res, 400, {
      error: "invalid_query_parameters",
      message: parsedQuery.message,
      issues: parsedQuery.issues,
    });
    return;
  }

  const { lineage_id } = parsedQuery.data;
  const result = await getPlateLineage(
    {
      ...(lineage_id !== undefined ? { lineageId: lineage_id } : {}),
      ...(deps.now ? { now: deps.now() } : {}),
    },
    { repository: deps.repository }
  );
  if (!result.ok) {
    sendJson(res, 500, { error: result.error, message: result.message });
    return;
  }

  sendJson(res, 200, result.lineage);
}

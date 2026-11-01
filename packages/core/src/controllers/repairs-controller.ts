import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { PositiveIntegerStringSchema, type GridlockRepository } from "../interfaces/index.ts";
import { getRepairChangelog } from "../use-cases/get-repair-changelog.ts";
import { parseSingleValueSearchParams, sendJson, sendMarkdown } from "./http-utils.ts";

export const RepairChangelogQueryParamsSchema = z
  .object({
    connector_id: z.string().trim().min(1).max(64).optional(),
    limit: PositiveIntegerStringSchema.pipe(z.number().int().min(1).max(365)).optional(),
    format: z.enum(["json", "md"]).optional(),
  })
  .strict();

export async function handleGetRepairChangelog(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  deps: { repository: GridlockRepository }
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, {
      error: "method_not_allowed",
      message: "Only GET is supported on /api/repairs/changelog",
    });
    return;
  }

  const parsedQuery = parseSingleValueSearchParams(
    parsedUrl.searchParams,
    RepairChangelogQueryParamsSchema
  );
  
  if (!parsedQuery.ok) {
    sendJson(res, 400, {
      error: "invalid_query_parameters",
      message: parsedQuery.message,
      issues: parsedQuery.issues,
    });
    return;
  }

  const { connector_id, limit, format } = parsedQuery.data;
  const result = await getRepairChangelog(
    {
      ...(connector_id !== undefined ? { connectorId: connector_id } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(format !== undefined ? { format } : {}),
    },
    deps
  );

  if (!result.ok) {
    const statusCode = result.error === "connector_not_found" ? 404 : 500;
    sendJson(res, statusCode, { error: result.error, message: result.message });
    return;
  }

  if (result.format === "md") {
    sendMarkdown(res, 200, result.markdown);
    return;
  }
  sendJson(res, 200, result.changelog);
}

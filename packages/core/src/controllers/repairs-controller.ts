import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { PositiveIntegerStringSchema, type GridlockRepository } from "../interfaces/index.ts";
import { getRepairChangelog } from "../use-cases/get-repair-changelog.ts";
import {
  parseQueryOrSendBadRequest,
  sendJson,
  sendMarkdown,
  sendMethodNotAllowed,
} from "./http-utils.ts";

const RepairChangelogQueryParamsSchema = z
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
    sendMethodNotAllowed(res, "GET", "Only GET is supported on /api/repairs/changelog");
    return;
  }

  const query = parseQueryOrSendBadRequest(
    res,
    parsedUrl.searchParams,
    RepairChangelogQueryParamsSchema
  );
  if (!query) return;

  const { connector_id, limit, format } = query;
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

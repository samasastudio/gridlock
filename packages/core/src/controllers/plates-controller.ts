import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  getPlateLineage,
  getVisualPlateAsset,
} from "../use-cases/get-plate-lineage.ts";
import type { GridlockHttpDeps } from "./http-server.ts";
import {
  parseSingleValueSearchParams,
  sendJson,
  sendMethodNotAllowed,
  sendWebp,
} from "./http-utils.ts";

const ASSET_PREFIX = "/api/plates/assets/";

const EmptyQueryParamsSchema = z.object({}).strict();

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

export function matchPlateAssetId(pathname: string): string | null {
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

export async function handleGetPlateAsset(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
  plateId: string,
  deps: GridlockHttpDeps
): Promise<void> {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET", `Only GET is supported on ${parsedUrl.pathname}`);
    return;
  }

  const parsedQuery = parseSingleValueSearchParams(
    parsedUrl.searchParams,
    EmptyQueryParamsSchema
  );
  if (!parsedQuery.ok) {
    sendJson(res, 400, {
      error: "invalid_query_parameters",
      message: parsedQuery.message,
      issues: parsedQuery.issues,
    });
    return;
  }

  const result = await getVisualPlateAsset(
    {
      plateId,
      ...(deps.now ? { now: deps.now() } : {}),
    },
    { repository: deps.repository }
  );
  if (!result.ok) {
    const statusCode = result.error === "plate_not_found" ? 404 : 500;
    sendJson(res, statusCode, { error: result.error, message: result.message });
    return;
  }

  sendWebp(res, result.webpBuffer, { immutable: !result.plate.isBranch });
}

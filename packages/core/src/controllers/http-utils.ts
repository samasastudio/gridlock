import type { ServerResponse } from "node:http";
import type { z } from "zod";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendMarkdown(res: ServerResponse, statusCode: number, markdown: string): void {
  res.writeHead(statusCode, {
    "content-type": "text/markdown; charset=utf-8",
    ...CORS_HEADERS,
    "cache-control": "no-store",
  });
  res.end(markdown);
}

export type ParsedQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; issues: readonly z.ZodIssue[] };

export function parseSingleValueSearchParams<TSchema extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: TSchema
): ParsedQueryResult<z.output<TSchema>> {
  const duplicateKeys = Array.from(new Set(searchParams.keys())).filter(
    (key) => searchParams.getAll(key).length > 1
  );
  if (duplicateKeys.length > 0) {
    return {
      ok: false,
      message: duplicateKeys.map((key) => `${key}: Duplicate query parameter is not permitted`).join("; "),
      issues: [],
    };
  }
  const parsed = schema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "),
      issues: parsed.error.issues,
    };
  }
  return { ok: true, data: parsed.data };
}

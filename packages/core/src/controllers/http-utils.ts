import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
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

export function sendMethodNotAllowed(
  res: ServerResponse,
  allowedMethod: "GET" | "POST",
  message: string
): void {
  res.writeHead(405, {
    "content-type": "application/json; charset=utf-8",
    allow: allowedMethod,
    ...CORS_HEADERS,
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: "method_not_allowed", message }));
}

export function sendWebp(
  res: ServerResponse,
  webpBuffer: Buffer,
  options: { immutable: boolean }
): void {
  const cacheControl = options.immutable
    ? "public, max-age=31536000, immutable"
    : "no-store";
  res.writeHead(200, {
    "content-type": "image/webp",
    "content-length": String(webpBuffer.byteLength),
    ...CORS_HEADERS,
    "cache-control": cacheControl,
  });
  res.end(webpBuffer);
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

const MAX_JSON_BODY_BYTES = 16_384;

export type JsonObjectBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | {
      ok: false;
      error: "invalid_request_body" | "request_body_too_large";
      message: string;
    };

export function readJsonObjectBody(
  req: IncomingMessage,
  res?: ServerResponse
): Promise<JsonObjectBodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const state = { totalBytes: 0, tooLarge: false, settled: false };

    const tooLargeErr = (): JsonObjectBodyResult => ({
      ok: false,
      error: "request_body_too_large",
      message: `Request body exceeds ${MAX_JSON_BODY_BYTES}-byte limit`,
    });
    const bodyErr = (message: string): JsonObjectBodyResult => ({
      ok: false,
      error: "invalid_request_body",
      message,
    });
    const finish = (result: JsonObjectBodyResult): void => {
      if (!state.settled) {
        state.settled = true;
        resolve(result);
      }
    };

    req.on("data", (chunk: Buffer | string) => {
      if (state.tooLarge) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      state.totalBytes += buf.byteLength;
      if (state.totalBytes > MAX_JSON_BODY_BYTES) {
        state.tooLarge = true;
        chunks.length = 0;
        req.pause();
        res?.setHeader("connection", "close");
        const scheduleDestroy = (): void => {
          setTimeout(() => {
            if (!req.destroyed) {
              req.destroy();
            }
          }, 50).unref();
        };
        if (res && !res.writableFinished) {
          res.once("finish", scheduleDestroy);
        } else {
          scheduleDestroy();
        }
        finish(tooLargeErr());
        return;
      }
      chunks.push(buf);
    });

    req.on("error", () => {
      finish(state.tooLarge ? tooLargeErr() : bodyErr("Failed to read request body"));
    });

    req.on("close", () => {
      finish(state.tooLarge ? tooLargeErr() : bodyErr("Request stream closed prematurely"));
    });

    req.on("end", () => {
      if (state.tooLarge) {
        finish(tooLargeErr());
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (raw.length === 0) {
        finish(bodyErr("Request body must be a non-empty JSON object"));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          finish(bodyErr("Request body must be a JSON object"));
          return;
        }
        finish({ ok: true, value: parsed as Record<string, unknown> });
      } catch {
        finish(bodyErr("Malformed JSON in request body"));
      }
    });
  });
}

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { EfficiencyLedgerSchema, ExecutionModeSchema } from "./schemas.ts";
import type { GridlockRepository } from "./repository.ts";

const EfficiencyQueryParamsSchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "Expected positive integer for limit")
      .transform((val) => Number.parseInt(val, 10))
      .pipe(z.number().int().min(1).max(365))
      .optional(),
    execution_mode: ExecutionModeSchema.optional(),
  })
  .strict();

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  res.end(body);
}

export async function handleGridlockHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {
    repository: GridlockRepository;
  }
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url ?? "/", "http://localhost");
  } catch {
    sendJson(res, 400, {
      error: "invalid_request_url",
      message: "Malformed request URL",
    });
    return;
  }

  const pathname = parsedUrl.pathname;

  if (pathname === "/healthz") {
    if (req.method !== "GET") {
      sendJson(res, 405, {
        error: "method_not_allowed",
        message: "Only GET is supported on /healthz",
      });
      return;
    }
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/telemetry/efficiency") {
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
      return;
    } catch (error) {
      sendJson(res, 500, {
        error: "telemetry_ledger_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to read EfficiencyLedger telemetry",
      });
      return;
    }
  }

  sendJson(res, 404, {
    error: "not_found",
    message: `No route matching ${req.method ?? "GET"} ${pathname}`,
  });
}

export function createGridlockHttpServer(deps: {
  repository: GridlockRepository;
}): Server {
  return createServer((req, res) => {
    void handleGridlockHttpRequest(req, res, deps).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: "internal_server_error",
          message:
            error instanceof Error ? error.message : "Unexpected server error",
        });
      } else {
        res.end();
      }
    });
  });
}

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { GridlockRepository } from "../interfaces/index.ts";
import { CORS_HEADERS, sendJson } from "./http-utils.ts";
import { handleGetRepairChangelog } from "./repairs-controller.ts";
import { handleGetEfficiencyTelemetry } from "./telemetry-controller.ts";

function tryParseRequestUrl(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

export async function handleGridlockHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {
    repository: GridlockRepository;
  }
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const parsedUrl = tryParseRequestUrl(req.url);
  if (!parsedUrl) {
    sendJson(res, 400, {
      error: "invalid_request_url",
      message: "Malformed request URL",
    });
    return;
  }

  const { pathname } = parsedUrl;

  if (pathname === "/api/telemetry/efficiency") {
    await handleGetEfficiencyTelemetry(req, res, parsedUrl, deps);
    return;
  }

  if (pathname === "/api/repairs/changelog") {
    await handleGetRepairChangelog(req, res, parsedUrl, deps);
    return;
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

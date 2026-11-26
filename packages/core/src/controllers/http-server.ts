import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  GeminiInteractionsClient,
  GridlockRepository,
  PainterImageEncoder,
  RunSpanSink,
} from "../interfaces/index.ts";
import { CORS_HEADERS, sendJson } from "./http-utils.ts";
import { handlePostInvestigatePlan } from "./investigate-controller.ts";
import {
  handleGetFrameTimeline,
  handleGetIllustrationAsset,
  handlePostIllustrationBranch,
  matchIllustrationAssetId,
} from "./illustrations-controller.ts";
import { handleGetRepairChangelog } from "./repairs-controller.ts";
import { handleGetEfficiencyScorecard } from "./efficiency-controller.ts";

export type GridlockHttpDeps = {
  repository: GridlockRepository;
  geminiClient?: GeminiInteractionsClient;
  imageEncoder?: PainterImageEncoder;
  spanSink?: RunSpanSink;
  maxBranchesPerLineage?: number;
  now?: () => Date;
};

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
  deps: GridlockHttpDeps
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

  if (pathname === "/api/efficiency/scorecard") {
    await handleGetEfficiencyScorecard(req, res, parsedUrl, deps);
    return;
  }

  if (pathname === "/api/repairs/changelog") {
    await handleGetRepairChangelog(req, res, parsedUrl, deps);
    return;
  }

  if (pathname === "/api/illustrations/timeline") {
    await handleGetFrameTimeline(req, res, parsedUrl, deps);
    return;
  }

  if (pathname === "/api/illustrations/branch") {
    await handlePostIllustrationBranch(req, res, parsedUrl, deps);
    return;
  }

  if (pathname === "/api/investigate/plan") {
    await handlePostInvestigatePlan(req, res, parsedUrl, deps);
    return;
  }

  const assetPlateId = matchIllustrationAssetId(pathname);
  if (assetPlateId !== null) {
    await handleGetIllustrationAsset(req, res, parsedUrl, assetPlateId, deps);
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    message: `No route matching ${req.method ?? "GET"} ${pathname}`,
  });
}

export function createGridlockHttpServer(deps: GridlockHttpDeps): Server {
  return createServer((req, res) => {
    void handleGridlockHttpRequest(req, res, deps).catch((error: unknown) => {
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

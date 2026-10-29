import type {
  GridlockRepository,
  PageLoader,
  SiteAccessCheckResult,
} from "../interfaces/index.ts";
import { verifySiteAccess } from "./helpers/site-access.ts";

export async function markBlockedByWaf(
  repository: GridlockRepository,
  connectorId: string,
  nowIso: string,
  access: Extract<SiteAccessCheckResult, { allowed: false }>
): Promise<{
  status: "blocked_by_waf";
  reason: string;
  retryAfterSeconds?: number;
  tokensUsed: 0;
}> {
  await repository.setConnectorStatus(connectorId, "blocked_by_waf", nowIso);
  return {
    status: "blocked_by_waf",
    reason: access.reason,
    ...(access.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: access.retryAfterSeconds }
      : {}),
    tokensUsed: 0,
  };
}

async function resolveRobotsTxtContent(params: {
  baseUrl: string;
  providedRobotsTxt?: string;
  pageLoader: PageLoader;
  now: Date;
}): Promise<
  | { allowed: true; robotsTxt: string }
  | { allowed: false; access: Extract<SiteAccessCheckResult, { allowed: false }> }
> {
  if (params.providedRobotsTxt !== undefined) {
    return { allowed: true, robotsTxt: params.providedRobotsTxt };
  }
  try {
    const robotsRes = await params.pageLoader(`${params.baseUrl}/robots.txt`);
    const robotsAccess = verifySiteAccess({
      status: robotsRes.status === 404 ? 200 : robotsRes.status,
      headers: robotsRes.headers,
      body: robotsRes.status === 404 ? "" : robotsRes.body,
      now: params.now,
    });
    if (!robotsAccess.allowed) return { allowed: false, access: robotsAccess };
    return {
      allowed: true,
      robotsTxt: robotsRes.status === 200 ? robotsRes.body : "",
    };
  } catch {
    return { allowed: true, robotsTxt: "" };
  }
}

export async function preflightRobotsTxt(params: {
  baseUrl: string;
  targetPath: string;
  providedRobotsTxt?: string;
  pageLoader: PageLoader;
  now: Date;
}): Promise<
  | { allowed: true; robotsTxt: string }
  | { allowed: false; access: Extract<SiteAccessCheckResult, { allowed: false }> }
> {
  const resolved = await resolveRobotsTxtContent(params);
  if (!resolved.allowed) return resolved;

  const pathCheck = verifySiteAccess({
    status: 200,
    body: "",
    robotsTxt: resolved.robotsTxt,
    targetPath: params.targetPath,
    now: params.now,
  });
  return pathCheck.allowed
    ? { allowed: true, robotsTxt: resolved.robotsTxt }
    : { allowed: false, access: pathCheck };
}

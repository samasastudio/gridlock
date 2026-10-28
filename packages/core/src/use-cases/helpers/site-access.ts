import {
  GRIDLOCK_USER_AGENT,
  type GridlockRepository,
  type PageLoader,
  type SiteAccessCheckResult,
  type SiteAccessInput,
} from "../../interfaces/index.ts";

function getHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  return Object.entries(headers).find(
    ([key, value]) => key.toLowerCase() === target && value !== undefined
  )?.[1];
}

function parseRetryAfterSeconds(raw: string | undefined, now?: Date): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  const baseMs = now ? now.getTime() : Date.now();
  return Math.max(0, Math.ceil((dateMs - baseMs) / 1000));
}

function getLongestMatchingPrefixLength(normalizedPath: string, prefixes: readonly string[]): number {
  return prefixes
    .filter((prefix) => normalizedPath.startsWith(prefix))
    .reduce((maxLen, prefix) => Math.max(maxLen, prefix.length), -1);
}

function evaluateRulePrefixes(normalizedPath: string, disallowPrefixes: readonly string[], allowPrefixes: readonly string[]): boolean {
  const longestDisallow = getLongestMatchingPrefixLength(normalizedPath, disallowPrefixes);
  if (longestDisallow === -1) return true;
  const longestAllow = getLongestMatchingPrefixLength(normalizedPath, allowPrefixes);
  return longestAllow >= longestDisallow;
}

interface RobotsParseAccumulator {
  currentAgents: string[];
  seenRuleInGroup: boolean;
  matchedSpecificGroup: boolean;
  specificDisallow: string[];
  specificAllow: string[];
  wildcardDisallow: string[];
  wildcardAllow: string[];
}

function parseRobotsDirective(rawLine: string): { directive: string; value: string } | null {
  const line = rawLine.replace(/#.*$/, "").trim();
  if (!line) return { directive: "blank", value: "" };
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    directive: line.slice(0, colonIdx).trim().toLowerCase(),
    value: line.slice(colonIdx + 1).trim(),
  };
}

function doesAgentTokenMatchBot(agentToken: string, uaLower: string, botProductToken: string): boolean {
  return agentToken !== "*" && (uaLower.includes(agentToken) || botProductToken.includes(agentToken));
}

function applyRobotsLine(state: RobotsParseAccumulator, rawLine: string, uaLower: string, botProductToken: string): RobotsParseAccumulator {
  const parsed = parseRobotsDirective(rawLine);
  if (!parsed) return state;

  if (parsed.directive === "blank") {
    state.currentAgents = [];
    state.seenRuleInGroup = false;
    return state;
  }

  if (parsed.directive === "user-agent") {
    if (state.seenRuleInGroup) {
      state.currentAgents = [];
      state.seenRuleInGroup = false;
    }
    const agentToken = parsed.value.toLowerCase();
    state.currentAgents.push(agentToken);
    if (doesAgentTokenMatchBot(agentToken, uaLower, botProductToken)) {
      state.matchedSpecificGroup = true;
    }
    return state;
  }

  if (
    (parsed.directive !== "disallow" && parsed.directive !== "allow") ||
    parsed.value.length === 0
  ) {
    return state;
  }

  state.seenRuleInGroup = true;
  const isSpecific = state.currentAgents.some((ua) =>
    doesAgentTokenMatchBot(ua, uaLower, botProductToken)
  );
  const isWildcard = state.currentAgents.includes("*");

  if (parsed.directive === "disallow") {
    if (isSpecific) state.specificDisallow.push(parsed.value);
    if (isWildcard) state.wildcardDisallow.push(parsed.value);
    return state;
  }

  if (isSpecific) state.specificAllow.push(parsed.value);
  if (isWildcard) state.wildcardAllow.push(parsed.value);
  return state;
}

export function isPathAllowedByRobotsTxt(
  robotsTxt: string,
  targetPath: string,
  userAgent: string = GRIDLOCK_USER_AGENT
): boolean {
  const uaLower = userAgent.toLowerCase();
  const botProductToken = (uaLower.split("/")[0] ?? "gridlockcivicresearchbot").trim();

  const parsedGroups = robotsTxt.split(/\r?\n/).reduce<RobotsParseAccumulator>(
    (acc, rawLine) => applyRobotsLine(acc, rawLine, uaLower, botProductToken),
    {
      currentAgents: [],
      seenRuleInGroup: false,
      matchedSpecificGroup: false,
      specificDisallow: [],
      specificAllow: [],
      wildcardDisallow: [],
      wildcardAllow: [],
    }
  );

  const normalizedPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  return parsedGroups.matchedSpecificGroup
    ? evaluateRulePrefixes(normalizedPath, parsedGroups.specificDisallow, parsedGroups.specificAllow)
    : evaluateRulePrefixes(normalizedPath, parsedGroups.wildcardDisallow, parsedGroups.wildcardAllow);
}

const WAF_BODY_SIGNATURES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /_Incapsula_Resource/i, label: "Imperva Incapsula (_Incapsula_Resource)" },
  { pattern: /cf-mitigated/i, label: "Cloudflare mitigation (cf-mitigated)" },
  { pattern: /challenge-platform/i, label: "Cloudflare challenge-platform" },
  { pattern: /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i, label: "Cloudflare Turnstile challenge" },
  { pattern: /g-recaptcha/i, label: "Google reCAPTCHA challenge (g-recaptcha)" },
  { pattern: /<title>\s*TDLR TABS\s*-\s*Under Maintenance\s*<\/title>/i, label: "TDLR TABS Maintenance Window" },
];

export function verifySiteAccess(input: SiteAccessInput): SiteAccessCheckResult {
  const retryAfterHeader = getHeaderCaseInsensitive(input.headers, "retry-after");
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader, input.now);
  const retryAfterProp = retryAfterSeconds !== undefined ? { retryAfterSeconds } : {};

  if (
    input.robotsTxt &&
    input.targetPath &&
    !isPathAllowedByRobotsTxt(input.robotsTxt, input.targetPath, input.userAgent)
  ) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Disallowed by robots.txt for path ${input.targetPath}`,
      ...retryAfterProp,
      tokensUsed: 0,
    };
  }

  if (input.status === 403 || input.status === 429 || input.status === 503) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Portal returned HTTP ${input.status} access/rate-limit status`,
      ...retryAfterProp,
      tokensUsed: 0,
    };
  }

  if (retryAfterHeader !== undefined) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Portal returned Retry-After rate-limit directive (${retryAfterHeader})`,
      ...retryAfterProp,
      tokensUsed: 0,
    };
  }

  const cfMitigated = getHeaderCaseInsensitive(input.headers, "cf-mitigated");
  if (cfMitigated) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Blocked by Cloudflare cf-mitigated header (${cfMitigated})`,
      tokensUsed: 0,
    };
  }

  const matchedSignature = WAF_BODY_SIGNATURES.find((sig) => sig.pattern.test(input.body));
  if (matchedSignature) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `WAF/CAPTCHA challenge detected: ${matchedSignature.label}`,
      tokensUsed: 0,
    };
  }

  return { allowed: true, status: "ok", tokensUsed: 0 };
}

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
    ...(access.retryAfterSeconds !== undefined ? { retryAfterSeconds: access.retryAfterSeconds } : {}),
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
    return { allowed: true, robotsTxt: robotsRes.status === 200 ? robotsRes.body : "" };
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

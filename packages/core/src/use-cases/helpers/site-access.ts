import {
  GRIDLOCK_USER_AGENT,
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

function evaluateRulePrefixes(
  normalizedPath: string,
  disallowPrefixes: readonly string[],
  allowPrefixes: readonly string[]
): boolean {
  const longestDisallow = getLongestMatchingPrefixLength(normalizedPath, disallowPrefixes);
  if (longestDisallow === -1) return true;
  const longestAllow = getLongestMatchingPrefixLength(normalizedPath, allowPrefixes);
  return longestAllow >= longestDisallow;
}

interface RobotsParseAccumulator {
  readonly currentAgents: readonly string[];
  readonly seenRuleInGroup: boolean;
  readonly matchedSpecificGroup: boolean;
  readonly specificDisallow: readonly string[];
  readonly specificAllow: readonly string[];
  readonly wildcardDisallow: readonly string[];
  readonly wildcardAllow: readonly string[];
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

function applyRobotsLine(
  state: RobotsParseAccumulator,
  rawLine: string,
  uaLower: string,
  botProductToken: string
): RobotsParseAccumulator {
  const parsed = parseRobotsDirective(rawLine);
  if (!parsed) return state;

  if (parsed.directive === "blank") {
    return {
      ...state,
      currentAgents: [],
      seenRuleInGroup: false,
    };
  }

  if (parsed.directive === "user-agent") {
    const baseAgents = state.seenRuleInGroup ? [] : state.currentAgents;
    const agentToken = parsed.value.toLowerCase();
    return {
      ...state,
      currentAgents: [...baseAgents, agentToken],
      seenRuleInGroup: false,
      matchedSpecificGroup:
        state.matchedSpecificGroup ||
        doesAgentTokenMatchBot(agentToken, uaLower, botProductToken),
    };
  }

  if (
    (parsed.directive !== "disallow" && parsed.directive !== "allow") ||
    parsed.value.length === 0
  ) {
    return state;
  }

  const isSpecific = state.currentAgents.some((ua) =>
    doesAgentTokenMatchBot(ua, uaLower, botProductToken)
  );
  const isWildcard = state.currentAgents.includes("*");

  if (parsed.directive === "disallow") {
    return {
      ...state,
      seenRuleInGroup: true,
      specificDisallow: isSpecific
        ? [...state.specificDisallow, parsed.value]
        : state.specificDisallow,
      wildcardDisallow: isWildcard
        ? [...state.wildcardDisallow, parsed.value]
        : state.wildcardDisallow,
    };
  }

  return {
    ...state,
    seenRuleInGroup: true,
    specificAllow: isSpecific
      ? [...state.specificAllow, parsed.value]
      : state.specificAllow,
    wildcardAllow: isWildcard
      ? [...state.wildcardAllow, parsed.value]
      : state.wildcardAllow,
  };
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

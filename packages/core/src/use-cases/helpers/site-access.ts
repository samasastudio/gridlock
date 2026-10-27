import {
  GRIDLOCK_USER_AGENT,
  type SiteAccessCheckResult,
  type SiteAccessInput,
} from "../../interfaces/index.ts";

export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function parseRetryAfterSeconds(
  raw: string | undefined,
  now?: Date
): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const baseMs = now ? now.getTime() : Date.now();
    return Math.max(0, Math.ceil((dateMs - baseMs) / 1000));
  }
  return undefined;
}

function evaluateRulePrefixes(
  normalizedPath: string,
  disallowPrefixes: string[],
  allowPrefixes: string[]
): boolean {
  let longestDisallow = -1;
  for (const prefix of disallowPrefixes) {
    if (normalizedPath.startsWith(prefix) && prefix.length > longestDisallow) {
      longestDisallow = prefix.length;
    }
  }
  if (longestDisallow === -1) {
    return true;
  }

  let longestAllow = -1;
  for (const prefix of allowPrefixes) {
    if (normalizedPath.startsWith(prefix) && prefix.length > longestAllow) {
      longestAllow = prefix.length;
    }
  }

  return longestAllow >= longestDisallow;
}

export function isPathAllowedByRobotsTxt(
  robotsTxt: string,
  targetPath: string,
  userAgent: string = GRIDLOCK_USER_AGENT
): boolean {
  const uaLower = userAgent.toLowerCase();
  const botProductToken = (
    uaLower.split("/")[0] ?? "gridlockcivicresearchbot"
  ).trim();
  const lines = robotsTxt.split(/\r?\n/);

  let currentAgents: string[] = [];
  let seenRuleInGroup = false;

  let matchedSpecificGroup = false;
  const specificDisallow: string[] = [];
  const specificAllow: string[] = [];
  const wildcardDisallow: string[] = [];
  const wildcardAllow: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      currentAgents = [];
      seenRuleInGroup = false;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (seenRuleInGroup) {
        currentAgents = [];
        seenRuleInGroup = false;
      }
      const agentToken = value.toLowerCase();
      currentAgents.push(agentToken);
      if (
        agentToken !== "*" &&
        (uaLower.includes(agentToken) || botProductToken.includes(agentToken))
      ) {
        matchedSpecificGroup = true;
      }
      continue;
    }

    const isSpecific = currentAgents.some(
      (ua) =>
        ua !== "*" && (uaLower.includes(ua) || botProductToken.includes(ua))
    );
    const isWildcard = currentAgents.includes("*");

    if (directive === "disallow") {
      seenRuleInGroup = true;
      if (value.length > 0) {
        if (isSpecific) specificDisallow.push(value);
        if (isWildcard) wildcardDisallow.push(value);
      }
    } else if (directive === "allow") {
      seenRuleInGroup = true;
      if (value.length > 0) {
        if (isSpecific) specificAllow.push(value);
        if (isWildcard) wildcardAllow.push(value);
      }
    }
  }

  const normalizedPath = targetPath.startsWith("/")
    ? targetPath
    : `/${targetPath}`;

  // RFC 9309 §2.2.1: Specific user-agent groups take precedence over wildcard (*)
  if (matchedSpecificGroup) {
    return evaluateRulePrefixes(normalizedPath, specificDisallow, specificAllow);
  }

  return evaluateRulePrefixes(normalizedPath, wildcardDisallow, wildcardAllow);
}

const WAF_BODY_SIGNATURES: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /_Incapsula_Resource/i,
    label: "Imperva Incapsula (_Incapsula_Resource)",
  },
  { pattern: /cf-mitigated/i, label: "Cloudflare mitigation (cf-mitigated)" },
  { pattern: /challenge-platform/i, label: "Cloudflare challenge-platform" },
  {
    pattern: /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i,
    label: "Cloudflare Turnstile challenge",
  },
  { pattern: /g-recaptcha/i, label: "Google reCAPTCHA challenge (g-recaptcha)" },
  {
    pattern: /<title>\s*TDLR TABS\s*-\s*Under Maintenance\s*<\/title>/i,
    label: "TDLR TABS Maintenance Window",
  },
];

export function verifySiteAccess(input: SiteAccessInput): SiteAccessCheckResult {
  const retryAfterHeader = getHeaderCaseInsensitive(
    input.headers,
    "retry-after"
  );
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader, input.now);

  if (
    input.robotsTxt &&
    input.targetPath &&
    !isPathAllowedByRobotsTxt(input.robotsTxt, input.targetPath, input.userAgent)
  ) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Disallowed by robots.txt for path ${input.targetPath}`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      tokensUsed: 0,
    };
  }

  if (input.status === 403 || input.status === 429 || input.status === 503) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Portal returned HTTP ${input.status} access/rate-limit status`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      tokensUsed: 0,
    };
  }

  if (retryAfterHeader !== undefined) {
    return {
      allowed: false,
      status: "blocked_by_waf",
      reason: `Portal returned Retry-After rate-limit directive (${retryAfterHeader})`,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
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

  for (const sig of WAF_BODY_SIGNATURES) {
    if (sig.pattern.test(input.body)) {
      return {
        allowed: false,
        status: "blocked_by_waf",
        reason: `WAF/CAPTCHA challenge detected: ${sig.label}`,
        tokensUsed: 0,
      };
    }
  }

  return {
    allowed: true,
    status: "ok",
    tokensUsed: 0,
  };
}

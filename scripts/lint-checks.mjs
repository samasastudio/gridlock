import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const BANNED_GLOSSARY_TERMS = [
  { pattern: /\bCompute Atlas\b/i, useInstead: "Gridlock" },
  { pattern: /\braw payload\b/i, useInstead: "Source Artifact" },
  { pattern: /\bcached page\b/i, useInstead: "Source Artifact" },
  { pattern: /\bscrape dump\b/i, useInstead: "Source Artifact" },
  { pattern: /\bLLM scraper\b/i, useInstead: "Connector" },
  { pattern: /\blive LLM parser\b/i, useInstead: "Repair Agent" },
  { pattern: /\bauto-committer\b/i, useInstead: "Repair Agent" },
  { pattern: /\bslippy map tile\b/i, useInstead: "Visual Plate" },
];

export const MAX_TSX_LINES = 220;
export const MAX_CORE_TS_LINES = 300;
const MAX_PR_CHANGED_LINES = 700;
export const ALLOWED_CORE_TOP_DIRS = new Set([
  "interfaces",
  "use-cases",
  "adapters",
  "controllers",
]);

const LEGACY_BARREL_HELPER_EXPORTS = new Set([
  "sanitizeLocationAddressPii",
  "sanitizeTextPii",
  "evaluateSandboxReplayGate",
  "isPathAllowedByRobotsTxt",
  "verifySiteAccess",
  "isComputeInfrastructureFiling",
  "parseTdlrCliArgs",
  "parseTdlrFilingHtml",
  "applyConnectorPromotion",
  "applyHealAmortization",
  "calculateEstimatedCostSavedUsd",
  "calculateNaiveTokensAvoided",
  "createCorridorBaseCanvasWebp",
  "isWebpBuffer",
]);

function stripCommentsAndStrings(line) {
  return line
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/, "");
}

function extractImportSpecifiers(content) {
  const specifiers = [];
  const staticImportRegex =
    /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const regex of [staticImportRegex, dynamicImportRegex]) {
    for (const match of content.matchAll(regex)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
}

function evaluateBarrelHelperReExports(relPath, content) {
  const violations = [];
  const scrubbedContent = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'])\/\/.*$/, "$1"))
    .join("\n");

  for (const spec of extractImportSpecifiers(scrubbedContent)) {
    if (!spec.startsWith(".")) continue;
    const normalized = posix.normalize(spec);
    if (!normalized.startsWith("use-cases/helpers/")) continue;
    if (!spec.startsWith("./use-cases/helpers/")) {
      violations.push(
        `${relPath}: Clean Architecture violation — non-canonical helper specifier "${spec}" is prohibited in root barrel (CODING_STANDARDS.md)`
      );
    }
  }

  const forbiddenHelperImportOrWildcardRegex =
    /(?:^|[;\n])\s*(?:import\b[^;]*?from\s+["'][^"']*use-cases\/helpers\/[^"']+["']|import\s*\(\s*["'][^"']*use-cases\/helpers\/[^"']+["']\s*\)|export\s+\*(?:\s+as\s+\w+)?\s+from\s+["'][^"']*use-cases\/helpers\/[^"']+["'])/g;
  for (const match of scrubbedContent.matchAll(forbiddenHelperImportOrWildcardRegex)) {
    violations.push(
      `${relPath}: Clean Architecture violation — importing or wildcard re-exporting internal use-cases/helpers/ ("${match[0].trim()}") is prohibited in root barrel (CODING_STANDARDS.md)`
    );
  }

  const namedExportRegex =
    /(?:^|[;\n])\s*export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']\.\/use-cases\/helpers\/[^"']+["']/g;
  for (const match of scrubbedContent.matchAll(namedExportRegex)) {
    const rawList = match[1] ?? "";
    for (const rawItem of rawList.split(",")) {
      const cleaned = rawItem.replace(/^\s*type\s+/, "").trim();
      if (!cleaned) continue;
      if (/\s+as\s+/.test(cleaned) || !LEGACY_BARREL_HELPER_EXPORTS.has(cleaned)) {
        violations.push(
          `${relPath}: Clean Architecture violation — do not export internal use-cases/helpers/ symbol "${cleaned}" at the root barrel seam; expose a caller-facing use-cases/ entrypoint instead (CODING_STANDARDS.md)`
        );
      }
    }
  }
  return violations;
}

function classifyCoreLayer(normalizedSubPath) {
  if (normalizedSubPath === "index.ts" || normalizedSubPath === "index.js") {
    return "root-barrel";
  }
  if (normalizedSubPath.startsWith("use-cases/helpers/")) {
    return "use-cases/helpers";
  }
  const topSegment = normalizedSubPath.split("/")[0] ?? "";
  if (ALLOWED_CORE_TOP_DIRS.has(topSegment)) {
    return topSegment;
  }
  return "outside";
}

export function evaluateSourceFileLintRules(relPathRaw, content) {
  const relPath = relPathRaw.replace(/\\/g, "/");
  const lines = content.split("\n");
  const violations = [];

  if (relPath.endsWith(".tsx") && lines.length > MAX_TSX_LINES) {
    violations.push(
      `${relPath}: ${lines.length} lines exceeds ${MAX_TSX_LINES}-line component budget (CODING_STANDARDS.md)`
    );
  }

  if (/^packages\/[^/]+\/test\/.+\.(?:ts|tsx)$/.test(relPath)) {
    for (const spec of extractImportSpecifiers(content)) {
      if (/^@samasastudio\/gridlock-[^/]+\/.+/.test(spec)) {
        violations.push(
          `${relPath}: Seam testing violation — tests must import through the public package barrel, not subpath "${spec}" (CODING_STANDARDS.md)`
        );
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(relPath), spec));
      if (
        /^packages\/[^/]+\/src\//.test(resolved) &&
        !/^packages\/[^/]+\/src\/index\.(?:ts|js)$/.test(resolved)
      ) {
        violations.push(
          `${relPath}: Seam testing violation — tests must import through the public package barrel ("src/index.ts"), not internal module "${spec}" (CODING_STANDARDS.md)`
        );
      }
    }
  }

  if (relPath.startsWith("packages/core/src/") && relPath.endsWith(".ts")) {
    if (lines.length > MAX_CORE_TS_LINES) {
      violations.push(
        `${relPath}: ${lines.length} lines exceeds ${MAX_CORE_TS_LINES}-line core module budget (CODING_STANDARDS.md)`
      );
    }

    if (relPath === "packages/core/src/index.ts") {
      violations.push(...evaluateBarrelHelperReExports(relPath, content));
    } else {
      const subPath = relPath.slice("packages/core/src/".length);
      const segments = subPath.split("/");
      const topDir = segments[0] ?? "";
      if (segments.length < 2 || !ALLOWED_CORE_TOP_DIRS.has(topDir)) {
        violations.push(
          `${relPath}: Must reside inside interfaces/, use-cases/, adapters/, or controllers/ (ADR-0004)`
        );
      }

      const sourceLayer = classifyCoreLayer(subPath);
      const specifiers = extractImportSpecifiers(content);
      for (const spec of specifiers) {
        if (!spec.startsWith(".")) continue;
        const resolvedSubPath = posix.normalize(
          posix.join(posix.dirname(subPath), spec)
        );
        const targetLayer = classifyCoreLayer(resolvedSubPath);

        if (targetLayer === "root-barrel" || resolvedSubPath.startsWith("..")) {
          violations.push(
            `${relPath}: Clean Architecture violation — internal modules must not import the root barrel or outside packages/core/src ("${spec}") (ADR-0004)`
          );
        } else if (sourceLayer === "interfaces" && targetLayer !== "interfaces") {
          violations.push(
            `${relPath}: Clean Architecture violation — interfaces/ must not import from "${spec}" (ADR-0004)`
          );
        } else if (
          sourceLayer === "use-cases/helpers" &&
          targetLayer !== "use-cases/helpers" &&
          targetLayer !== "interfaces"
        ) {
          violations.push(
            `${relPath}: Clean Architecture violation — use-cases/helpers/ must remain pure and not import from "${spec}" (ADR-0004)`
          );
        } else if (
          sourceLayer === "use-cases" &&
          targetLayer !== "use-cases" &&
          targetLayer !== "use-cases/helpers" &&
          targetLayer !== "interfaces"
        ) {
          violations.push(
            `${relPath}: Clean Architecture violation — use-cases/ must not import from outer ${targetLayer}/ ("${spec}") (ADR-0004)`
          );
        } else if (
          sourceLayer === "adapters" &&
          targetLayer !== "adapters" &&
          targetLayer !== "interfaces"
        ) {
          violations.push(
            `${relPath}: Clean Architecture violation — adapters/ must only import from interfaces/, not "${spec}" (ADR-0004)`
          );
        } else if (
          sourceLayer === "controllers" &&
          targetLayer !== "controllers" &&
          targetLayer !== "use-cases" &&
          targetLayer !== "interfaces"
        ) {
          violations.push(
            `${relPath}: Clean Architecture violation — controllers/ must delegate to use-cases/ orchestrators and not import from ${targetLayer}/ ("${spec}") (ADR-0004)`
          );
        }
      }
    }

    for (const [index, line] of lines.entries()) {
      const stripped = stripCommentsAndStrings(line);
      if (/^\s*let\s+/.test(stripped)) {
        violations.push(
          `${relPath}:${index + 1}: Avoid mutable \`let\` bindings in favor of \`const\` and pure helpers/reduce (CODING_STANDARDS.md)`
        );
      }
      if (/^\s*for\s*\(/.test(stripped)) {
        violations.push(
          `${relPath}:${index + 1}: Avoid imperative \`for (...)\` loops in favor of declarative array methods (.map, .filter, .reduce, .find) (CODING_STANDARDS.md)`
        );
      }
      if (/\.forEach\s*\(/.test(stripped)) {
        violations.push(
          `${relPath}:${index + 1}: Avoid side-effecting \`.forEach(...)\` in favor of declarative array methods (.map, .filter, .reduce, Array.from) (CODING_STANDARDS.md)`
        );
      }
    }
  }

  for (const [index, line] of lines.entries()) {
    for (const { pattern, useInstead } of BANNED_GLOSSARY_TERMS) {
      if (pattern.test(line)) {
        violations.push(
          `${relPath}:${index + 1}: Banned GLOSSARY.md term matching ${pattern} (use "${useInstead}" instead)`
        );
      }
    }
  }

  return violations;
}

export function evaluatePullRequestLineBudget({
  insertions,
  deletions,
  baseRef,
}) {
  const totalChangedLines = insertions + deletions;
  if (totalChangedLines <= MAX_PR_CHANGED_LINES) {
    return [];
  }
  return [
    `Pull Request diff (${baseRef}...HEAD) has ${totalChangedLines} changed lines (+${insertions} / -${deletions}), exceeding the <= ${MAX_PR_CHANGED_LINES}-line budget (CODING_STANDARDS.md §1). Slice into stacked vertical PRs.`,
  ];
}

function checkPullRequestDiffSize(repoRoot) {
  const baseRef =
    process.env.PR_BASE_REF ||
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : "origin/main");
  const diffResult = spawnSync(
    "git",
    ["diff", "--numstat", `${baseRef}...HEAD`],
    { cwd: repoRoot, encoding: "utf-8" }
  );
  if (diffResult.status !== 0) {
    return {
      insertions: 0,
      deletions: 0,
      baseRef,
      violations: [
        `Failed to compute git diff against "${baseRef}...HEAD": ${(diffResult.stderr || "").trim()}`,
      ],
    };
  }
  const { insertions, deletions } = diffResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce(
      (acc, line) => {
        const [addedRaw, deletedRaw] = line.split(/\s+/);
        const added = Number.parseInt(addedRaw ?? "0", 10);
        const deleted = Number.parseInt(deletedRaw ?? "0", 10);
        return {
          insertions: acc.insertions + (Number.isNaN(added) ? 0 : added),
          deletions: acc.deletions + (Number.isNaN(deleted) ? 0 : deleted),
        };
      },
      { insertions: 0, deletions: 0 }
    );
  return {
    insertions,
    deletions,
    baseRef,
    violations: evaluatePullRequestLineBudget({
      insertions,
      deletions,
      baseRef,
    }),
  };
}

function collectSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

export function runRepoLintChecks(repoRoot = process.cwd()) {
  const packagesDir = join(repoRoot, "packages");
  const sourceFiles = statSync(packagesDir, { throwIfNoEntry: false })
    ? collectSourceFiles(packagesDir)
    : [];

  const violations = [];
  for (const filePath of sourceFiles) {
    const relPath = relative(repoRoot, filePath);
    const content = readFileSync(filePath, "utf-8");
    violations.push(...evaluateSourceFileLintRules(relPath, content));
  }
  return violations;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repoRoot = process.cwd();
  if (process.argv.includes("--check-pr-size")) {
    const prCheck = checkPullRequestDiffSize(repoRoot);
    if (prCheck.violations.length > 0) {
      console.error("Pull Request size check failed:");
      for (const v of prCheck.violations) {
        console.error(`  - ${v}`);
      }
      process.exit(1);
    }
    const total = prCheck.insertions + prCheck.deletions;
    console.log(
      `PR diff size OK: ${total}/${MAX_PR_CHANGED_LINES} changed lines (+${prCheck.insertions} / -${prCheck.deletions} vs ${prCheck.baseRef})`
    );
    process.exit(0);
  }

  const tscResult = spawnSync(
    process.execPath,
    ["./node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
    { cwd: repoRoot, stdio: "inherit" }
  );

  if (tscResult.status !== 0) {
    process.exit(tscResult.status ?? 1);
  }

  const violations = runRepoLintChecks(repoRoot);
  if (violations.length > 0) {
    console.error("Lint check violations found:");
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
}

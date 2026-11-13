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

const PUBLIC_PACKAGE_ENTRYPOINTS = new Set([
  "packages/core/src/index.ts",
  "packages/core/src/interfaces/index.ts",
  "packages/widgets/src/index.ts",
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

function maskCommentsAndStrings(content) {
  const literals = [];
  const masked = content.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\$]|\$(?!\{))*`/g,
    (token) => {
      if (token.startsWith("/*") || token.startsWith("//")) {
        return token.replace(/[^\n]/g, " ");
      }
      const idx = literals.length;
      literals.push(token.slice(1, -1));
      return `"__LIT_${idx}__"`;
    }
  );
  return { masked, literals };
}

const STATIC_IMPORT_MASKED_RE =
  /(?<![.\w$])import\s+(?:[\w$,*{}\s]*\bfrom\s+)?"__LIT_(\d+)__"/g;
const EXPORT_FROM_MASKED_RE =
  /(?<![.\w$])export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+"__LIT_(\d+)__"/g;
const DYNAMIC_IMPORT_MASKED_RE =
  /(?<![.\w$])import\s*\(\s*"__LIT_(\d+)__"\s*(?:,\s*\{[\s\S]*?\}\s*)?\)/g;

const STATIC_IMPORT_CLAUSE_MASKED_RE =
  /(?<![.\w$])import\s+((?:type\s+)?(?:[A-Za-z_$][\w$]*(?:\s*,\s*(?:\*\s+as\s+[A-Za-z_$][\w$]*|\{[^}]*\}))?|\*\s+as\s+[A-Za-z_$][\w$]*|\{[^}]*\}))\s*from\s+"__LIT_(\d+)__"|(?<![.\w$])import\s+"__LIT_(\d+)__"/g;
const EXPORT_CLAUSE_FROM_MASKED_RE =
  /(?<![.\w$])export\s+((?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\}))\s*from\s+"__LIT_(\d+)__"/g;

function areBracedSpecifiersAllTypeOnly(bracedContent) {
  const items = bracedContent
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    items.length > 0 &&
    items.every((item) => /^type\s+[A-Za-z_$]/.test(item))
  );
}

function isStaticImportClauseTypeOnly(rawClause) {
  const clause = rawClause.trim();
  if (!clause) return false;
  if (/^type(?:\s*\{|\s*\*|\s+[A-Za-z_$][\w$]*)/.test(clause)) {
    return true;
  }
  if (clause.startsWith("{") && clause.endsWith("}")) {
    return areBracedSpecifiersAllTypeOnly(clause.slice(1, -1));
  }
  return false;
}

function isExportFromClauseTypeOnly(rawClause) {
  const clause = rawClause.trim();
  if (/^type\s*(?:\{|\*)/.test(clause)) {
    return true;
  }
  if (clause.startsWith("{") && clause.endsWith("}")) {
    return areBracedSpecifiersAllTypeOnly(clause.slice(1, -1));
  }
  return false;
}

function collectRuntimeModuleEdges(content) {
  const { masked, literals } = maskCommentsAndStrings(content);
  const edges = [];
  for (const match of masked.matchAll(STATIC_IMPORT_CLAUSE_MASKED_RE)) {
    if (match[3] !== undefined) {
      const spec = literals[Number(match[3])];
      if (spec !== undefined) edges.push({ spec, clause: "" });
      continue;
    }
    const clause = match[1] ?? "";
    const spec = literals[Number(match[2])];
    if (spec !== undefined && !isStaticImportClauseTypeOnly(clause)) {
      edges.push({ spec, clause });
    }
  }
  for (const match of masked.matchAll(EXPORT_CLAUSE_FROM_MASKED_RE)) {
    const clause = match[1] ?? "";
    const spec = literals[Number(match[2])];
    if (spec !== undefined && !isExportFromClauseTypeOnly(clause)) {
      edges.push({ spec, clause });
    }
  }
  for (const match of masked.matchAll(DYNAMIC_IMPORT_MASKED_RE)) {
    const spec = literals[Number(match[1])];
    if (spec !== undefined) edges.push({ spec, clause: "*" });
  }
  return edges;
}

function extractRuntimeImportSpecifiers(content) {
  return collectRuntimeModuleEdges(content).map((edge) => edge.spec);
}

function evaluateCsfStoryMetaExports(relPath, content) {
  const { masked } = maskCommentsAndStrings(content);
  if (/\bexcludeStories\s*:/.test(masked)) {
    return [];
  }
  const defaultMatch = masked.match(
    /(?<![.\w$])export\s+default\s+([A-Za-z_$][\w$]*)\b/
  );
  const metaIdent = defaultMatch?.[1];
  if (!metaIdent) return [];

  const escapedIdent = metaIdent.replace(/\$/g, "\\$");
  const namedDeclRe = new RegExp(
    `(?<![.\\w$])export\\s+(?:const|let|var)\\s+${escapedIdent}\\b`
  );
  const namedListRe = new RegExp(
    `(?<![.\\w$])export\\s*\\{[^}]*\\b${escapedIdent}\\b(?!\\s+as\\s+default)[^}]*\\}`
  );
  if (namedDeclRe.test(masked) || namedListRe.test(masked)) {
    return [
      `${relPath}: CSF3 story violation — do not export default Meta "${metaIdent}" as a named export without \`excludeStories\`; Storybook treats every named export as a story (CODING_STANDARDS.md §5)`,
    ];
  }
  return [];
}

function extractImportSpecifiers(content) {
  const { masked, literals } = maskCommentsAndStrings(content);
  const specifiers = [];
  for (const regex of [
    STATIC_IMPORT_MASKED_RE,
    EXPORT_FROM_MASKED_RE,
    DYNAMIC_IMPORT_MASKED_RE,
  ]) {
    for (const match of masked.matchAll(regex)) {
      const spec = literals[Number(match[1])];
      if (spec !== undefined) {
        specifiers.push(spec);
      }
    }
  }
  return specifiers;
}

function targetsCoreHelpers(spec) {
  if (spec.startsWith(".")) {
    return posix
      .normalize(posix.join("packages/core/src", spec))
      .startsWith("packages/core/src/use-cases/helpers/");
  }
  return /(?:^|\/)use-cases\/helpers\//.test(spec);
}

function evaluateBarrelHelperReExports(relPath, content) {
  const violations = [];
  const { masked, literals } = maskCommentsAndStrings(content);

  const checkCanonicalSpecifier = (spec) => {
    if (!spec.startsWith("./use-cases/helpers/")) {
      violations.push(
        `${relPath}: Clean Architecture violation — non-canonical helper specifier "${spec}" is prohibited in root barrel (CODING_STANDARDS.md)`
      );
    }
  };

  const wildcardExportMaskedRe =
    /(?<![.\w$])export\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s+from\s+"__LIT_(\d+)__"/g;
  for (const regex of [
    STATIC_IMPORT_MASKED_RE,
    DYNAMIC_IMPORT_MASKED_RE,
    wildcardExportMaskedRe,
  ]) {
    for (const match of masked.matchAll(regex)) {
      const spec = literals[Number(match[1])];
      if (spec === undefined || !targetsCoreHelpers(spec)) continue;
      checkCanonicalSpecifier(spec);
      violations.push(
        `${relPath}: Clean Architecture violation — importing or wildcard re-exporting internal use-cases/helpers/ ("${spec}") is prohibited in root barrel (CODING_STANDARDS.md)`
      );
    }
  }

  const namedExportMaskedRe =
    /(?<![.\w$])export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"__LIT_(\d+)__"/g;
  for (const match of masked.matchAll(namedExportMaskedRe)) {
    const spec = literals[Number(match[2])];
    if (spec === undefined || !targetsCoreHelpers(spec)) continue;
    checkCanonicalSpecifier(spec);
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

  if (/^packages\/widgets\/(?:src|stories)\/.+\.(?:ts|tsx)$/.test(relPath)) {
    for (const spec of extractRuntimeImportSpecifiers(content)) {
      if (spec.startsWith("node:")) {
        violations.push(
          `${relPath}: Browser boundary violation — runtime import of "${spec}" is prohibited in packages/widgets (CODING_STANDARDS.md §5)`
        );
        continue;
      }
      const resolvedRel = spec.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(relPath), spec))
        : "";
      if (
        spec === "@samasastudio/gridlock-core" ||
        resolvedRel.startsWith("packages/core/")
      ) {
        violations.push(
          `${relPath}: Browser boundary violation — import browser-safe schemas from "@samasastudio/gridlock-core/schemas" (or use \`import type\`), not Node server barrel "${spec}" (CODING_STANDARDS.md §5)`
        );
      }
    }
    if (/^packages\/widgets\/stories\/.+\.stories\.tsx$/.test(relPath)) {
      violations.push(...evaluateCsfStoryMetaExports(relPath, content));
    }
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

    if (relPath.startsWith("packages/core/src/interfaces/")) {
      for (const spec of extractRuntimeImportSpecifiers(content)) {
        if (spec.startsWith("node:")) {
          violations.push(
            `${relPath}: Browser schema boundary violation — runtime import of "${spec}" is prohibited in packages/core/src/interfaces/ ("@samasastudio/gridlock-core/schemas")`
          );
        }
      }
    }

    for (const [index, line] of lines.entries()) {
      const stripped = stripCommentsAndStrings(line);
      if (
        relPath.startsWith("packages/core/src/interfaces/") &&
        (/\bprocess\.env\b/.test(stripped) || /\bBuffer\s*(?:\.|\()/.test(stripped))
      ) {
        violations.push(
          `${relPath}:${index + 1}: Browser schema boundary violation — avoid runtime Node globals (\`Buffer\`, \`process.env\`) in packages/core/src/interfaces/ ("@samasastudio/gridlock-core/schemas")`
        );
      }
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
  headRef = "HEAD",
}) {
  const totalChangedLines = insertions + deletions;
  if (totalChangedLines <= MAX_PR_CHANGED_LINES) {
    return [];
  }
  return [
    `Pull Request diff (${baseRef}...${headRef}) has ${totalChangedLines} changed lines (+${insertions} / -${deletions}), exceeding the <= ${MAX_PR_CHANGED_LINES}-line budget (CODING_STANDARDS.md §1). Slice into stacked vertical PRs.`,
  ];
}

export function checkPullRequestDiffSize(repoRoot, options = {}) {
  const baseRef =
    options.baseRef ||
    process.env.PR_BASE_REF ||
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : "origin/main");
  const headRef = options.headRef || process.env.PR_HEAD_REF || "HEAD";
  const diffRange = `${baseRef}...${headRef}`;
  const diffResult = spawnSync(
    "git",
    ["diff", "--numstat", diffRange],
    { cwd: repoRoot, encoding: "utf-8" }
  );
  if (diffResult.status !== 0) {
    return {
      insertions: 0,
      deletions: 0,
      baseRef,
      headRef,
      violations: [
        `Failed to compute git diff against "${diffRange}": ${(diffResult.stderr || "").trim()}`,
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
    headRef,
    violations: evaluatePullRequestLineBudget({
      insertions,
      deletions,
      baseRef,
      headRef,
    }),
  };
}

function collectSourceFiles(dir, extRe = /\.(ts|tsx)$/) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath, extRe));
    } else if (entry.isFile() && extRe.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveRelativeSourcePath(fromRelPath, spec, knownPaths) {
  if (!spec.startsWith(".")) return null;
  const raw = posix.normalize(posix.join(posix.dirname(fromRelPath), spec));
  if (knownPaths.has(raw)) return raw;
  const swapped = raw.replace(/\.(?:js|jsx|mjs|mts)$/, (ext) =>
    ext === ".jsx" ? ".tsx" : ".ts"
  );
  if (knownPaths.has(swapped)) return swapped;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (knownPaths.has(`${raw}${suffix}`)) return `${raw}${suffix}`;
  }
  return raw;
}

function recordClauseImports(rawClause, targetPath, usedByFile) {
  const clause = rawClause.trim();
  if (!clause) return;
  const set = usedByFile.get(targetPath) ?? new Set();
  usedByFile.set(targetPath, set);
  if (/(?:^|,)\s*\*/.test(clause)) {
    set.add("*");
  }
  const braced = clause.match(/\{([\s\S]*?)\}/)?.[1];
  if (braced) {
    for (const rawItem of braced.split(",")) {
      const trimmed = rawItem.trim();
      if (!trimmed || /^type\s+[A-Za-z_$]/.test(trimmed)) continue;
      const exportedSym = trimmed.split(/\s+as\s+/)[0]?.trim();
      if (exportedSym) set.add(exportedSym);
    }
  }
}

function extractDeclaredValueExports(content) {
  const { masked } = maskCommentsAndStrings(content);
  const declared = new Set();
  for (const re of [
    /(?<![.\w$])export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\b/g,
    /(?<![.\w$])export\s+(?:const|let|var|enum|(?:abstract\s+)?class)\s+([A-Za-z_$][\w$]*)\b/g,
  ]) {
    for (const match of masked.matchAll(re)) {
      if (match[1]) declared.add(match[1]);
    }
  }
  for (const match of masked.matchAll(/(?<![.\w$])export\s*\{([^}]*)\}/g)) {
    for (const rawItem of (match[1] ?? "").split(",")) {
      const trimmed = rawItem.trim();
      if (!trimmed || /^type\s+[A-Za-z_$]/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exportedName = (parts[1] ?? parts[0] ?? "").trim();
      if (exportedName && exportedName !== "default") {
        declared.add(exportedName);
      }
    }
  }
  return {
    declared: [...declared],
    hasWildcardReExport: /(?<![.\w$])export\s+\*\s+from\s+"__LIT_\d+__"/.test(masked),
  };
}

export function evaluateUnusedModuleExports(fileEntries) {
  const normalized = fileEntries.map(({ relPath, content }) => ({
    relPath: relPath.replace(/\\/g, "/"),
    content,
  }));
  const knownPaths = new Set(normalized.map((e) => e.relPath));
  const usedByFile = new Map();

  for (const { relPath, content } of normalized) {
    for (const { spec, clause } of collectRuntimeModuleEdges(content)) {
      if (!clause) continue;
      const target = resolveRelativeSourcePath(relPath, spec, knownPaths);
      if (target) recordClauseImports(clause, target, usedByFile);
    }
  }

  const violations = [];
  for (const { relPath, content } of normalized) {
    if (
      !/^packages\/[^/]+\/src\/.+\.(?:ts|tsx)$/.test(relPath) ||
      PUBLIC_PACKAGE_ENTRYPOINTS.has(relPath)
    ) {
      continue;
    }
    const used = usedByFile.get(relPath);
    if (used?.has("*")) continue;
    const { declared, hasWildcardReExport } = extractDeclaredValueExports(content);
    if (hasWildcardReExport && (!used || used.size === 0)) {
      violations.push(
        `${relPath}: Unused wildcard re-export \`export *\` — wire a caller or re-export solely from a public barrel (CODING_STANDARDS.md §1)`
      );
    }
    for (const sym of declared) {
      if (!used?.has(sym)) {
        violations.push(
          `${relPath}: Unused module export "${sym}" — wire it to a caller or public barrel within this slice, or omit \`export\` (CODING_STANDARDS.md §1)`
        );
      }
    }
  }
  return violations;
}

export function runRepoLintChecks(repoRoot = process.cwd()) {
  const packagesDir = join(repoRoot, "packages");
  const sourceFiles = statSync(packagesDir, { throwIfNoEntry: false })
    ? collectSourceFiles(packagesDir)
    : [];

  const fileEntries = [];
  const violations = [];
  for (const filePath of sourceFiles) {
    const relPath = relative(repoRoot, filePath).replace(/\\/g, "/");
    const content = readFileSync(filePath, "utf-8");
    fileEntries.push({ relPath, content });
    violations.push(...evaluateSourceFileLintRules(relPath, content));
  }

  const scriptsDir = join(repoRoot, "scripts");
  if (statSync(scriptsDir, { throwIfNoEntry: false })) {
    for (const filePath of collectSourceFiles(
      scriptsDir,
      /\.(?:mjs|mts|js|ts|tsx)$/
    )) {
      const relPath = relative(repoRoot, filePath).replace(/\\/g, "/");
      fileEntries.push({
        relPath,
        content: readFileSync(filePath, "utf-8"),
      });
    }
  }

  violations.push(...evaluateUnusedModuleExports(fileEntries));
  return violations;
}

const VALID_BRANCH_RE =
  /^(?:(?:feat|fix)\/[0-9]+-[a-z0-9][a-z0-9-]*|chore\/[a-z0-9][a-z0-9-]*)$/;

export function evaluateBranchName(branchName) {
  const branch = (branchName ?? "").trim();
  if (!branch) {
    return [];
  }
  if (branch === "main") {
    return [
      "Direct commits to 'main' are prohibited. Create a dedicated branch ('feat/<issue>-<slug>', 'fix/<issue>-<slug>', or 'chore/<slug>').",
    ];
  }
  if (!VALID_BRANCH_RE.test(branch)) {
    return [
      `Branch "${branch}" must match 'feat/<issue>-<slug>', 'fix/<issue>-<slug>' (numeric GitHub issue ID), or 'chore/<slug>' (CODING_STANDARDS.md §1).`,
    ];
  }
  return [];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repoRoot = process.cwd();
  const checkBranchIdx = process.argv.indexOf("--check-branch");
  if (checkBranchIdx !== -1) {
    const branchArg = process.argv[checkBranchIdx + 1] ?? "";
    const branchViolations = evaluateBranchName(branchArg);
    if (branchViolations.length > 0) {
      for (const v of branchViolations) {
        console.error(`ERROR: ${v}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }
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
      `PR diff size OK: ${total}/${MAX_PR_CHANGED_LINES} changed lines (+${prCheck.insertions} / -${prCheck.deletions} for ${prCheck.baseRef}...${prCheck.headRef})`
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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

// 1. Run TypeScript project references typecheck
const tscResult = spawnSync(
  process.execPath,
  ["./node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
  { cwd: repoRoot, stdio: "inherit" }
);

if (tscResult.status !== 0) {
  process.exit(tscResult.status ?? 1);
}

// 2. Enforce GLOSSARY.md banned terms and interactive .tsx line budgets (<= 220 lines)
const BANNED_GLOSSARY_TERMS = [
  { pattern: /\bCompute Atlas\b/i, useInstead: "Gridlock" },
  { pattern: /\braw payload\b/i, useInstead: "Source Artifact" },
  { pattern: /\bcached page\b/i, useInstead: "Source Artifact" },
  { pattern: /\bscrape dump\b/i, useInstead: "Source Artifact" },
  { pattern: /\bLLM scraper\b/i, useInstead: "Connector" },
  { pattern: /\blive LLM parser\b/i, useInstead: "Repair Agent" },
  { pattern: /\bauto-committer\b/i, useInstead: "Repair Agent" },
  { pattern: /\bslippy map tile\b/i, useInstead: "Visual Plate" },
];

const MAX_TSX_LINES = 220;

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

const packagesDir = join(repoRoot, "packages");
const sourceFiles = statSync(packagesDir, { throwIfNoEntry: false })
  ? collectSourceFiles(packagesDir)
  : [];

const violations = [];

for (const filePath of sourceFiles) {
  const relPath = relative(repoRoot, filePath);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  if (filePath.endsWith(".tsx") && lines.length > MAX_TSX_LINES) {
    violations.push(
      `${relPath}: ${lines.length} lines exceeds ${MAX_TSX_LINES}-line component budget (CODING_STANDARDS.md)`
    );
  }

  lines.forEach((line, index) => {
    for (const { pattern, useInstead } of BANNED_GLOSSARY_TERMS) {
      if (pattern.test(line)) {
        violations.push(
          `${relPath}:${index + 1}: Banned GLOSSARY.md term matching ${pattern} (use "${useInstead}" instead)`
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Lint check violations found:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  RunRecordSchema,
  RunSpanSchema,
  RunStageSchema,
} from "../src/index.ts";
import {
  BANNED_GLOSSARY_TERMS,
  MAX_CORE_TS_LINES,
  MAX_PR_CHANGED_LINES,
  MAX_TSX_LINES,
  NON_LINTABLE_GLOSSARY_WORDS,
  PENDING_GLOSSARY_MIGRATION_TERMS,
  evaluatePullRequestLineBudget,
  evaluateSourceFileLintRules,
  evaluateUnusedModuleExports,
  parseGlossaryAvoidTerms,
} from "../../../scripts/lint-checks.mjs";
import {
  evaluateProgramTypeHygiene,
  runTypeHygieneChecks,
} from "../../../scripts/type-hygiene.mjs";

describe("Repository Guardrails: RunStageSchema & Unused Slice Exports (Issue #27 & #35 Retros)", () => {
  test("RunStageSchema, RunRecordSchema, and RunSpanSchema reject non-canonical stage strings", () => {
    for (const stage of [
      "tdlr_ingest",
      "tdlr_discovery_sweep",
      "repair_agent",
      "painter_bootstrap",
      "painter_milestone_gate",
      "painter_milestone_delta",
      "painter_branch_lineage",
    ]) {
      assert.equal(RunStageSchema.safeParse(stage).success, true);
    }
    assert.equal(RunStageSchema.safeParse("out_of_band_repair_agent").success, false);
    assert.equal(RunStageSchema.safeParse("tdlr_filing_ingest").success, false);

    assert.equal(
      RunRecordSchema.safeParse({
        runId: "run_bad_stage",
        stage: "out_of_band_repair_agent",
        execution_mode: "agentic",
        status: "agentic_completed",
        durationMs: 100,
        rawByteLength: 0,
        tokensUsed: 390,
        naiveTokensAvoided: 0,
        estimatedCostSavedUsd: 0,
        recordedAt: "2026-10-27T14:00:00.000Z",
        expiresAt: null,
      }).success,
      false
    );

    assert.equal(
      RunSpanSchema.safeParse({
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        stage: "tdlr_filing_ingest",
        execution_mode: "deterministic",
        status: "ingested",
        durationMs: 12,
        tokensUsed: 0,
        naiveTokensAvoided: 250,
        startedAt: "2026-10-27T14:00:00.000Z",
        endedAt: "2026-10-27T14:00:00.012Z",
      }).success,
      false
    );
  });

  test("evaluateUnusedModuleExports flags orphan exports, type-only masks, and non-barrel re-exports while permitting barrel & directory-index callers", () => {
    const violations = evaluateUnusedModuleExports([
      {
        relPath: "packages/widgets/src/DossierPrimitives.tsx",
        content: [
          "export const EDITORIAL_EASE = [0.22, 1, 0.36, 1] as const;",
          "export const EDITORIAL_TRANSITION = { duration: 0.72, ease: EDITORIAL_EASE };",
          "export const CALM_FADE_TRANSITION = { duration: 0.36, ease: EDITORIAL_EASE };",
          "export const TypeMasked = 1; export type TypeMasked = number;",
          "export const ReExportedOrphan = 2;",
          "export function DossierNumber() { return CALM_FADE_TRANSITION.duration; }",
        ].join("\n"),
      },
      {
        relPath: "packages/widgets/src/sub/index.ts",
        content: "export const SubIndexHelper = 42;",
      },
      {
        relPath: "packages/widgets/src/RepairChangelogTimeline.tsx",
        content: [
          'import { EDITORIAL_EASE, type TypeMasked } from "./DossierPrimitives.tsx";',
          'import { SubIndexHelper } from "./sub";',
          'export { ReExportedOrphan } from "./DossierPrimitives.tsx";',
          "export function Timeline(x: TypeMasked) { return EDITORIAL_EASE.length + SubIndexHelper + x; }",
        ].join("\n"),
      },
      {
        relPath: "packages/widgets/src/index.ts",
        content:
          'export { DossierNumber } from "./DossierPrimitives.tsx";\nexport { Timeline } from "./RepairChangelogTimeline.tsx";',
      },
    ]);

    assert.equal(violations.length, 4);
    assert.ok(violations.some((v) => v.includes('"EDITORIAL_TRANSITION"')));
    assert.ok(violations.some((v) => v.includes('"CALM_FADE_TRANSITION"')));
    assert.ok(violations.some((v) => v.includes('"TypeMasked"')));
    assert.ok(violations.some((v) => v.includes('RepairChangelogTimeline.tsx: Unused module export "ReExportedOrphan"')));
  });

  test("evaluateSourceFileLintRules enforces non-mutative control flow (let, for, while, .forEach) in widgets and core while permitting const, .map, and recursion", () => {
    const widgetViolations = evaluateSourceFileLintRules(
      "packages/widgets/src/Example.tsx",
      [
        "export function Example(items: readonly string[]) {",
        "  let current = items[0];",
        "  for (const item of items) { void item; }",
        "  while (current) { break; }",
        "  items.forEach((item) => { void item; });",
        "  return null;",
        "}",
      ].join("\n")
    );

    assert.equal(widgetViolations.length, 4);
    assert.ok(widgetViolations.some((v) => v.includes("Avoid mutable `let`")));
    assert.ok(widgetViolations.some((v) => v.includes("Avoid imperative `for (...)`")));
    assert.ok(widgetViolations.some((v) => v.includes("Avoid imperative `while (...)`")));
    assert.ok(widgetViolations.some((v) => v.includes("Avoid side-effecting `.forEach(...)`")));

    const coreWhileViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/example.ts",
      [
        "export function walk(depth: number): number {",
        "  while (depth > 0) { return depth - 1; }",
        "  return 0;",
        "}",
      ].join("\n")
    );

    assert.equal(coreWhileViolations.length, 1);
    assert.ok(coreWhileViolations[0]?.includes("Avoid imperative `while (...)`"));

    const cleanWidgetSource = [
      "// let / for (x) / while (y) / items.forEach() in comments or strings are ignored",
      'const label = "while (active) { let count = 0; items.forEach(fn); }";',
      "export function walkSteps(steps: readonly string[], index = 0): string[] {",
      "  if (index >= steps.length) return [];",
      "  const head = steps.slice(index, index + 1).map((step) => `${label}:${step}`);",
      "  return [...head, ...walkSteps(steps, index + 1)];",
      "}",
    ].join("\n");

    assert.deepEqual(
      evaluateSourceFileLintRules("packages/widgets/src/Example.tsx", cleanWidgetSource),
      []
    );
    assert.deepEqual(
      evaluateSourceFileLintRules("packages/core/src/use-cases/example.ts", cleanWidgetSource),
      []
    );
  });

  test("evaluateSourceFileLintRules enforces Gemini v1, Motion/Motion+, withWidgetDom SSR, and @ts-ignore guardrails", () => {
    const coreViolations = evaluateSourceFileLintRules(
      "packages/core/src/adapters/bad-gemini.ts",
      [
        'import { GoogleGenerativeAI } from "@google/generative-ai";',
        "// @ts-ignore legacy shim",
        'export const model = "gemini-2.5-flash";',
        "export function call(client: { models: { generateContent: () => void } }) {",
        "  void GoogleGenerativeAI;",
        "  return client.models.generateContent();",
        "}",
      ].join("\n")
    );
    assert.ok(coreViolations.some((v) => v.includes('"@google/generative-ai"')));
    assert.ok(coreViolations.some((v) => v.includes("@ts-ignore")));
    assert.ok(coreViolations.some((v) => v.includes("Deprecated Gemini model ID")));
    assert.ok(coreViolations.some((v) => v.includes("models.generateContent")));

    const widgetViolations = evaluateSourceFileLintRules(
      "packages/widgets/src/BadMotion.tsx",
      [
        'import { motion, useReducedMotion } from "framer-motion";',
        "export function BadMotion() {",
        "  const reduced = useReducedMotion();",
        "  return reduced ? null : motion;",
        "}",
      ].join("\n")
    );
    assert.ok(widgetViolations.some((v) => v.includes('"framer-motion"')));
    assert.ok(widgetViolations.some((v) => v.includes("MotionConfig")));

    const ssrConflict = evaluateSourceFileLintRules(
      "packages/widgets/test/bad-dom-ssr.test.tsx",
      [
        'import { renderToReadableStream } from "react-dom/server";',
        'import { withWidgetDom } from "./helpers/dom-harness.ts";',
        "export const run = () => [withWidgetDom, renderToReadableStream];",
      ].join("\n")
    );
    assert.ok(ssrConflict.some((v) => v.includes("renderToStaticMarkup")));

    const pureSsrTest = evaluateSourceFileLintRules(
      "packages/widgets/test/pure-ssr.test.tsx",
      [
        'import { renderToReadableStream } from "react-dom/server";',
        "export const run = () => renderToReadableStream;",
      ].join("\n")
    );
    assert.deepEqual(pureSsrTest, []);
  });

  test("evaluatePullRequestLineBudget enforces the 800-line PR cap", () => {
    assert.equal(MAX_PR_CHANGED_LINES, 800);
    assert.deepEqual(
      evaluatePullRequestLineBudget({ insertions: 700, deletions: 100, baseRef: "origin/main" }),
      []
    );
    const over = evaluatePullRequestLineBudget({
      insertions: 701,
      deletions: 100,
      baseRef: "origin/main",
      headRef: "WORKTREE",
    });
    assert.equal(over.length, 1);
    assert.ok(over[0]?.includes("801 changed lines"));
    assert.ok(over[0]?.includes("<= 800-line budget"));
  });

  test("evaluateSourceFileLintRules enforces 400-line core and 280-line widget component budgets while keeping inward layer checks", () => {
    assert.equal(MAX_CORE_TS_LINES, 400);
    assert.equal(MAX_TSX_LINES, 280);

    const coreAtCap = Array.from({ length: 400 }, () => "export const x = 1;").join("\n");
    const coreOverCap = Array.from({ length: 401 }, () => "export const x = 1;").join("\n");
    assert.deepEqual(
      evaluateSourceFileLintRules("packages/core/src/use-cases/at-cap.ts", coreAtCap),
      []
    );
    const coreOverViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/over-cap.ts",
      coreOverCap
    );
    assert.equal(coreOverViolations.length, 1);
    assert.ok(coreOverViolations[0]?.includes("exceeds 400-line core module budget"));

    const tsxAtCap = Array.from({ length: 280 }, () => "export const y = 1;").join("\n");
    const tsxOverCap = Array.from({ length: 281 }, () => "export const y = 1;").join("\n");
    assert.deepEqual(
      evaluateSourceFileLintRules("packages/widgets/src/AtCap.tsx", tsxAtCap),
      []
    );
    const tsxOverViolations = evaluateSourceFileLintRules(
      "packages/widgets/src/OverCap.tsx",
      tsxOverCap
    );
    assert.equal(tsxOverViolations.length, 1);
    assert.ok(tsxOverViolations[0]?.includes("exceeds 280-line component budget"));

    const upwardViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/bad-layer.ts",
      'import { defaultPageLoader } from "../adapters/http-loaders.ts";\nexport const x = defaultPageLoader;'
    );
    assert.ok(upwardViolations.some((v) => v.includes("use-cases/ must not import from outer adapters/")));
  });

  test("evaluateProgramTypeHygiene flags explicit and inherent any leaks and passes on the real workspace", () => {
    const virtualFile = "/repo/packages/core/src/use-cases/leaky.ts";
    const leakySource = [
      "export function parseThing(raw: unknown, p: Promise<void>): unknown {",
      "  const explicit: any = raw;",
      "  const parsed = JSON.parse('{}');",
      "  void p.catch((err) => err);",
      "  const mapped = Array.isArray(raw) ? raw.map((item) => item) : [];",
      "  return parsed ?? explicit ?? mapped;",
      "}",
    ].join("\n");
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
    };
    const defaultHost = ts.createCompilerHost(compilerOptions);
    const host: ts.CompilerHost = {
      ...defaultHost,
      fileExists: (f) => f === virtualFile || defaultHost.fileExists(f),
      readFile: (f) => (f === virtualFile ? leakySource : defaultHost.readFile(f)),
      getSourceFile: (f, langVersion) =>
        f === virtualFile
          ? ts.createSourceFile(f, leakySource, langVersion)
          : defaultHost.getSourceFile(f, langVersion),
    };
    const program = ts.createProgram([virtualFile], compilerOptions, host);
    const violations = evaluateProgramTypeHygiene(program, "/repo");

    assert.ok(violations.some((v) => v.includes("explicit any")));
    assert.ok(violations.some((v) => v.includes('variable "parsed"')));
    assert.ok(violations.some((v) => v.includes('parameter "err"')));
    assert.ok(violations.some((v) => v.includes('parameter "item"')));
    assert.deepEqual(runTypeHygieneChecks(process.cwd()), []);
  });

  test("BANNED_GLOSSARY_TERMS stays synced with GLOSSARY.md and rejects retired terms and schema key stems", () => {
    const repoRoot = process.cwd();
    const glossaryMarkdown = readFileSync(join(repoRoot, "GLOSSARY.md"), "utf-8");
    const parsedEntries = parseGlossaryAvoidTerms(glossaryMarkdown);
    assert.ok(parsedEntries.length >= 30);

    for (const entry of parsedEntries) {
      const normalized = entry.term.toLowerCase();
      const isExcluded =
        NON_LINTABLE_GLOSSARY_WORDS.has(normalized) ||
        PENDING_GLOSSARY_MIGRATION_TERMS.has(normalized);
      const isActive = BANNED_GLOSSARY_TERMS.some(
        (banned) =>
          banned.pattern.test(entry.term) && banned.useInstead === entry.useInstead
      );
      assert.equal(
        isActive,
        !isExcluded,
        `GLOSSARY.md _Avoid_ term "${entry.term}" -> "${entry.useInstead}" out of sync with BANNED_GLOSSARY_TERMS`
      );
    }

    const retiredSamples = [
      ["Source", "Artifact"].join(" "),
      ["Efficiency", "Ledger"].join(" "),
      ["UI", "AST"].join(" "),
      ["Investigation", "Planner"].join(" "),
      ["tele", "metry"].join(""),
    ];
    for (const sample of retiredSamples) {
      const violations = evaluateSourceFileLintRules(
        "packages/core/src/use-cases/sample.ts",
        `// ${sample}\nexport const ok = 1;`
      );
      assert.ok(
        violations.some((v) => v.includes("Banned GLOSSARY.md term")),
        `Expected lint to reject retired glossary term "${sample}"`
      );
    }

    const retiredStemViolations = evaluateSourceFileLintRules(
      "packages/core/src/interfaces/sample-models.ts",
      [
        'import { z } from "zod";',
        "export const SampleSchema = z.object({",
        `  ${["ledger", "Id"].join("")}: z.string().min(1),`,
        `  ${["ast", "Node"].join("")}: z.string().min(1),`,
        "});",
      ].join("\n")
    );
    assert.equal(retiredStemViolations.length, 2);
    assert.ok(retiredStemViolations.every((v) => v.includes("Retired glossary stem")));
  });

  test("package.json script test paths exist on disk and lint-checks.mjs keeps type-hygiene lazy for zero-dep CLI flags", () => {
    const repoRoot = process.cwd();
    const pkgRaw: unknown = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf-8")
    );
    const scripts =
      typeof pkgRaw === "object" &&
      pkgRaw !== null &&
      "scripts" in pkgRaw &&
      typeof pkgRaw.scripts === "object" &&
      pkgRaw.scripts !== null
        ? (pkgRaw.scripts as Record<string, unknown>)
        : {};

    const checkedPaths: string[] = [];
    for (const [scriptName, cmd] of Object.entries(scripts)) {
      if (typeof cmd !== "string") continue;
      for (const match of cmd.matchAll(/packages\/[A-Za-z0-9_./-]+\.test\.tsx?/g)) {
        const testRelPath = match[0];
        checkedPaths.push(testRelPath);
        assert.ok(
          existsSync(join(repoRoot, testRelPath)),
          `package.json script "${scriptName}" references missing test file "${testRelPath}"`
        );
      }
    }
    assert.ok(checkedPaths.length >= 2);

    const lintScript = readFileSync(join(repoRoot, "scripts/lint-checks.mjs"), "utf-8");
    assert.equal(
      /^import\s+.*["']\.\/type-hygiene\.mjs["']/m.test(lintScript),
      false,
      "scripts/lint-checks.mjs must lazy-import ./type-hygiene.mjs so --check-branch and --check-pr-size work without node_modules"
    );
  });
});

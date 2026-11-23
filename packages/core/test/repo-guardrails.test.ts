import { describe, test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {
  TelemetryRunSchema,
  TelemetrySpanSchema,
  TelemetryStageSchema,
} from "../src/index.ts";
import {
  MAX_PR_CHANGED_LINES,
  evaluatePullRequestLineBudget,
  evaluateSourceFileLintRules,
  evaluateUnusedModuleExports,
} from "../../../scripts/lint-checks.mjs";
import {
  evaluateProgramTypeHygiene,
  runTypeHygieneChecks,
} from "../../../scripts/type-hygiene.mjs";

describe("Repository Guardrails: TelemetryStageSchema & Unused Slice Exports (Issue #27 & #35 Retros)", () => {
  test("TelemetryStageSchema, TelemetryRunSchema, and TelemetrySpanSchema reject non-canonical stage strings", () => {
    for (const stage of [
      "tdlr_ingest",
      "tdlr_discovery_sweep",
      "repair_agent",
      "painter_bootstrap",
      "painter_milestone_gate",
      "painter_milestone_delta",
      "painter_branch_lineage",
    ]) {
      assert.equal(TelemetryStageSchema.safeParse(stage).success, true);
    }
    assert.equal(TelemetryStageSchema.safeParse("out_of_band_repair_agent").success, false);
    assert.equal(TelemetryStageSchema.safeParse("tdlr_filing_ingest").success, false);

    assert.equal(
      TelemetryRunSchema.safeParse({
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
      TelemetrySpanSchema.safeParse({
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
        relPath: "packages/widgets/src/RepairLogTimeline.tsx",
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
          'export { DossierNumber } from "./DossierPrimitives.tsx";\nexport { Timeline } from "./RepairLogTimeline.tsx";',
      },
    ]);

    assert.equal(violations.length, 4);
    assert.ok(violations.some((v) => v.includes('"EDITORIAL_TRANSITION"')));
    assert.ok(violations.some((v) => v.includes('"CALM_FADE_TRANSITION"')));
    assert.ok(violations.some((v) => v.includes('"TypeMasked"')));
    assert.ok(violations.some((v) => v.includes('RepairLogTimeline.tsx: Unused module export "ReExportedOrphan"')));
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
});

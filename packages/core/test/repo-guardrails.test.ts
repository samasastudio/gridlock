import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  TelemetryRunSchema,
  TelemetrySpanSchema,
  TelemetryStageSchema,
} from "../src/index.ts";
import { evaluateUnusedModuleExports } from "../../../scripts/lint-checks.mjs";

describe("Repository Guardrails: TelemetryStageSchema & Unused Slice Exports (Issue #27 Retro)", () => {
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
});

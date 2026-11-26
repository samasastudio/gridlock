import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL,
  PlateLineageResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
} from "@samasastudio/gridlock-core";
import { GridlockPlateWidget, PlateFrameStage } from "../src/index.ts";
import { withWidgetDom } from "./helpers/dom-harness.ts";
import {
  buildBranchOnlyLineage,
  seedTestPlateLineage,
  seedTurn1ForkLineage,
} from "./helpers/plate-fixtures.ts";

function extractRemFontSizes(html: string): number[] {
  const styleBlock = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
  return Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) => Number(m[1]));
}

describe("PlateComparisonStage 2-Up Canonical-vs-Branch Controls (Ticket #35 Phase 1)", () => {
  test("SSR toggle visibility, branch-only omission, and diurnal/nocturnal >= 0.75rem typography floor", async () => {
    const seeded = await seedTestPlateLineage();
    const t1Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.t1.plateId)!;
    const t2Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.t2.plateId)!;
    const b2Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.b2.plateId)!;

    const canonicalHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={seeded.lineage} selectedPlateId={seeded.t2.plateId} apiBaseUrl="" />
    );
    assert.doesNotMatch(canonicalHtml, /Compare with Canonical/);
    assert.doesNotMatch(canonicalHtml, /data-plate-comparison="split"/);
    assert.doesNotMatch(canonicalHtml, /data-comparison-slot=/);

    const branchOnlyLineage = buildBranchOnlyLineage(
      seeded.lineage,
      seeded.b1.plateId,
      seeded.b2.plateId
    );

    const branchOnlyWidgetHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={branchOnlyLineage} selectedPlateId={seeded.b1.plateId} apiBaseUrl="" />
    );
    assert.match(branchOnlyWidgetHtml, new RegExp(`data-plate-id="${seeded.b1.plateId}"`));
    assert.doesNotMatch(branchOnlyWidgetHtml, /Compare with Canonical/);

    const branchOnlyStageHtml = renderToStaticMarkup(
      <PlateFrameStage nodes={branchOnlyLineage.nodes} activePlateId={seeded.b1.plateId} onSelectPlate={() => {}} apiBaseUrl="" />
    );
    assert.match(branchOnlyStageHtml, new RegExp(`data-plate-id="${seeded.b1.plateId}"`));
    assert.doesNotMatch(branchOnlyStageHtml, /Compare with Canonical/);

    const standaloneStageHtml = renderToStaticMarkup(
      <PlateFrameStage nodes={seeded.lineage.nodes} activePlateId={seeded.b1.plateId} onSelectPlate={() => {}} apiBaseUrl="" />
    );
    assert.match(standaloneStageHtml, /Baseline · Turn 2/);
    assert.match(standaloneStageHtml, new RegExp(`<code>${seeded.t2.plateId}</code>`));
    assert.match(standaloneStageHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const standaloneAgedStageHtml = renderToStaticMarkup(
      <PlateFrameStage nodes={[t1Node, t2Node, b2Node]} activePlateId={seeded.b2.plateId} onSelectPlate={() => {}} apiBaseUrl="" />
    );
    assert.match(standaloneAgedStageHtml, /Baseline · Turn 2/);
    assert.match(standaloneAgedStageHtml, new RegExp(`<code>${seeded.t2.plateId}</code>`));
    assert.match(standaloneAgedStageHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const diurnalHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={seeded.lineage} selectedPlateId={seeded.b1.plateId} theme="diurnal" apiBaseUrl="" />
    );
    const diurnalRemSizes = extractRemFontSizes(diurnalHtml);
    assert.ok(diurnalRemSizes.length > 0 && diurnalRemSizes.every((size) => size >= 0.75));
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(diurnalHtml, /Baseline · Turn 2/);
    assert.match(diurnalHtml, new RegExp(`<code>${seeded.t2.plateId}</code>`));
    assert.match(diurnalHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const nocturnalHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={seeded.lineage} selectedPlateId={seeded.b1.plateId} theme="nocturnal" apiBaseUrl="" />
    );
    const nocturnalRemSizes = extractRemFontSizes(nocturnalHtml);
    assert.ok(nocturnalRemSizes.length > 0 && nocturnalRemSizes.every((size) => size >= 0.75));
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);
  });

  test("Interactive 2-up split, multi-hop canonical walk, isolated pane fallback, and 90d TTL aged-hop fallback", async () => {
    const seeded = await seedTestPlateLineage();
    const t1Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.t1.plateId)!;
    const t2Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.t2.plateId)!;
    const b2Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.b2.plateId)!;

    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => {
        root.render(<GridlockPlateWidget lineage={seeded.lineage} initialPlateId={seeded.b1.plateId} apiBaseUrl="" />);
      });

      const getCompareToggle = () =>
        Array.from(container.querySelectorAll("button")).find((btn) =>
          btn.classList.contains("gridlock-plate-compare-toggle")
        );
      const getTabButtons = () =>
        Array.from(container.querySelectorAll("button")).filter(
          (btn) => btn.getAttribute("role") === "tab"
        );

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "false");
      assert.equal(container.querySelector('[data-plate-comparison="split"]'), null);
      assert.equal(container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-comparison-slot"), null);

      await act(async () => {
        getCompareToggle()!.click();
      });

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "true");
      assert.equal(container.querySelector('[data-plate-comparison="split"]')?.getAttribute("role"), "group");

      const canonicalPane = container.querySelector('[data-comparison-slot="canonical"]')!;
      const branchPane = container.querySelector('[data-comparison-slot="branch"]')!;
      assert.equal(canonicalPane.getAttribute("data-plate-id"), seeded.t2.plateId);
      assert.equal(canonicalPane.getAttribute("data-branch"), "false");
      assert.match(canonicalPane.textContent ?? "", new RegExp(CANONICAL_MILESTONE_LABEL));
      assert.equal(branchPane.getAttribute("data-plate-id"), seeded.b1.plateId);
      assert.equal(branchPane.getAttribute("data-branch"), "true");
      assert.match(branchPane.textContent ?? "", new RegExp(SCENARIO_BRANCH_WATERMARK));

      await act(async () => {
        getTabButtons()[2]!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });

      const multiHopCanonical = container.querySelector('[data-comparison-slot="canonical"]')!;
      const multiHopBranch = container.querySelector('[data-comparison-slot="branch"]')!;
      assert.equal(multiHopCanonical.getAttribute("data-plate-id"), seeded.t2.plateId);
      assert.equal(multiHopBranch.getAttribute("data-plate-id"), seeded.b2.plateId);

      const canonicalImg = multiHopCanonical.querySelector("img")!;
      await act(async () => {
        canonicalImg.dispatchEvent(new win.Event("error"));
      });

      assert.ok(multiHopCanonical.querySelector('[data-plate-fallback="true"]'));
      assert.equal(multiHopBranch.querySelector('[data-plate-fallback="true"]'), null);
      assert.equal(multiHopBranch.querySelector("img")?.getAttribute("src"), `/api/illustrations/assets/${seeded.b2.plateId}.webp`);

      await act(async () => {
        getTabButtons()[0]!.click();
      });

      assert.equal(container.querySelector('[data-plate-comparison="split"]'), null);
      assert.equal(getCompareToggle(), undefined);
      assert.equal(container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"), seeded.t1.plateId);

      await act(async () => {
        getTabButtons()[2]!.click();
      });
      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "true");

      await act(async () => {
        getCompareToggle()!.click();
      });

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "false");
      assert.equal(container.querySelector('[data-plate-comparison="split"]'), null);

      const turn1Fork = await seedTurn1ForkLineage(seeded);
      assert.equal(turn1Fork.lineage.activeCanonicalPlateId, seeded.t2.plateId);

      const assertTurn1BaselineSplit = async (
        lineageFixture: typeof seeded.lineage,
        branchPlateId: string
      ) => {
        await act(async () => {
          root.render(
            <GridlockPlateWidget
              lineage={lineageFixture}
              initialPlateId={branchPlateId}
              apiBaseUrl=""
            />
          );
        });

        assert.match(
          container.querySelector(".gridlock-plate-compare-context")?.textContent ?? "",
          new RegExp(`Baseline · Turn 1 · ${seeded.t1.plateId}`)
        );

        await act(async () => {
          getCompareToggle()!.click();
        });

        assert.equal(
          container.querySelector('[data-comparison-slot="canonical"]')?.getAttribute("data-plate-id"),
          seeded.t1.plateId
        );
        assert.equal(
          container.querySelector('[data-comparison-slot="branch"]')?.getAttribute("data-plate-id"),
          branchPlateId
        );
      };

      await assertTurn1BaselineSplit(turn1Fork.lineage, turn1Fork.branchPlate.plateId);

      const agedHopLineage = PlateLineageResponseSchema.parse({
        timelineId: seeded.lineage.timelineId,
        activeCanonicalPlateId: seeded.t1.plateId,
        nodes: [t1Node, t2Node, b2Node],
        edges: [seeded.lineage.edges[0]!],
      });

      await assertTurn1BaselineSplit(agedHopLineage, seeded.b2.plateId);
    });
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL,
  SCENARIO_BRANCH_WATERMARK,
  type LineageNode,
} from "@samasastudio/gridlock-core";
import { PlateFrameStage } from "../src/index.ts";
import { withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestPlateLineage } from "./helpers/plate-fixtures.ts";

function ControlledStageHarness(props: {
  nodes: readonly LineageNode[];
  initialPlateId: string;
  overrides?: Readonly<Record<string, string>>;
}) {
  const [activePlateId, setActivePlateId] = useState(props.initialPlateId);
  return (
    <PlateFrameStage
      nodes={props.nodes}
      activePlateId={activePlateId}
      onSelectPlate={setActivePlateId}
      apiBaseUrl="https://api.example.com/"
      assetUrlOverrides={props.overrides}
    />
  );
}

describe("PlateFrameStage Scrubber (Ticket #34 Phase 1)", () => {
  test("PlateFrameStage enforces >= 0.75rem floor, sorts shuffled turns, handles roving keyboard focus, badges branches, and recovers from broken WebP URLs", async () => {
    const seeded = await seedTestPlateLineage();
    const { nodes } = seeded.lineage;
    const shuffled = [nodes[2]!, nodes[0]!, nodes[3]!, nodes[1]!];

    const ssrHtml = renderToStaticMarkup(
      <PlateFrameStage nodes={shuffled} activePlateId={seeded.t2.plateId} onSelectPlate={() => {}} apiBaseUrl="" />
    );
    const styleCss = ssrHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remSizes = Array.from(styleCss.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) => Number(m[1]));
    assert.ok(remSizes.length > 0 && remSizes.every((size) => size >= 0.75));
    assert.match(styleCss, /:where\(\.gridlock-plate-stage:not\(\.gridlock-dossier-surface \*\)\)\s*\{[\s\S]*?--gridlock-ink:[\s\S]*?--gridlock-radius:\s*0rem/);
    assert.match(styleCss, /:where\(\.gridlock-plate-stage code\)\s*\{[^}]*font-size:\s*max\(0\.75rem,\s*0\.875em\)/);
    assert.match(styleCss, /:where\(\.gridlock-plate-stage :is\(button, a, \[role="button"\], \[tabindex="0"\], summary\)\):focus-visible\s*\{\s*outline:\s*2px solid var\(--gridlock-ink\)/);
    assert.match(styleCss, /:where\(\.gridlock-plate-stage \.gridlock-status-badge\)\s*\{\s*padding-block:\s*0\.25rem/);
    assert.match(ssrHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.plateId}\\.webp"`));

    const blankOverrideFallbackHtml = renderToStaticMarkup(
      <PlateFrameStage
        nodes={shuffled}
        activePlateId={seeded.t2.plateId}
        onSelectPlate={() => {}}
        assetUrlOverrides={{ [seeded.t2.plateId]: "   " }}
      />
    );
    assert.match(blankOverrideFallbackHtml, /data-plate-fallback="true"/);
    assert.doesNotMatch(blankOverrideFallbackHtml, /src=""/);

    const blankOverrideSameOriginHtml = renderToStaticMarkup(
      <PlateFrameStage
        nodes={shuffled}
        activePlateId={seeded.t2.plateId}
        onSelectPlate={() => {}}
        apiBaseUrl=""
        assetUrlOverrides={{ [seeded.t2.plateId]: "   " }}
      />
    );
    assert.match(blankOverrideSameOriginHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.plateId}\\.webp"`));

    const omittedIdHtml = renderToStaticMarkup(<PlateFrameStage nodes={shuffled} onSelectPlate={() => {}} apiBaseUrl="" />);
    assert.match(omittedIdHtml, new RegExp(`data-plate-id="${seeded.t2.plateId}"`));
    assert.doesNotMatch(omittedIdHtml, new RegExp(SCENARIO_BRANCH_WATERMARK));
    const staleIdHtml = renderToStaticMarkup(<PlateFrameStage nodes={shuffled} activePlateId="plate_stale" onSelectPlate={() => {}} apiBaseUrl="" />);
    assert.match(staleIdHtml, new RegExp(`data-plate-id="${seeded.t2.plateId}"`));
    const branchOnlyHtml = renderToStaticMarkup(<PlateFrameStage nodes={[nodes[2]!, nodes[3]!]} onSelectPlate={() => {}} apiBaseUrl="" />);
    assert.match(branchOnlyHtml, new RegExp(`data-plate-id="${seeded.b2.plateId}"`));

    const emptyHtml = renderToStaticMarkup(<PlateFrameStage nodes={[]} onSelectPlate={() => {}} />);
    assert.match(emptyHtml, /data-empty-lineage="true"/);
    assert.doesNotMatch(emptyHtml, /role="tab"/);

    await withWidgetDom(async ({ window: win, container, root }) => {
      const overrides = {
        [seeded.t1.plateId]: "https://cdn.example.com/t1-broken.webp",
        [seeded.t2.plateId]: "https://cdn.example.com/t2-valid.webp",
      };
      await act(async () => {
        root.render(<ControlledStageHarness nodes={shuffled} initialPlateId={seeded.t2.plateId} overrides={overrides} />);
      });

      const getTabs = () => Array.from(container.querySelectorAll('[role="tab"]'));
      assert.deepEqual(getTabs().map((tab) => tab.textContent?.trim()), ["Turn 1", "Turn 2", "Branch · Turn 3", "Branch · Turn 4"]);
      assert.equal(getTabs()[1]?.getAttribute("aria-selected"), "true");
      assert.equal(getTabs()[1]?.getAttribute("tabindex"), "0");
      assert.equal(getTabs()[0]?.getAttribute("tabindex"), "-1");
      assert.match(container.textContent ?? "", new RegExp(CANONICAL_MILESTONE_LABEL));
      assert.equal(container.querySelector("img")?.getAttribute("src"), "https://cdn.example.com/t2-valid.webp");

      const pressKey = async (tabIndex: number, key: string) => {
        await act(async () => {
          getTabs()[tabIndex]!.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
        });
      };

      await pressKey(1, "ArrowRight");
      assert.equal(getTabs()[2]?.getAttribute("aria-selected"), "true");
      assert.equal(win.document.activeElement, getTabs()[2]);
      assert.equal(container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-branch"), "true");
      assert.equal(container.querySelector(".gridlock-status-badge")?.getAttribute("data-tone"), "alert");
      assert.match(container.textContent ?? "", new RegExp(SCENARIO_BRANCH_WATERMARK));

      await pressKey(2, "End");
      assert.equal(getTabs()[3]?.getAttribute("aria-selected"), "true");
      await pressKey(3, "ArrowRight");
      assert.equal(getTabs()[0]?.getAttribute("aria-selected"), "true");
      await pressKey(0, "ArrowLeft");
      assert.equal(getTabs()[3]?.getAttribute("aria-selected"), "true");
      await pressKey(3, "Home");
      assert.equal(getTabs()[0]?.getAttribute("aria-selected"), "true");

      const t1Img = container.querySelector("img")!;
      assert.equal(t1Img.getAttribute("src"), "https://cdn.example.com/t1-broken.webp");
      await act(async () => { t1Img.dispatchEvent(new win.Event("error")); });
      assert.ok(container.querySelector('[data-plate-fallback="true"]'));

      await pressKey(0, "ArrowRight");
      assert.equal(container.querySelector('[data-plate-fallback="true"]'), null);
      assert.equal(container.querySelector("img")?.getAttribute("src"), "https://cdn.example.com/t2-valid.webp");

      await pressKey(1, "ArrowLeft");
      assert.ok(container.querySelector('[data-plate-fallback="true"]'));

      const recoveredOverrides = { ...overrides, [seeded.t1.plateId]: "https://cdn.example.com/t1-recovered.webp" };
      await act(async () => {
        root.render(<ControlledStageHarness nodes={shuffled} initialPlateId={seeded.t2.plateId} overrides={recoveredOverrides} />);
      });
      assert.equal(container.querySelector('[data-plate-fallback="true"]'), null);
      assert.equal(container.querySelector("img")?.getAttribute("src"), "https://cdn.example.com/t1-recovered.webp");

      let singleFrameSelections = 0;
      await act(async () => {
        root.render(<PlateFrameStage nodes={[nodes[0]!]} activePlateId={nodes[0]!.plate.plateId} onSelectPlate={() => { singleFrameSelections += 1; }} />);
      });
      await pressKey(0, "ArrowRight");
      await pressKey(0, "ArrowLeft");
      assert.equal(singleFrameSelections, 0);

      const b1WholeSec: LineageNode = { ...nodes[2]!, plate: { ...nodes[2]!.plate, createdAt: "2026-10-29T11:00:00Z" } };
      const siblingBranch: LineageNode = {
        ...b1WholeSec,
        plate: {
          ...b1WholeSec.plate,
          plateId: "plate_branch_t3_sibling",
          interactionId: "inter_plate_seed_sibling",
          createdAt: "2026-10-29T11:00:00.500Z",
        },
        assetPath: "/api/illustrations/assets/plate_branch_t3_sibling.webp",
      };
      await act(async () => {
        root.render(<PlateFrameStage nodes={[siblingBranch, nodes[0]!, nodes[3]!, nodes[1]!, b1WholeSec]} onSelectPlate={() => {}} />);
      });
      assert.deepEqual(getTabs().map((tab) => tab.textContent?.trim()), [
        "Turn 1", "Turn 2", "Branch 1 · Turn 3", "Branch 2 · Turn 3", "Branch · Turn 4",
      ]);
      assert.equal(container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"), seeded.t2.plateId);
      assert.match(getTabs()[2]?.id ?? "", new RegExp(`${seeded.b1.plateId}$`));
      assert.match(getTabs()[3]?.id ?? "", /plate_branch_t3_sibling$/);
    });
  });
});

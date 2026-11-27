import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL,
  SCENARIO_BRANCH_WATERMARK,
  type FrameTimelineNode,
} from "@samasastudio/gridlock-core";
import { TimelineFrameStage } from "../src/index.ts";
import { extractStylesheetText, withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestFrameTimeline } from "./helpers/timeline-fixtures.ts";

function ControlledStageHarness(props: {
  nodes: readonly FrameTimelineNode[];
  initialIllustrationId: string;
  overrides?: Readonly<Record<string, string>>;
}) {
  const [activeIllustrationId, setActiveIllustrationId] = useState(props.initialIllustrationId);
  return (
    <TimelineFrameStage
      nodes={props.nodes}
      activeIllustrationId={activeIllustrationId}
      onSelectIllustration={setActiveIllustrationId}
      apiBaseUrl="https://api.example.com/"
      assetUrlOverrides={props.overrides}
    />
  );
}

describe("TimelineFrameStage Scrubber (Ticket #34 Phase 1)", () => {
  test("TimelineFrameStage enforces >= 0.75rem floor, sorts shuffled turns, handles roving keyboard focus, badges branches, and recovers from broken WebP URLs", async () => {
    const seeded = await seedTestFrameTimeline();
    const { nodes } = seeded.timeline;
    const shuffled = [nodes[2]!, nodes[0]!, nodes[3]!, nodes[1]!];

    const ssrHtml = renderToStaticMarkup(
      <TimelineFrameStage nodes={shuffled} activeIllustrationId={seeded.t2.illustrationId} onSelectIllustration={() => {}} apiBaseUrl="" />
    );
    const styleCss = extractStylesheetText(ssrHtml);
    const remSizes = Array.from(styleCss.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) => Number(m[1]));
    assert.ok(remSizes.length > 0 && remSizes.every((size) => size >= 0.75));
    assert.doesNotMatch(styleCss, /var\(--(?:card|muted-foreground|border)\b/);
    assert.match(styleCss, /:where\(\.gridlock-dossier-surface,\s*\.gridlock-timeline-stage:not\(\.gridlock-dossier-surface \*\)\)\s*\{[\s\S]*?--gridlock-ink:[\s\S]*?--gridlock-radius:\s*0rem/);
    assert.match(styleCss, /:where\(:is\(\.gridlock-dossier-surface,\s*\.gridlock-timeline-stage\) code\)\s*\{[^}]*font-size:\s*max\(0\.75rem,\s*0\.875em\)/);
    assert.match(styleCss, /:where\(:is\(\.gridlock-dossier-surface,\s*\.gridlock-timeline-stage\) :is\(button, a, input, textarea, select, \[role="button"\], \[tabindex="0"\], summary\)\):focus-visible\s*\{\s*outline:\s*2px solid var\(--gridlock-ink\)/);
    assert.match(styleCss, /:where\(\.gridlock-timeline-stage \.gridlock-status-badge\)\s*\{\s*padding-block:\s*0\.25rem/);
    assert.match(ssrHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.illustrationId}\\.webp"`));

    const blankOverrideFallbackHtml = renderToStaticMarkup(
      <TimelineFrameStage
        nodes={shuffled}
        activeIllustrationId={seeded.t2.illustrationId}
        onSelectIllustration={() => {}}
        assetUrlOverrides={{ [seeded.t2.illustrationId]: "   " }}
      />
    );
    assert.match(blankOverrideFallbackHtml, /data-illustration-fallback="true"/);
    assert.doesNotMatch(blankOverrideFallbackHtml, /src=""/);

    const blankOverrideSameOriginHtml = renderToStaticMarkup(
      <TimelineFrameStage
        nodes={shuffled}
        activeIllustrationId={seeded.t2.illustrationId}
        onSelectIllustration={() => {}}
        apiBaseUrl=""
        assetUrlOverrides={{ [seeded.t2.illustrationId]: "   " }}
      />
    );
    assert.match(blankOverrideSameOriginHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.illustrationId}\\.webp"`));

    const omittedIdHtml = renderToStaticMarkup(<TimelineFrameStage nodes={shuffled} onSelectIllustration={() => {}} apiBaseUrl="" />);
    assert.match(omittedIdHtml, new RegExp(`data-illustration-id="${seeded.t2.illustrationId}"`));
    assert.doesNotMatch(omittedIdHtml, new RegExp(SCENARIO_BRANCH_WATERMARK));
    const staleIdHtml = renderToStaticMarkup(<TimelineFrameStage nodes={shuffled} activeIllustrationId="illustration_stale" onSelectIllustration={() => {}} apiBaseUrl="" />);
    assert.match(staleIdHtml, new RegExp(`data-illustration-id="${seeded.t2.illustrationId}"`));
    const branchOnlyHtml = renderToStaticMarkup(<TimelineFrameStage nodes={[nodes[2]!, nodes[3]!]} onSelectIllustration={() => {}} apiBaseUrl="" />);
    assert.match(branchOnlyHtml, new RegExp(`data-illustration-id="${seeded.b2.illustrationId}"`));

    const emptyHtml = renderToStaticMarkup(<TimelineFrameStage nodes={[]} onSelectIllustration={() => {}} />);
    assert.match(emptyHtml, /data-empty-timeline="true"/);
    assert.match(emptyHtml, /0 Generated Illustrations recorded/);
    assert.doesNotMatch(emptyHtml, /role="tab"/);

    await withWidgetDom(async ({ window: win, container, root }) => {
      const overrides = {
        [seeded.t1.illustrationId]: "https://cdn.example.com/t1-broken.webp",
        [seeded.t2.illustrationId]: "https://cdn.example.com/t2-valid.webp",
      };
      await act(async () => {
        root.render(<ControlledStageHarness nodes={shuffled} initialIllustrationId={seeded.t2.illustrationId} overrides={overrides} />);
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
      assert.equal(container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-branch"), "true");
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
      assert.ok(container.querySelector('[data-illustration-fallback="true"]'));

      await pressKey(0, "ArrowRight");
      assert.equal(container.querySelector('[data-illustration-fallback="true"]'), null);
      assert.equal(container.querySelector("img")?.getAttribute("src"), "https://cdn.example.com/t2-valid.webp");

      await pressKey(1, "ArrowLeft");
      assert.ok(container.querySelector('[data-illustration-fallback="true"]'));

      const recoveredOverrides = { ...overrides, [seeded.t1.illustrationId]: "https://cdn.example.com/t1-recovered.webp" };
      await act(async () => {
        root.render(<ControlledStageHarness nodes={shuffled} initialIllustrationId={seeded.t2.illustrationId} overrides={recoveredOverrides} />);
      });
      assert.equal(container.querySelector('[data-illustration-fallback="true"]'), null);
      assert.equal(container.querySelector("img")?.getAttribute("src"), "https://cdn.example.com/t1-recovered.webp");

      let singleFrameSelections = 0;
      await act(async () => {
        root.render(<TimelineFrameStage nodes={[nodes[0]!]} activeIllustrationId={nodes[0]!.plate.illustrationId} onSelectIllustration={() => { singleFrameSelections += 1; }} />);
      });
      await pressKey(0, "ArrowRight");
      await pressKey(0, "ArrowLeft");
      assert.equal(singleFrameSelections, 0);

      const b1WholeSec: FrameTimelineNode = { ...nodes[2]!, plate: { ...nodes[2]!.plate, createdAt: "2026-10-29T11:00:00Z" } };
      const siblingBranch: FrameTimelineNode = {
        ...b1WholeSec,
        plate: {
          ...b1WholeSec.plate,
          illustrationId: "illustration_branch_t3_sibling",
          interactionId: "inter_timeline_seed_sibling",
          createdAt: "2026-10-29T11:00:00.500Z",
        },
        assetPath: "/api/illustrations/assets/illustration_branch_t3_sibling.webp",
      };
      await act(async () => {
        root.render(<TimelineFrameStage nodes={[siblingBranch, nodes[0]!, nodes[3]!, nodes[1]!, b1WholeSec]} onSelectIllustration={() => {}} />);
      });
      assert.deepEqual(getTabs().map((tab) => tab.textContent?.trim()), [
        "Turn 1", "Turn 2", "Branch 1 · Turn 3", "Branch 2 · Turn 3", "Branch · Turn 4",
      ]);
      assert.equal(container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-illustration-id"), seeded.t2.illustrationId);
      assert.match(getTabs()[2]?.id ?? "", new RegExp(`${seeded.b1.illustrationId}$`));
      assert.match(getTabs()[3]?.id ?? "", /illustration_branch_t3_sibling$/);
    });
  });
});

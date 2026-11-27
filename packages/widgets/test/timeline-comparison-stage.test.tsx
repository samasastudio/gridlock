import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL,
  FrameTimelineResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
} from "@samasastudio/gridlock-core";
import { GridlockTimelineWidget, TimelineFrameStage } from "../src/index.ts";
import { extractStylesheetText, withWidgetDom } from "./helpers/dom-harness.ts";
import {
  buildBranchOnlyTimeline,
  seedTestFrameTimeline,
  seedTurn1ForkTimeline,
} from "./helpers/timeline-fixtures.ts";

function extractRemFontSizes(html: string): number[] {
  const styleBlock = extractStylesheetText(html);
  return Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) => Number(m[1]));
}

describe("TimelineComparisonStage 2-Up Canonical-vs-Branch Controls (Ticket #35 Phase 1)", () => {
  test("SSR toggle visibility, branch-only omission, and diurnal/nocturnal >= 0.75rem typography floor", async () => {
    const seeded = await seedTestFrameTimeline();
    const t1Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.t1.illustrationId)!;
    const t2Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.t2.illustrationId)!;
    const b2Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.b2.illustrationId)!;

    const canonicalHtml = renderToStaticMarkup(
      <GridlockTimelineWidget timeline={seeded.timeline} selectedIllustrationId={seeded.t2.illustrationId} apiBaseUrl="" />
    );
    assert.doesNotMatch(canonicalHtml, /Compare with Canonical/);
    assert.doesNotMatch(canonicalHtml, /data-timeline-comparison="split"/);
    assert.doesNotMatch(canonicalHtml, /data-comparison-slot=/);

    const branchOnlyTimeline = buildBranchOnlyTimeline(
      seeded.timeline,
      seeded.b1.illustrationId,
      seeded.b2.illustrationId
    );

    const branchOnlyWidgetHtml = renderToStaticMarkup(
      <GridlockTimelineWidget timeline={branchOnlyTimeline} selectedIllustrationId={seeded.b1.illustrationId} apiBaseUrl="" />
    );
    assert.match(branchOnlyWidgetHtml, new RegExp(`data-illustration-id="${seeded.b1.illustrationId}"`));
    assert.doesNotMatch(branchOnlyWidgetHtml, /Compare with Canonical/);

    const branchOnlyStageHtml = renderToStaticMarkup(
      <TimelineFrameStage nodes={branchOnlyTimeline.nodes} activeIllustrationId={seeded.b1.illustrationId} onSelectIllustration={() => {}} apiBaseUrl="" />
    );
    assert.match(branchOnlyStageHtml, new RegExp(`data-illustration-id="${seeded.b1.illustrationId}"`));
    assert.doesNotMatch(branchOnlyStageHtml, /Compare with Canonical/);

    const standaloneStageHtml = renderToStaticMarkup(
      <TimelineFrameStage nodes={seeded.timeline.nodes} activeIllustrationId={seeded.b1.illustrationId} onSelectIllustration={() => {}} apiBaseUrl="" />
    );
    assert.match(standaloneStageHtml, /Baseline · Turn 2/);
    assert.match(standaloneStageHtml, new RegExp(`<code>${seeded.t2.illustrationId}</code>`));
    assert.match(standaloneStageHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const standaloneAgedStageHtml = renderToStaticMarkup(
      <TimelineFrameStage nodes={[t1Node, t2Node, b2Node]} activeIllustrationId={seeded.b2.illustrationId} onSelectIllustration={() => {}} apiBaseUrl="" />
    );
    assert.match(standaloneAgedStageHtml, /Baseline · Turn 2/);
    assert.match(standaloneAgedStageHtml, new RegExp(`<code>${seeded.t2.illustrationId}</code>`));
    assert.match(standaloneAgedStageHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const diurnalHtml = renderToStaticMarkup(
      <GridlockTimelineWidget timeline={seeded.timeline} selectedIllustrationId={seeded.b1.illustrationId} theme="diurnal" apiBaseUrl="" />
    );
    const diurnalRemSizes = extractRemFontSizes(diurnalHtml);
    assert.ok(diurnalRemSizes.length > 0 && diurnalRemSizes.every((size) => size >= 0.75));
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(diurnalHtml, /Baseline · Turn 2/);
    assert.match(diurnalHtml, new RegExp(`<code>${seeded.t2.illustrationId}</code>`));
    assert.match(diurnalHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);

    const nocturnalHtml = renderToStaticMarkup(
      <GridlockTimelineWidget timeline={seeded.timeline} selectedIllustrationId={seeded.b1.illustrationId} theme="nocturnal" apiBaseUrl="" />
    );
    const nocturnalRemSizes = extractRemFontSizes(nocturnalHtml);
    assert.ok(nocturnalRemSizes.length > 0 && nocturnalRemSizes.every((size) => size >= 0.75));
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /aria-pressed="false"[^>]*>Compare with Canonical<\/button>/);
  });

  test("Interactive 2-up split, multi-hop canonical walk, isolated pane fallback, and 90d TTL aged-hop fallback", async () => {
    const seeded = await seedTestFrameTimeline();
    const t1Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.t1.illustrationId)!;
    const t2Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.t2.illustrationId)!;
    const b2Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.b2.illustrationId)!;

    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => {
        root.render(<GridlockTimelineWidget timeline={seeded.timeline} initialIllustrationId={seeded.b1.illustrationId} apiBaseUrl="" />);
      });

      const getCompareToggle = () =>
        Array.from(container.querySelectorAll("button")).find((btn) =>
          btn.classList.contains("gridlock-timeline-compare-toggle")
        );
      const getTabButtons = () =>
        Array.from(container.querySelectorAll("button")).filter(
          (btn) => btn.getAttribute("role") === "tab"
        );

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "false");
      assert.equal(container.querySelector('[data-timeline-comparison="split"]'), null);
      assert.equal(container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-comparison-slot"), null);

      await act(async () => {
        getCompareToggle()!.click();
      });

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "true");
      assert.equal(container.querySelector('[data-timeline-comparison="split"]')?.getAttribute("role"), "group");

      const canonicalPane = container.querySelector('[data-comparison-slot="canonical"]')!;
      const branchPane = container.querySelector('[data-comparison-slot="branch"]')!;
      assert.equal(canonicalPane.getAttribute("data-illustration-id"), seeded.t2.illustrationId);
      assert.equal(canonicalPane.getAttribute("data-branch"), "false");
      assert.match(canonicalPane.textContent ?? "", new RegExp(CANONICAL_MILESTONE_LABEL));
      assert.equal(branchPane.getAttribute("data-illustration-id"), seeded.b1.illustrationId);
      assert.equal(branchPane.getAttribute("data-branch"), "true");
      assert.match(branchPane.textContent ?? "", new RegExp(SCENARIO_BRANCH_WATERMARK));

      await act(async () => {
        getTabButtons()[2]!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });

      const multiHopCanonical = container.querySelector('[data-comparison-slot="canonical"]')!;
      const multiHopBranch = container.querySelector('[data-comparison-slot="branch"]')!;
      assert.equal(multiHopCanonical.getAttribute("data-illustration-id"), seeded.t2.illustrationId);
      assert.equal(multiHopBranch.getAttribute("data-illustration-id"), seeded.b2.illustrationId);

      const canonicalImg = multiHopCanonical.querySelector("img")!;
      await act(async () => {
        canonicalImg.dispatchEvent(new win.Event("error"));
      });

      assert.ok(multiHopCanonical.querySelector('[data-illustration-fallback="true"]'));
      assert.equal(multiHopBranch.querySelector('[data-illustration-fallback="true"]'), null);
      assert.equal(multiHopBranch.querySelector("img")?.getAttribute("src"), `/api/illustrations/assets/${seeded.b2.illustrationId}.webp`);

      await act(async () => {
        getTabButtons()[0]!.click();
      });

      assert.equal(container.querySelector('[data-timeline-comparison="split"]'), null);
      assert.equal(getCompareToggle(), undefined);
      assert.equal(container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-illustration-id"), seeded.t1.illustrationId);

      await act(async () => {
        getTabButtons()[2]!.click();
      });
      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "true");

      await act(async () => {
        getCompareToggle()!.click();
      });

      assert.equal(getCompareToggle()?.getAttribute("aria-pressed"), "false");
      assert.equal(container.querySelector('[data-timeline-comparison="split"]'), null);

      const turn1Fork = await seedTurn1ForkTimeline(seeded);
      assert.equal(turn1Fork.timeline.activeCanonicalIllustrationId, seeded.t2.illustrationId);

      const assertTurn1BaselineSplit = async (
        timelineFixture: typeof seeded.timeline,
        branchIllustrationId: string
      ) => {
        await act(async () => {
          root.render(
            <GridlockTimelineWidget
              timeline={timelineFixture}
              initialIllustrationId={branchIllustrationId}
              apiBaseUrl=""
            />
          );
        });

        assert.match(
          container.querySelector(".gridlock-timeline-compare-context")?.textContent ?? "",
          new RegExp(`Baseline · Turn 1 · ${seeded.t1.illustrationId}`)
        );

        await act(async () => {
          getCompareToggle()!.click();
        });

        assert.equal(
          container.querySelector('[data-comparison-slot="canonical"]')?.getAttribute("data-illustration-id"),
          seeded.t1.illustrationId
        );
        assert.equal(
          container.querySelector('[data-comparison-slot="branch"]')?.getAttribute("data-illustration-id"),
          branchIllustrationId
        );
      };

      await assertTurn1BaselineSplit(turn1Fork.timeline, turn1Fork.branchIllustration.illustrationId);

      const agedHopTimeline = FrameTimelineResponseSchema.parse({
        timelineId: seeded.timeline.timelineId,
        activeCanonicalIllustrationId: seeded.t1.illustrationId,
        nodes: [t1Node, t2Node, b2Node],
        edges: [seeded.timeline.edges[0]!],
      });

      await assertTurn1BaselineSplit(agedHopTimeline, seeded.b2.illustrationId);
    });
  });
});

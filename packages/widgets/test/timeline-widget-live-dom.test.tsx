import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, createRef } from "react";
import type { GridlockRepository } from "@samasastudio/gridlock-core";
import { GridlockTimelineWidget, GridlockRepairChangelogWidget } from "../src/index.ts";
import { HealedWithAmortization } from "../stories/GridlockRepairChangelogWidget.stories.tsx";
import { waitForDom, withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestFrameTimeline, withTestTimelineServer } from "./helpers/timeline-fixtures.ts";

describe("<GridlockTimelineWidget /> Client Live Fetch & Retry DOM Lifecycle (Ticket #34 Phase 2)", () => {
  test("Live apiBaseUrl useEffect attaches ref, defaults to inherit theme, recovers in-place on Retry click, and resets on timelineId change", async () => {
    const seeded = await seedTestFrameTimeline();
    let force500 = true;
    let retryCount = 0;

    const flakyRepo: GridlockRepository = {
      ...seeded.repository,
      async listGeneratedIllustrationsByTimeline(timelineId) {
        return force500
          ? ([{ broken: true }] as never)
          : seeded.repository.listGeneratedIllustrationsByTimeline(timelineId);
      },
    };

    await withTestTimelineServer({ repository: flakyRepo }, async (apiBaseUrl) => {
      await withWidgetDom(async ({ container, root }) => {
        const sectionRef = createRef<HTMLElement>();
        const onRetry = () => {
          retryCount += 1;
        };

        await act(async () => {
          root.render(<GridlockTimelineWidget ref={sectionRef} apiBaseUrl={apiBaseUrl} onRetry={onRetry} />);
        });

        assert.equal(sectionRef.current?.tagName, "SECTION");
        assert.equal(sectionRef.current?.getAttribute("data-gridlock-theme"), "inherit");

        await waitForDom(() => container.querySelector('[role="alert"]') !== null);
        const retryBtn = Array.from(container.querySelectorAll("button")).find(
          (btn) => btn.textContent?.trim() === "Retry"
        );
        assert.ok(retryBtn);

        force500 = false;
        await act(async () => {
          retryBtn.click();
        });

        await waitForDom(() => container.querySelector(".gridlock-timeline-viewport") !== null);
        assert.equal(retryCount, 1);
        assert.equal(container.querySelector('[role="alert"]'), null);
        assert.equal(
          container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-illustration-id"),
          seeded.t2.illustrationId
        );
        assert.match(
          container.querySelector(".gridlock-timeline-lead")?.textContent ?? "",
          /250,000 sq ft structural steel erection and chilled-water loop expansion/
        );

        await act(async () => {
          root.render(
            <GridlockTimelineWidget ref={sectionRef} apiBaseUrl={apiBaseUrl} timelineId="unknown-corridor" onRetry={onRetry} />
          );
        });
        await waitForDom(() => container.querySelector('[data-empty-timeline="true"]') !== null);
        assert.ok(container.querySelector('[data-empty-timeline="true"]'));
      });
    });
  });

  test("Live same-origin apiBaseUrl='' without snapshotPromise schedules useEffect fetch and co-mounts cleanly with GridlockRepairChangelogWidget", async () => {
    const seeded = await seedTestFrameTimeline();
    const requestedUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json(seeded.timeline);
    };

    try {
      await withWidgetDom(async ({ window: win, container, root }) => {
        await act(async () => {
          root.render(<GridlockTimelineWidget apiBaseUrl="" />);
        });
        await waitForDom(() => container.querySelector(".gridlock-timeline-viewport") !== null);
        assert.deepEqual(requestedUrls, ["/api/illustrations/timeline"]);
        assert.equal(container.querySelector(".gridlock-timeline-viewport")?.getAttribute("data-illustration-id"), seeded.t2.illustrationId);
        assert.equal(container.querySelector("img")?.getAttribute("src"), `/api/illustrations/assets/${seeded.t2.illustrationId}.webp`);

        await act(async () => {
          root.render(
            <div>
              <GridlockTimelineWidget timeline={seeded.timeline} apiBaseUrl="" />
              <GridlockRepairChangelogWidget {...HealedWithAmortization.args} />
            </div>
          );
        });
        assert.ok(container.querySelector(".gridlock-timeline-tab-indicator") && container.querySelector(".gridlock-tab-indicator"));
        assert.ok(container.querySelector(".gridlock-timeline-specimen") && container.querySelector(".gridlock-specimen-panel"));

        const styles = Array.from(win.document.querySelectorAll("style")).map((s) => s.textContent ?? "");
        const extractRules = (css: string) =>
          new Map(Array.from(css.matchAll(/(:where\([^{]+\))\s*\{([^}]*)\}/g), (m) => [m[1]!.trim(), m[2]!.trim()]));
        const timelineRules = extractRules(styles.find((css) => css.includes(".gridlock-timeline-tab-indicator")) ?? "");
        const repairRules = extractRules(styles.find((css) => css.includes(".gridlock-version-tab")) ?? "");

        assert.match(timelineRules.get(":where(.gridlock-timeline-tab-indicator)") ?? "", /inset-block-end:\s*0;/);
        assert.match(repairRules.get(":where(.gridlock-tab-indicator)") ?? "", /inset-block-end:\s*-0\.55rem;/);
        assert.match(timelineRules.get(":where(.gridlock-timeline-specimen)") ?? "", /padding-block-start:\s*0\.25rem;/);
        assert.match(repairRules.get(":where(.gridlock-specimen-panel)") ?? "", /padding-block-start:\s*1\.25rem;/);
        for (const [selector, timelineBody] of timelineRules) {
          if (repairRules.has(selector)) assert.equal(timelineBody, repairRules.get(selector), `Conflicting rule on ${selector}`);
        }
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

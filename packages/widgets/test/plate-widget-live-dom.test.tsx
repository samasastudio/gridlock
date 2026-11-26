import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, createRef } from "react";
import type { GridlockRepository } from "@samasastudio/gridlock-core";
import { GridlockPlateWidget, GridlockRepairChangelogWidget } from "../src/index.ts";
import { HealedWithAmortization } from "../stories/GridlockRepairChangelogWidget.stories.tsx";
import { waitForDom, withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestPlateLineage, withTestPlatesServer } from "./helpers/plate-fixtures.ts";

describe("<GridlockPlateWidget /> Client Live Fetch & Retry DOM Lifecycle (Ticket #34 Phase 2)", () => {
  test("Live apiBaseUrl useEffect attaches ref, defaults to inherit theme, recovers in-place on Retry click, and resets on timelineId change", async () => {
    const seeded = await seedTestPlateLineage();
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

    await withTestPlatesServer({ repository: flakyRepo }, async (apiBaseUrl) => {
      await withWidgetDom(async ({ container, root }) => {
        const sectionRef = createRef<HTMLElement>();
        const onRetry = () => {
          retryCount += 1;
        };

        await act(async () => {
          root.render(<GridlockPlateWidget ref={sectionRef} apiBaseUrl={apiBaseUrl} onRetry={onRetry} />);
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

        await waitForDom(() => container.querySelector(".gridlock-plate-viewport") !== null);
        assert.equal(retryCount, 1);
        assert.equal(container.querySelector('[role="alert"]'), null);
        assert.equal(
          container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"),
          seeded.t2.illustrationId
        );
        assert.match(
          container.querySelector(".gridlock-plate-lead")?.textContent ?? "",
          /250,000 sq ft structural steel erection and chilled-water loop expansion/
        );

        await act(async () => {
          root.render(
            <GridlockPlateWidget ref={sectionRef} apiBaseUrl={apiBaseUrl} timelineId="unknown-corridor" onRetry={onRetry} />
          );
        });
        await waitForDom(() => container.querySelector('[data-empty-lineage="true"]') !== null);
        assert.ok(container.querySelector('[data-empty-lineage="true"]'));
      });
    });
  });

  test("Live same-origin apiBaseUrl='' without snapshotPromise schedules useEffect fetch and co-mounts cleanly with GridlockRepairChangelogWidget", async () => {
    const seeded = await seedTestPlateLineage();
    const requestedUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json(seeded.lineage);
    };

    try {
      await withWidgetDom(async ({ window: win, container, root }) => {
        await act(async () => {
          root.render(<GridlockPlateWidget apiBaseUrl="" />);
        });
        await waitForDom(() => container.querySelector(".gridlock-plate-viewport") !== null);
        assert.deepEqual(requestedUrls, ["/api/illustrations/timeline"]);
        assert.equal(container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"), seeded.t2.illustrationId);
        assert.equal(container.querySelector("img")?.getAttribute("src"), `/api/illustrations/assets/${seeded.t2.illustrationId}.webp`);

        await act(async () => {
          root.render(
            <div>
              <GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl="" />
              <GridlockRepairChangelogWidget {...HealedWithAmortization.args} />
            </div>
          );
        });
        assert.ok(container.querySelector(".gridlock-plate-tab-indicator") && container.querySelector(".gridlock-tab-indicator"));
        assert.ok(container.querySelector(".gridlock-plate-specimen") && container.querySelector(".gridlock-specimen-panel"));

        const styles = Array.from(win.document.querySelectorAll("style")).map((s) => s.textContent ?? "");
        const extractRules = (css: string) =>
          new Map(Array.from(css.matchAll(/(:where\([^{]+\))\s*\{([^}]*)\}/g), (m) => [m[1]!.trim(), m[2]!.trim()]));
        const plateRules = extractRules(styles.find((css) => css.includes(".gridlock-plate-tab-indicator")) ?? "");
        const repairRules = extractRules(styles.find((css) => css.includes(".gridlock-version-tab")) ?? "");

        assert.match(plateRules.get(":where(.gridlock-plate-tab-indicator)") ?? "", /inset-block-end:\s*0;/);
        assert.match(repairRules.get(":where(.gridlock-tab-indicator)") ?? "", /inset-block-end:\s*-0\.55rem;/);
        assert.match(plateRules.get(":where(.gridlock-plate-specimen)") ?? "", /padding-block-start:\s*0\.25rem;/);
        assert.match(repairRules.get(":where(.gridlock-specimen-panel)") ?? "", /padding-block-start:\s*1\.25rem;/);
        for (const [selector, plateBody] of plateRules) {
          if (repairRules.has(selector)) assert.equal(plateBody, repairRules.get(selector), `Conflicting rule on ${selector}`);
        }
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

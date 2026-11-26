import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlateLineageResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
} from "@samasastudio/gridlock-core";
import { GridlockPlateWidget } from "../src/index.ts";
import { setTextareaValue, waitForDom, withWidgetDom } from "./helpers/dom-harness.ts";
import {
  createGatedGeminiClient,
  seedTestPlateLineage,
  withTestPlatesServer,
} from "./helpers/plate-fixtures.ts";

type WidgetContainer = Parameters<Parameters<typeof withWidgetDom>[0]>[0]["container"];

function readPlateTabs(container: WidgetContainer) {
  return Array.from(container.querySelectorAll("button")).filter(
    (btn) => btn.getAttribute("role") === "tab"
  );
}

function readPlateKpis(container: WidgetContainer): number[] {
  return Array.from(container.querySelectorAll(".gridlock-kpi-value [aria-label]"), (el) =>
    Number(el.getAttribute("aria-label"))
  );
}

describe("<GridlockPlateWidget /> Scenario Branch Submission & Auto-Compare (Ticket #35)", () => {
  test("Omits Scenario Branch form in static snapshots and 0-plate empty lineages", async () => {
    const seeded = await seedTestPlateLineage();
    const emptyLineage = PlateLineageResponseSchema.parse({
      timelineId: "empty-corridor",
      activeCanonicalPlateId: null,
      nodes: [],
      edges: [],
    });

    const staticHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={seeded.lineage} />
    );
    assert.doesNotMatch(staticHtml, /<form[^>]*class="gridlock-plate-branch-section"/);
    assert.doesNotMatch(staticHtml, /<textarea/);

    const emptyLiveHtml = renderToStaticMarkup(
      <GridlockPlateWidget lineage={emptyLineage} apiBaseUrl="" />
    );
    assert.doesNotMatch(emptyLiveHtml, /<form[^>]*class="gridlock-plate-branch-section"/);
    assert.doesNotMatch(emptyLiveHtml, /<textarea/);
  });

  test("Locks concurrent 201 submit, pins Forking Turn label on tab switch, and auto-activates 2-up comparison", async () => {
    const seeded = await seedTestPlateLineage();
    const { gate, geminiClient } = createGatedGeminiClient();

    await withTestPlatesServer(
      { repository: seeded.repository, geminiClient },
      async (apiBaseUrl) => {
        await withWidgetDom(async ({ window: win, container, root }) => {
          await act(async () => {
            root.render(<GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl={apiBaseUrl} />);
          });

          const getForm = () => container.querySelector("form")!;
          const getTextarea = () => container.querySelector("textarea")!;
          const getSubmit = () =>
            Array.from(container.querySelectorAll("button")).find((btn) => btn.type === "submit")!;

          assert.equal(getSubmit().disabled, true);

          await act(async () => {
            setTextareaValue(win, getTextarea(), "   ");
          });
          assert.equal(getSubmit().disabled, true);

          await act(async () => {
            setTextareaValue(
              win,
              getTextarea(),
              "Simulate 500MW battery buffer at Navarro substation"
            );
          });
          assert.equal(getSubmit().disabled, false);

          await act(async () => {
            getForm().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
            getForm().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
          });

          await waitForDom(() => gate.release !== null);
          assert.equal(gate.calls, 1);
          assert.equal(getForm().getAttribute("aria-busy"), "true");
          assert.equal(getTextarea().disabled, true);
          assert.equal(getSubmit().disabled, true);
          assert.equal(getSubmit().textContent, "Painting Scenario Branch…");

          await act(async () => {
            readPlateTabs(container)[0]!.click();
          });
          assert.equal(
            container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"),
            seeded.t1.plateId
          );
          assert.equal(
            container.querySelector(".gridlock-plate-branch-target")?.textContent,
            `Forking Turn 2 · ${seeded.t2.interactionId}`
          );

          await act(async () => {
            gate.release?.();
          });

          await waitForDom(
            () => container.querySelector('[data-plate-comparison="split"]') !== null
          );
          assert.deepEqual(readPlateKpis(container), [2, 3, 2]);
          assert.equal(readPlateTabs(container).length, 5);
          assert.equal(getTextarea().value, "");
          assert.equal(
            container.querySelector(".gridlock-plate-compare-toggle")?.getAttribute("aria-pressed"),
            "true"
          );
          assert.equal(
            container.querySelector('[data-comparison-slot="canonical"]')?.getAttribute("data-plate-id"),
            seeded.t2.plateId
          );
          assert.match(
            container.querySelector('[data-comparison-slot="branch"]')?.textContent ?? "",
            new RegExp(SCENARIO_BRANCH_WATERMARK)
          );
          assert.equal(container.querySelectorAll(".gridlock-provenance-hops li").length, 3);

          await act(async () => {
            root.render(
              <GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl="http://127.0.0.1:1" />
            );
          });
          assert.equal(readPlateTabs(container).length, 4);
          assert.deepEqual(readPlateKpis(container), [2, 2, 2]);
          assert.equal(container.querySelector('[data-plate-comparison="split"]'), null);

          await act(async () => {
            root.render(<GridlockPlateWidget lineage={seeded.lineage} />);
          });
          assert.equal(readPlateTabs(container).length, 4);
          assert.deepEqual(readPlateKpis(container), [2, 2, 2]);
          assert.equal(container.querySelector("form"), null);
        });
      }
    );
  });

  test("Submits 201 branch in pure live-fetch mode and resets local branches when apiBaseUrl changes", async () => {
    const primarySeeded = await seedTestPlateLineage();
    const secondarySeeded = await seedTestPlateLineage();

    await withTestPlatesServer(
      { repository: primarySeeded.repository, geminiClient: primarySeeded.geminiClient },
      async (primaryUrl) => {
        await withTestPlatesServer(
          { repository: secondarySeeded.repository, geminiClient: secondarySeeded.geminiClient },
          async (secondaryUrl) => {
            await withWidgetDom(async ({ window: win, container, root }) => {
              await act(async () => {
                root.render(<GridlockPlateWidget apiBaseUrl={primaryUrl} />);
              });

              await waitForDom(() => container.querySelector("form") !== null);

              await act(async () => {
                setTextareaValue(
                  win,
                  container.querySelector("textarea")!,
                  "Simulate pure live-fetch 345kV interconnect"
                );
              });

              await act(async () => {
                container
                  .querySelector("form")!
                  .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
              });

              await waitForDom(
                () => container.querySelector('[data-plate-comparison="split"]') !== null
              );
              assert.equal(readPlateTabs(container).length, 5);
              assert.deepEqual(readPlateKpis(container), [2, 3, 2]);

              await act(async () => {
                root.render(<GridlockPlateWidget apiBaseUrl={secondaryUrl} />);
              });

              await waitForDom(() => readPlateTabs(container).length === 4);
              assert.deepEqual(readPlateKpis(container), [2, 2, 2]);
              assert.equal(container.querySelector('[data-plate-comparison="split"]'), null);
            });
          }
        );
      }
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react";
import type { GridlockRepository } from "@samasastudio/gridlock-core";
import { GridlockPlateWidget } from "../src/index.ts";
import { setTextareaValue, waitForDom, withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestPlateLineage, withTestPlatesServer } from "./helpers/plate-fixtures.ts";

describe("<GridlockPlateWidget /> Scenario Branch Mineral Error Alerts (Ticket #35)", () => {
  test("Surfaces visible 400/429/404/500/network alert copy, preserves canonical selection, and clears stale alerts", async () => {
    const seeded = await seedTestPlateLineage();
    const sim = {
      missingParent: false,
      fail500: false,
    };

    const repository: GridlockRepository = {
      ...seeded.repository,
      async getVisualPlateByInteractionId(interactionId) {
        return sim.missingParent
          ? null
          : seeded.repository.getVisualPlateByInteractionId(interactionId);
      },
      async listVisualPlatesByLineage(lineageId) {
        return sim.fail500
          ? ([{ broken: true }] as never)
          : seeded.repository.listVisualPlatesByLineage(lineageId);
      },
    };

    await withTestPlatesServer(
      { repository, maxBranchesPerLineage: 2 },
      async (apiBaseUrl) => {
        await withWidgetDom(async ({ window: win, container, root }) => {
          await act(async () => {
            root.render(<GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl={apiBaseUrl} />);
          });

          const getForm = () => container.querySelector("form")!;
          const getTextarea = () => container.querySelector("textarea")!;
          const getCounter = () => container.querySelector(".gridlock-plate-branch-counter")!;
          const getTabs = () =>
            Array.from(container.querySelectorAll("button")).filter(
              (btn) => btn.getAttribute("role") === "tab"
            );

          const typePrompt = async (value: string) => {
            await act(async () => {
              setTextareaValue(win, getTextarea(), value);
            });
          };
          const submitBranch = async () => {
            await act(async () => {
              getForm().dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
            });
          };

          const assertFailureState = (expected: {
            status: string;
            prefix: string;
            detail: RegExp;
            draft: string;
            ariaInvalid: "true" | "false";
          }) => {
            const alertEl = container.querySelector('[role="alert"]')!;
            const textarea = getTextarea();
            const counterId = getCounter().id;

            assert.equal(alertEl.getAttribute("data-error-status"), expected.status);
            assert.ok(alertEl.id.endsWith("-branch-alert"));
            assert.ok((alertEl.textContent ?? "").includes(expected.prefix));
            assert.match(alertEl.textContent ?? "", expected.detail);
            assert.equal(
              container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"),
              seeded.t2.plateId
            );
            assert.equal(textarea.value, expected.draft);
            assert.equal(textarea.getAttribute("aria-invalid"), expected.ariaInvalid);
            assert.equal(textarea.getAttribute("aria-describedby"), `${counterId} ${alertEl.id}`);
          };

          const overLimit = "x".repeat(1005);
          await typePrompt(overLimit);
          assert.equal(getCounter().getAttribute("data-over-limit"), "true");
          assert.equal(getCounter().textContent, "1,005 / 1,000 chars");

          await submitBranch();
          await waitForDom(() => container.querySelector('[data-error-status="400"]') !== null);
          assertFailureState({
            status: "400",
            prefix: "Invalid scenario prompt (HTTP 400):",
            detail: /scenarioPrompt:/,
            draft: overLimit,
            ariaInvalid: "true",
          });

          const validDraft = "Reroute 345kV double-circuit corridor";
          await typePrompt(validDraft);
          assert.equal(container.querySelector('[role="alert"]'), null);
          assert.equal(getTextarea().getAttribute("aria-describedby"), getCounter().id);

          await submitBranch();
          await waitForDom(() => container.querySelector('[data-error-status="429"]') !== null);
          assertFailureState({
            status: "429",
            prefix: "Scenario Branch quota reached (HTTP 429):",
            detail: /Branch quota exceeded for lineage/,
            draft: validDraft,
            ariaInvalid: "false",
          });

          sim.missingParent = true;
          await submitBranch();
          await waitForDom(() => container.querySelector('[data-error-status="404"]') !== null);
          assertFailureState({
            status: "404",
            prefix: "Parent plate unavailable (HTTP 404):",
            detail: /Unknown or expired parent interactionId/,
            draft: validDraft,
            ariaInvalid: "false",
          });
          sim.missingParent = false;

          sim.fail500 = true;
          await submitBranch();
          await waitForDom(() => container.querySelector('[data-error-status="500"]') !== null);
          assertFailureState({
            status: "500",
            prefix: "Stateful Painter unavailable (HTTP 500):",
            detail: /Stored VisualPlate lineage record failed runtime schema validation/,
            draft: validDraft,
            ariaInvalid: "false",
          });
          sim.fail500 = false;

          await act(async () => {
            root.render(
              <GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl="http://127.0.0.1:1" />
            );
          });
          assert.equal(container.querySelector('[role="alert"]'), null);
          assert.equal(getTextarea().getAttribute("aria-describedby"), getCounter().id);

          await submitBranch();
          await waitForDom(() => container.querySelector('[data-error-status="network"]') !== null);
          assertFailureState({
            status: "network",
            prefix: "Scenario Branch request failed:",
            detail: /fetch failed|ECONNREFUSED/i,
            draft: validDraft,
            ariaInvalid: "false",
          });

          await act(async () => {
            getTabs()[0]!.click();
          });
          assert.equal(container.querySelector('[role="alert"]'), null);
        });
      }
    );
  });
});

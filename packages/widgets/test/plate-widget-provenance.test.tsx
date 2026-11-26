import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react";
import { PlateLineageResponseSchema } from "@samasastudio/gridlock-core";
import { GridlockPlateWidget } from "../src/index.ts";
import { withWidgetDom } from "./helpers/dom-harness.ts";
import { seedTestPlateLineage } from "./helpers/plate-fixtures.ts";

describe("<GridlockPlateWidget /> Citations & Ancestor Provenance Walk (Ticket #34)", () => {
  test("Interactive DOM: copies SHA-256 citations, resets disclosures across scrubbing, walks 4-hop chain, jumps to ancestor, and flags TTL-aged parents", async () => {
    const seeded = await seedTestPlateLineage();

    await withWidgetDom(async ({ window: win, container, root, getLastCopiedText }) => {
      await act(async () => {
        root.render(<GridlockPlateWidget lineage={seeded.lineage} apiBaseUrl="" />);
      });

      assert.equal(container.querySelector("section")?.getAttribute("data-gridlock-theme"), "inherit");
      assert.match(
        container.querySelector(".gridlock-plate-lead")?.textContent ?? "",
        /250,000 sq ft structural steel erection and chilled-water loop expansion/
      );
      const hydratedLink = container.querySelector(".gridlock-citation-link");
      assert.equal(hydratedLink?.getAttribute("href"), `https://www.tdlr.texas.gov/TABS/Search/Project/${seeded.h2.slice(0, 8)}`);
      assert.equal(hydratedLink?.getAttribute("target"), "_blank");
      assert.match(container.textContent ?? "", /90d TTL archived/);

      const citationChips = Array.from(
        container.querySelector(".gridlock-citations-row")?.querySelectorAll("button") ?? []
      );
      assert.equal(citationChips.length, 2);
      await act(async () => {
        citationChips[0]!.click();
      });
      assert.equal(getLastCopiedText(), seeded.h2);
      assert.equal(citationChips[0]!.getAttribute("data-copied"), "true");

      const t2Details = container.querySelector("details.gridlock-plate-disclosure") as HTMLDetailsElement | null;
      assert.ok(t2Details);
      assert.equal(t2Details.open, false);
      t2Details.open = true;
      assert.equal(t2Details.open, true);

      const pressArrowRight = async () => {
        const selectedTab = container.querySelector('[role="tab"][aria-selected="true"]')!;
        await act(async () => {
          selectedTab.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
      };

      await pressArrowRight();
      assert.equal(container.querySelector("details")?.open, false);
      assert.match(
        container.querySelector(".gridlock-plate-lead")?.textContent ?? "",
        /Simulate \+400MW ERCOT substation interconnection delay/
      );
      await pressArrowRight();

      const b2Details = container.querySelector("details")!;
      assert.equal(b2Details.open, false);
      assert.match(
        container.querySelector(".gridlock-plate-lead")?.textContent ?? "",
        /Model dual-feed 345kV transmission reroute around Ellis County/
      );
      const b2CitationChip = container.querySelector(".gridlock-citations-row button")!;
      assert.equal(b2CitationChip.getAttribute("data-copied"), "false");

      b2Details.open = true;
      const hopItems = Array.from(container.querySelectorAll(".gridlock-provenance-hops > li"));
      assert.equal(hopItems.length, 4);
      assert.equal(hopItems[3]?.getAttribute("aria-current"), "step");
      assert.match(hopItems[3]?.textContent ?? "", new RegExp(`← parent ${seeded.b1.interactionId}`));
      assert.match(hopItems[3]?.textContent ?? "", /re-bootstrapped from parent WebP/);

      const metaChips = Array.from(
        container.querySelector(".gridlock-provenance-meta")?.querySelectorAll("button") ?? []
      );
      await act(async () => {
        metaChips[1]!.click();
      });
      assert.equal(getLastCopiedText(), seeded.b2.sha256);

      const turn1HopBtn = container.querySelector(".gridlock-provenance-hops")?.querySelector("button")!;
      assert.match(turn1HopBtn.textContent ?? "", /^Turn 1 · /);
      await act(async () => {
        turn1HopBtn.click();
      });
      assert.equal(
        container.querySelector(".gridlock-plate-viewport")?.getAttribute("data-plate-id"),
        seeded.t1.plateId
      );
      assert.match(
        container.querySelector(".gridlock-plate-lead")?.textContent ?? "",
        /250,000 sq ft hyperscale data center hall and 345kV substation yard/
      );

      const agedOutParentLineage = PlateLineageResponseSchema.parse({
        timelineId: seeded.lineage.timelineId,
        activeCanonicalPlateId: seeded.t1.plateId,
        nodes: [
          seeded.lineage.nodes.find((n) => n.plate.plateId === seeded.t1.plateId)!,
          seeded.lineage.nodes.find((n) => n.plate.plateId === seeded.b2.plateId)!,
        ],
        edges: [],
      });
      await act(async () => {
        root.render(<GridlockPlateWidget lineage={agedOutParentLineage} selectedPlateId={seeded.b2.plateId} apiBaseUrl="" />);
      });
      assert.match(container.textContent ?? "", /parent aged past 90d TTL/);
    });
  });
});

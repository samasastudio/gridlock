import type { AddressInfo } from "node:net";
import { act } from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CandidateSelectorPatchSchema,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  ingestTdlrFiling,
  runOutOfBandRepairAgent,
} from "@samasastudio/gridlock-core";
import { CopyCitationButton, fetchRepairLogSnapshot, GridlockRepairLogWidget } from "../src/index.ts";
import { HealedWithAmortization } from "../stories/GridlockRepairLogWidget.stories.tsx";
import { withWidgetDom } from "./helpers/dom-harness.ts";

const HISTORICAL_HTML = `<div class="project-details"><dl class="dl-horizontal">
  <dt>Project Name:</dt><dd>Compass Datacenters - Building 10</dd><dt>Project Number:</dt><dd>TABS2027003697</dd>
  <dt>Facility Name:</dt><dd>DFWIII - Building 10</dd><dt>Owner Name:</dt><dd>COMPASS DATACENTERS LLC</dd>
  <dt>Location Address:</dt><dd>590 Austin Blvd</dd><dd>Red Oak, TX 75154</dd><dt>Location County:</dt><dd>Ellis</dd>
  <dt>Start Date:</dt><dd>12/1/2024</dd><dt>Completion Date:</dt><dd>8/22/2028</dd><dt>Estimated Cost:</dt><dd>$100,000,000</dd>
  <dt>Type of Work:</dt><dd>New Construction</dd><dt>Scope of Work:</dt><dd>251,815 sq ft Data Center</dd>
  <dt>Square Footage:</dt><dd>251,815</dd><dt>Current Status:</dt><dd>Project Registered</dd>
</dl></div>`;

const MUTATED_HTML = HISTORICAL_HTML
  .replace('class="project-details"', 'class="tabs-project-details-v2"')
  .replace("Estimated Cost:", "Total Estimated Cost:")
  .replace("TABS2027003697", "TABS2027009888");

describe("<GridlockRepairLogWidget /> Timeline, Live Core Pipeline & Interactive DOM (Ticket #27)", () => {
  test("Core ingestTdlrFiling + runOutOfBandRepairAgent -> HTTP -> Widget pipeline renders interactive repair_agent marker", async () => {
    const repository = createInMemoryGridlockRepository();
    const okIngest = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl: "https://portal.example", robotsTxt: "User-agent: *\nAllow: /\n", now: new Date("2026-10-26T12:00:00.000Z") },
      { repository, pageLoader: async (url) => ({ status: 200, url, contentType: "text/html", body: HISTORICAL_HTML }) }
    );
    assert.equal(okIngest.status, "ingested");

    const anomaly = await ingestTdlrFiling(
      { projectNumber: "TABS2027009888", baseUrl: "https://portal.example", robotsTxt: "User-agent: *\nAllow: /\n", now: new Date("2026-10-27T14:00:00.000Z") },
      { repository, pageLoader: async (url) => ({ status: 200, url, contentType: "text/html", body: MUTATED_HTML }) }
    );
    assert.equal(anomaly.status, "selector_anomaly");

    const patch = CandidateSelectorPatchSchema.parse({
      detailContainerSelector: ".project-details, .tabs-project-details-v2",
      fieldLabels: { estimatedCost: "Estimated Cost: | Total Estimated Cost:" },
      rootCauseSummary: "TDLR wrapped attributes in .tabs-project-details-v2 and relabeled Total Estimated Cost:.",
    });
    const repair = await runOutOfBandRepairAgent(
      {
        connectorId: "tdlr-tabs",
        quarantinedArtifact: anomaly.sourceArtifact,
        brokenInvariants: anomaly.invariantErrors,
        historicalFixtures: [HISTORICAL_HTML],
        anomalyDetectedAt: new Date("2026-10-27T14:00:00.000Z"),
        now: new Date("2026-10-27T14:00:01.850Z"),
      },
      {
        repository,
        geminiClient: {
          interactions: {
            create: async () => ({ id: "inter_live_heal_v2", status: "completed", output_text: JSON.stringify(patch), usage: { total_tokens: 390 } }),
          },
        },
      }
    );
    assert.equal(repair.status, "repair_promoted");

    const server = createGridlockHttpServer({ repository });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const apiBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const snap = await fetchRepairLogSnapshot({ apiBaseUrl });
      assert.equal(snap.ok, true);
      const html = renderToStaticMarkup(
        <GridlockRepairLogWidget changelog={snap.changelog} efficiencyLedger={snap.efficiencyLedger} apiBaseUrl={apiBaseUrl} />
      );
      assert.match(html, /<rect[^>]*role="button"[^>]*aria-pressed="true"[^>]*aria-label="Inspect Out-of-Band Repair v1 → v2 \(2026-10-27\)"/);
      assert.match(html, /Copy Interaction ID inter_live_heal_v2/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test("Headless DOM: ArrowLeft/Home/End tabs, SVG chart marker click, collapsed <details> reset, and citation copy reset", async () => {
    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => { root.render(<GridlockRepairLogWidget {...HealedWithAmortization.args} />); });
      const getTabs = () => Array.from(container.querySelectorAll('[role="tab"]'));
      const getMarkers = () => Array.from(container.querySelectorAll('rect[role="button"]'));
      const getShaAria = () => container.querySelector(".gridlock-inline-meta .gridlock-copy-chip")?.getAttribute("aria-label") ?? "";
      assert.equal(getTabs()[1]?.getAttribute("aria-selected"), "true");
      assert.equal(getMarkers()[1]?.getAttribute("aria-pressed"), "true");
      assert.match(getShaAria(), /sha256:cccccccccccc/);

      const initialDetails = container.querySelector("details")!;
      assert.equal(initialDetails.open, false);
      initialDetails.open = true;
      assert.equal(initialDetails.hasAttribute("open"), true);
      const shaChip = container.querySelector(".gridlock-inline-meta .gridlock-copy-chip")!;
      await act(async () => { shaChip.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); });
      assert.equal(shaChip.getAttribute("data-copied"), "true");

      await act(async () => {
        getTabs()[1]!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      });
      assert.equal(getTabs()[0]?.getAttribute("aria-selected"), "true");
      assert.equal(getMarkers()[0]?.getAttribute("aria-pressed"), "true");
      assert.match(getShaAria(), /sha256:bbbbbbbbbbbb/);
      assert.equal(container.querySelector("details")!.open, false);
      assert.equal(container.querySelector(".gridlock-inline-meta .gridlock-copy-chip")?.getAttribute("data-copied"), "false");

      await act(async () => { getTabs()[0]!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "End", bubbles: true })); });
      assert.equal(getTabs()[1]?.getAttribute("aria-selected"), "true");
      await act(async () => { getTabs()[1]!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
      assert.equal(getTabs()[0]?.getAttribute("aria-selected"), "true");

      await act(async () => { getMarkers()[1]!.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); });
      assert.equal(getMarkers()[1]?.getAttribute("aria-pressed"), "true");
      assert.match(getShaAria(), /sha256:cccccccccccc/);
    });
  });

  test("CopyCitationButton resets copied state immediately when citation value changes in headless DOM", async () => {
    const hadWindowBefore = "window" in globalThis;
    const navDescBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    await withWidgetDom(async ({ container, root, getLastCopiedText }) => {
      await act(async () => { root.render(<CopyCitationButton value="sha_alpha" displayLabel="sha256:alpha" citationKind="Source Artifact SHA-256" />); });
      const btn = container.querySelector("button")!;
      await act(async () => { btn.click(); });
      assert.equal(getLastCopiedText(), "sha_alpha");
      assert.equal(btn.getAttribute("data-copied"), "true");
      await act(async () => { root.render(<CopyCitationButton value="sha_beta" displayLabel="sha256:beta" citationKind="Source Artifact SHA-256" />); });
      assert.equal(btn.getAttribute("data-copied"), "false");
      assert.match(btn.getAttribute("aria-label") ?? "", /Copy Source Artifact SHA-256 sha256:beta/);
    });
    assert.equal("window" in globalThis, hadWindowBefore);
    assert.equal(typeof Object.getOwnPropertyDescriptor(globalThis, "navigator")?.get, typeof navDescBefore?.get);
  });
});

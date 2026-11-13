import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { act, createRef } from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { createGridlockHttpServer, createInMemoryGridlockRepository, DEFAULT_EFFICIENCY_LEDGER, DEFAULT_TDLR_CONNECTOR_CONFIG, type GridlockRepository } from "@samasastudio/gridlock-core";
import {
  buildRepairChangelogUrl,
  ConnectorStatusBadge,
  CopyCitationButton,
  DossierStatusBadge,
  EDITORIAL_EASE,
  fetchRepairLogSnapshot,
  GridlockRepairLogWidget,
  useIsReducedMotion,
} from "../src/index.ts";
import repairLogWidgetMeta, * as repairLogStories from "../stories/GridlockRepairLogWidget.stories.tsx";

const { BlockedByWafDegraded, HealedWithAmortization, HealthyZeroAnomalies, NocturnalTheme, SelectorAnomalyDegraded } = repairLogStories;

async function streamHtml(node: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

describe("<GridlockRepairLogWidget /> Seam 2 UI (Ticket #6)", () => {
  test("Browser-safe runtime boundary: widget barrel and CSF3 stories load zero node:* built-in modules at runtime", () => {
    const checkScript = `
      import { registerHooks } from "node:module";
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith("node:")) throw new Error("Browser-unsafe import: " + specifier);
          return nextResolve(specifier, context);
        },
      });
      await import("./packages/widgets/src/index.ts");
      await import("./packages/widgets/stories/GridlockRepairLogWidget.stories.tsx");
    `;
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["--import", "./scripts/tsx-loader.mjs", "--input-type=module", "-e", checkScript], {
        encoding: "utf-8",
      });
    });
    assert.equal(typeof useIsReducedMotion, "function");
    assert.equal(EDITORIAL_EASE.length, 4);
  });

  test("Happy Path & Zero-Anomaly State: renders 100% deterministic uptime when empty, derives static export connectorId, and renders Repair Changelog + Efficiency Ledger across diurnal/nocturnal/inherit tokens", () => {
    const emptyHtml = renderToStaticMarkup(
      <GridlockRepairLogWidget
        changelog={{ connectorId: "ercot-gis", connectorStatus: "healthy", activeVersion: 1, entries: [] }}
        efficiencyLedger={HealthyZeroAnomalies.args.efficiencyLedger!}
        apiBaseUrl="https://api.example.com"
      />
    );
    assert.match(emptyHtml, /100% deterministic uptime/i);
    assert.match(emptyHtml, /href="https:\/\/api\.example\.com\/api\/repairs\/changelog\?connector_id=ercot-gis&amp;format=md"/);

    const sectionRef = createRef<HTMLElement>();
    const diurnalHtml = renderToStaticMarkup(<GridlockRepairLogWidget ref={sectionRef} {...HealedWithAmortization.args} />);
    assert.doesNotMatch(diurnalHtml, /gridlock-diff-table thead\)\s*\{\s*display:\s*none/);
    for (const pattern of [
      /<section[^>]*class="[^"]*\bgridlock-dossier-surface\b[^"]*\bgridlock-repair-widget\b"/,
      /data-gridlock-theme="diurnal"/, /var\(--font-sans/, /--paper:\s*var\(--atlas-paper/, /--ink:\s*var\(--atlas-ink/,
      /--gridlock-card:\s*var\(--card,\s*color-mix\(in oklab,\s*var\(--gridlock-paper\)\s*92%,\s*var\(--gridlock-ink\)\)\)/,
      /--gridlock-muted:\s*var\(--muted-foreground,\s*color-mix\(in oklab,\s*var\(--gridlock-ink\)\s*68%,\s*var\(--gridlock-paper\)\)\)/,
      /--relief-coral-mid/, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--gridlock-ink\)/,
      /<ol[^>]*role="list"/, /<time[^>]*dateTime="2026-10-27T14:00:01\.850Z"/,
      /v1.*v2/, /1,850 ms/, /14.*deterministic runs served/i, /1\/1.*2 total verified/,
      /sha256:bbbbbbbbbbbb/, /\.tabs-project-details-v2/, /Total Estimated Cost:/, /<details/, /<table/,
      /<caption/, /<th[^>]*scope="col"/, /<th[^>]*scope="row"/, /number-section-integer/, /380/, /99\.89%/, /93\.33%/,
    ]) {
      assert.match(diurnalHtml, pattern);
    }

    const nocturnalHtml = renderToStaticMarkup(<GridlockRepairLogWidget {...NocturnalTheme.args} />);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /color-scheme:\s*only dark/);
    assert.match(nocturnalHtml, /--paper:\s*var\(--terrain-estuary,\s*oklch\(0\.215 0\.026 244\)\)/);
    assert.match(nocturnalHtml, /data-citation-transition="scramble"/);
    assert.match(renderToStaticMarkup(<DossierStatusBadge tone="alert" label="quarantined" />), /data-tone="alert"[\s\S]*quarantined/);
    assert.match(renderToStaticMarkup(<ConnectorStatusBadge connectorStatus="healthy" activeVersion={2} />), /v2 · healthy/);
  });

  test("CopyCitationButton resets copied state immediately when citation value changes in headless DOM", async () => {
    const win = new Window({ url: "http://localhost:6006" });
    const prevGlobals = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, HTMLElement: globalThis.HTMLElement };
    let lastCopied = "";
    Object.assign(globalThis, { window: win, document: win.document, HTMLElement: win.HTMLElement });
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (v: string) => { lastCopied = v; } } }, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => { root.render(<CopyCitationButton value="sha_alpha" displayLabel="sha256:alpha" citationKind="Source Artifact SHA-256" />); });
      const btn = container.querySelector("button")!;
      await act(async () => { btn.click(); });
      assert.equal(lastCopied, "sha_alpha");
      assert.equal(btn.getAttribute("data-copied"), "true");
      await act(async () => { root.render(<CopyCitationButton value="sha_beta" displayLabel="sha256:beta" citationKind="Source Artifact SHA-256" />); });
      assert.equal(btn.getAttribute("data-copied"), "false");
      assert.match(btn.getAttribute("aria-label") ?? "", /Copy Source Artifact SHA-256 sha256:beta/);
    } finally {
      await act(async () => { root.unmount(); });
      await win.happyDOM.close();
      Object.assign(globalThis, { window: prevGlobals.window, document: prevGlobals.document, HTMLElement: prevGlobals.HTMLElement });
      Object.defineProperty(globalThis, "navigator", { value: prevGlobals.navigator, configurable: true });
    }
  });

  test("Seam 2 End-to-End API + Sad Paths: renders degraded alerts, validates static props, normalizes rejected snapshotPromise, and streams live HTTP 200/500/network states", async () => {
    assert.equal(
      buildRepairChangelogUrl({ apiBaseUrl: "https://api.example.com/", connectorId: "tdlr-tabs", limit: 5, format: "md" }),
      "https://api.example.com/api/repairs/changelog?connector_id=tdlr-tabs&limit=5&format=md"
    );
    const loadingHtml = renderToStaticMarkup(<GridlockRepairLogWidget apiBaseUrl="https://api.example.com" />);
    assert.match(loadingHtml, /data-loading-placeholder="repair-log"/);
    assert.doesNotMatch(loadingHtml, /<progress/);

    const malformedStaticHtml = renderToStaticMarkup(
      <GridlockRepairLogWidget changelog={{ broken: true } as never} efficiencyLedger={DEFAULT_EFFICIENCY_LEDGER} />
    );
    assert.match(malformedStaticHtml, /role="alert"/);
    assert.doesNotMatch(malformedStaticHtml, /<button[^>]*>Retry<\/button>/);

    const sameOriginSnapshotHtml = await streamHtml(
      <GridlockRepairLogWidget apiBaseUrl="" snapshotPromise={Promise.resolve({ ok: true, changelog: { connectorId: "ercot-gis", connectorStatus: "healthy", activeVersion: 1, entries: [] }, efficiencyLedger: DEFAULT_EFFICIENCY_LEDGER })} />
    );
    assert.match(sameOriginSnapshotHtml, /href="\/api\/repairs\/changelog\?connector_id=ercot-gis&amp;format=md"/);

    const rejectedPromiseHtml = await streamHtml(
      <GridlockRepairLogWidget apiBaseUrl="" snapshotPromise={Promise.reject(new Error("Gateway socket hang up"))} />
    );
    assert.match(rejectedPromiseHtml, /Gateway socket hang up/);
    assert.match(rejectedPromiseHtml, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

    for (const status of ["selector_anomaly", "blocked_by_waf"] as const) {
      const degradedHtml = renderToStaticMarkup(
        <GridlockRepairLogWidget changelog={{ connectorId: "tdlr-tabs", connectorStatus: status, activeVersion: 1, entries: [] }} efficiencyLedger={DEFAULT_EFFICIENCY_LEDGER} />
      );
      assert.match(degradedHtml, /role="alert"/);
      assert.match(degradedHtml, new RegExp(status));
      assert.doesNotMatch(degradedHtml, /100% deterministic uptime/i);
    }

    const healedArgs = HealedWithAmortization.args;
    if (!healedArgs.changelog || !healedArgs.efficiencyLedger) throw new Error("Expected static story args");
    const baseRepo = createInMemoryGridlockRepository();
    await baseRepo.promoteConnectorConfig(
      { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 2, detailContainerSelector: ".project-details, .tabs-project-details-v2" },
      healedArgs.changelog.entries[0]!,
      { updatedLedger: healedArgs.efficiencyLedger }
    );

    let force500 = true;
    const repo: GridlockRepository = {
      ...baseRepo,
      async listRepairChangelog(connectorId?: string) {
        return force500 ? ([{ broken: true }] as never) : baseRepo.listRepairChangelog(connectorId);
      },
    };

    const server = createGridlockHttpServer({ repository: repo });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const apiBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const error500Html = await streamHtml(<GridlockRepairLogWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchRepairLogSnapshot({ apiBaseUrl })} />);
      assert.match(error500Html, /role="alert"/);
      assert.match(error500Html, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

      force500 = false;
      const recoveredHtml = await streamHtml(<GridlockRepairLogWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchRepairLogSnapshot({ apiBaseUrl })} />);
      assert.match(recoveredHtml, /inter_widget_heal_v2/);
      assert.match(recoveredHtml, /number-section-integer/);
      assert.match(recoveredHtml, /href="[^"]*\/api\/repairs\/changelog\?connector_id=tdlr-tabs&amp;format=md"/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    const networkFailHtml = await streamHtml(<GridlockRepairLogWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchRepairLogSnapshot({ apiBaseUrl })} />);
    assert.match(networkFailHtml, /role="alert"/);
    assert.match(networkFailHtml, /Retry/);
  });

  test("CSF3 Storybook Stories: exports only valid story objects by name and renders all 5 variants cleanly", () => {
    const StoryComponent = repairLogWidgetMeta.component;
    assert.equal(StoryComponent, GridlockRepairLogWidget);
    const namedStoryKeys = Object.keys(repairLogStories).filter((key) => key !== "default").sort();
    assert.deepEqual(namedStoryKeys, ["BlockedByWafDegraded", "HealedWithAmortization", "HealthyZeroAnomalies", "NocturnalTheme", "SelectorAnomalyDegraded"]);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealthyZeroAnomalies.args} />), /100% deterministic uptime/i);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealedWithAmortization.args} />), /Selector Diff Inspector/);
    assert.match(renderToStaticMarkup(<StoryComponent {...SelectorAnomalyDegraded.args} />), /selector_anomaly/);
    assert.match(renderToStaticMarkup(<StoryComponent {...BlockedByWafDegraded.args} />), /blocked_by_waf/);
    assert.match(renderToStaticMarkup(<StoryComponent {...NocturnalTheme.args} />), /data-gridlock-theme="nocturnal"/);
  });
});

import type { AddressInfo } from "node:net";
import { createRef } from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createGridlockHttpServer, createInMemoryGridlockRepository, DEFAULT_EFFICIENCY_LEDGER, DEFAULT_TDLR_CONNECTOR_CONFIG, type GridlockRepository } from "@samasastudio/gridlock-core";
import { buildRepairChangelogUrl, fetchRepairLogSnapshot, GridlockRepairLogWidget } from "../src/index.ts";
import { BlockedByWafDegraded, HealedWithAmortization, HealthyZeroAnomalies, NocturnalTheme, repairLogWidgetMeta, SelectorAnomalyDegraded } from "../stories/GridlockRepairLogWidget.stories.tsx";

async function streamHtml(node: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

describe("<GridlockRepairLogWidget /> Seam 2 UI (Ticket #6)", () => {
  test("Happy Path & Zero-Anomaly State: renders 100% deterministic uptime when empty, and renders Repair Changelog timeline, selector diffs, mttrMs, amortization, and Efficiency Ledger across diurnal and nocturnal Atlas Dossier tokens", () => {
    const emptyHtml = renderToStaticMarkup(<GridlockRepairLogWidget {...HealthyZeroAnomalies.args} />);
    assert.match(emptyHtml, /100% deterministic uptime/i);
    assert.match(emptyHtml, /v1/);

    const sectionRef = createRef<HTMLElement>();
    const diurnalHtml = renderToStaticMarkup(<GridlockRepairLogWidget ref={sectionRef} {...HealedWithAmortization.args} />);
    for (const pattern of [
      /data-gridlock-theme="diurnal"/, /var\(--font-sans/, /--paper:\s*var\(--atlas-paper/, /--ink:\s*var\(--atlas-ink/,
      /--relief-coral-mid/, /<ol[^>]*role="list"/, /<time[^>]*dateTime="2026-10-27T14:00:01\.850Z"/,
      /v1.*v2/, /1,850 ms/, /14.*deterministic runs served/i, /1\/1.*2 total verified/,
      /sha256:bbbbbbbbbbbb/, /\.tabs-project-details-v2/, /Total Estimated Cost:/, /<details/, /<table/,
      /<caption/, /<th[^>]*scope="col"/, /<th[^>]*scope="row"/, /350,000/, /380/, /99\.89%/, /93\.33%/,
    ]) {
      assert.match(diurnalHtml, pattern);
    }

    const nocturnalHtml = renderToStaticMarkup(<GridlockRepairLogWidget {...NocturnalTheme.args} />);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /color-scheme:\s*dark/);
    assert.match(nocturnalHtml, /--paper:\s*oklch\(0\.215 0\.026 244\)/);
  });

  test("Seam 2 End-to-End API + Sad Paths: renders degraded selector_anomaly and blocked_by_waf alerts, validates static props without dead Retry button, and streams live HTTP 200/500/network states", async () => {
    assert.equal(
      buildRepairChangelogUrl({ apiBaseUrl: "https://api.example.com/", connectorId: "tdlr-tabs", limit: 5, format: "md" }),
      "https://api.example.com/api/repairs/changelog?connector_id=tdlr-tabs&limit=5&format=md"
    );
    assert.match(renderToStaticMarkup(<GridlockRepairLogWidget apiBaseUrl="https://api.example.com" />), /<progress[^>]*aria-label="Loading Repair Changelog"/);

    const malformedStaticHtml = renderToStaticMarkup(
      <GridlockRepairLogWidget changelog={{ broken: true } as never} efficiencyLedger={DEFAULT_EFFICIENCY_LEDGER} />
    );
    assert.match(malformedStaticHtml, /role="alert"/);
    assert.doesNotMatch(malformedStaticHtml, /<button[^>]*>Retry<\/button>/);

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
      assert.match(recoveredHtml, /350,000/);
      assert.match(recoveredHtml, /href="[^"]*\/api\/repairs\/changelog\?format=md"/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    const networkFailHtml = await streamHtml(<GridlockRepairLogWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchRepairLogSnapshot({ apiBaseUrl })} />);
    assert.match(networkFailHtml, /role="alert"/);
    assert.match(networkFailHtml, /Retry/);
  });

  test("CSF3 Storybook Stories: renders healthy, healed, selector_anomaly, blocked_by_waf, and nocturnal variants cleanly", () => {
    const StoryComponent = repairLogWidgetMeta.component;
    assert.equal(StoryComponent, GridlockRepairLogWidget);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealthyZeroAnomalies.args} />), /100% deterministic uptime/i);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealedWithAmortization.args} />), /Selector Diff Inspector/);
    assert.match(renderToStaticMarkup(<StoryComponent {...SelectorAnomalyDegraded.args} />), /selector_anomaly/);
    assert.match(renderToStaticMarkup(<StoryComponent {...BlockedByWafDegraded.args} />), /blocked_by_waf/);
    assert.match(renderToStaticMarkup(<StoryComponent {...NocturnalTheme.args} />), /data-gridlock-theme="nocturnal"/);
  });
});

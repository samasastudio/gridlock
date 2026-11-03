import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createRef } from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createGridlockHttpServer, createInMemoryGridlockRepository, DEFAULT_EFFICIENCY_LEDGER, DEFAULT_TDLR_CONNECTOR_CONFIG, type GridlockRepository } from "@samasastudio/gridlock-core";
import { buildRepairChangelogUrl, fetchRepairLogSnapshot, GridlockRepairLogWidget } from "../src/index.ts";
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
  });

  test("Happy Path & Zero-Anomaly State: renders 100% deterministic uptime when empty, derives static export connectorId, and renders Repair Changelog + Efficiency Ledger across diurnal/nocturnal tokens", () => {
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

  test("Seam 2 End-to-End API + Sad Paths: renders degraded alerts, validates static props, normalizes rejected snapshotPromise, and streams live HTTP 200/500/network states", async () => {
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

    const rejectedPromiseHtml = await streamHtml(
      <GridlockRepairLogWidget apiBaseUrl="https://api.example.com" snapshotPromise={Promise.reject(new Error("Gateway socket hang up"))} />
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
      assert.match(recoveredHtml, /350,000/);
      assert.match(recoveredHtml, /href="[^"]*\/api\/repairs\/changelog\?format=md"/);
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
    assert.deepEqual(namedStoryKeys, [
      "BlockedByWafDegraded",
      "HealedWithAmortization",
      "HealthyZeroAnomalies",
      "NocturnalTheme",
      "SelectorAnomalyDegraded",
    ]);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealthyZeroAnomalies.args} />), /100% deterministic uptime/i);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealedWithAmortization.args} />), /Selector Diff Inspector/);
    assert.match(renderToStaticMarkup(<StoryComponent {...SelectorAnomalyDegraded.args} />), /selector_anomaly/);
    assert.match(renderToStaticMarkup(<StoryComponent {...BlockedByWafDegraded.args} />), /blocked_by_waf/);
    assert.match(renderToStaticMarkup(<StoryComponent {...NocturnalTheme.args} />), /data-gridlock-theme="nocturnal"/);
  });
});

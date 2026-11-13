import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createRef } from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
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
        efficiencyLedger={HealedWithAmortization.args.efficiencyLedger!}
        apiBaseUrl="https://api.example.com"
      />
    );
    assert.match(emptyHtml, /100% deterministic uptime/i);
    assert.doesNotMatch(emptyHtml, /Inspect Out-of-Band Repair/, "Cross-connector repair runs must not render markers on ercot-gis");
    assert.match(emptyHtml, /href="https:\/\/api\.example\.com\/api\/repairs\/changelog\?connector_id=ercot-gis&amp;format=md"/);

    const sectionRef = createRef<HTMLElement>();
    const diurnalHtml = renderToStaticMarkup(<GridlockRepairLogWidget ref={sectionRef} {...HealedWithAmortization.args} />);
    const styleBlock = diurnalHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) => Number(m[1]));
    assert.ok(remFontSizes.length > 0 && remFontSizes.every((s) => s >= 0.75), "Expected all rem font-size rules >= 0.75rem");
    assert.doesNotMatch(styleBlock, /gridlock-diff-table thead\)\s*\{\s*display:\s*none/);
    assert.doesNotMatch(diurnalHtml, /<details[^>]*open/);
    for (const pattern of [
      /<section[^>]*class="[^"]*\bgridlock-dossier-surface\b[^"]*\bgridlock-repair-widget\b"/,
      /data-gridlock-theme="diurnal"/, /var\(--font-sans/, /--paper:\s*var\(--atlas-paper/, /--ink:\s*var\(--atlas-ink/, /--gridlock-radius:\s*0rem/,
      /--gridlock-card:\s*var\(--card,\s*color-mix\(in oklab,\s*var\(--gridlock-paper\)\s*92%,\s*var\(--gridlock-ink\)\)\)/,
      /--gridlock-muted:\s*var\(--muted-foreground,\s*color-mix\(in oklab,\s*var\(--gridlock-ink\)\s*68%,\s*var\(--gridlock-paper\)\)\)/,
      /--relief-coral-mid/, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--gridlock-ink\)/,
      /data-chart="cumulative-efficiency"/, /Cumulative Tokens Avoided Across Runs/, /9 recent runs/, /data-series="avoided"/, /data-series="actual"/, /aria-pressed="true"/,
      /Inspect Out-of-Band Repair v1 → v2 \(2026-10-27\)/, /Inspect Out-of-Band Repair v2 → v3 \(2026-11-03\)/,
      /role="tablist"/, /role="tabpanel"/, /v1 → v2/, /v2 → v3/, /<time[^>]*dateTime="2026-11-03T14:00:01\.420Z"/,
      /1,420/, /ms heal/, /12/, /runs amortized/, /3 replay verified \(2\/2 historical\)/,
      /sha256:cccccccccccc/, /<details[^>]*class="gridlock-patch-disclosure"/, /Inspect patch \(2 selectors\)/, /dl\.tabs-filing-spec/, /Gross Square Footage:/,
      /<table[^>]*class="gridlock-diff-table"/, /<caption/, /<th[^>]*scope="col"/, /<th[^>]*scope="row"/, /number-section-integer/, /650,000/, /790/, /99\.88%/, /\$1\.62/,
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
    assert.match(renderToStaticMarkup(<CopyCitationButton value="sha_alpha" displayLabel="sha256:alpha" citationKind="Source Artifact SHA-256" />), /Copy Source Artifact SHA-256 sha256:alpha/);
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
    const baseRepo = createInMemoryGridlockRepository(DEFAULT_TDLR_CONNECTOR_CONFIG, healedArgs.efficiencyLedger);
    for (const entry of healedArgs.changelog.entries) {
      await baseRepo.promoteConnectorConfig(
        { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: entry.promotedVersion, detailContainerSelector: ".project-details, .tabs-project-details-v2" },
        entry,
        { updatedLedger: healedArgs.efficiencyLedger }
      );
    }

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
      const limitedSnap = await fetchRepairLogSnapshot({ apiBaseUrl, limit: 1 });
      assert.equal(limitedSnap.ok && limitedSnap.changelog.entries.length, 1);
      assert.equal(limitedSnap.ok && limitedSnap.efficiencyLedger.recentRuns.length, 9);
      const recoveredHtml = await streamHtml(<GridlockRepairLogWidget apiBaseUrl={apiBaseUrl} snapshotPromise={Promise.resolve(limitedSnap)} />);
      assert.equal(Array.from(recoveredHtml.matchAll(/<rect[^>]*role="button"/g)).length, 1, "Unlisted v2 repair marker must not expose dead role=button");
      assert.match(recoveredHtml, /650,000/);
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
    assert.equal(HealthyZeroAnomalies.args.efficiencyLedger!.recentRuns.reduce((s, r) => s + r.naiveTokensAvoided, 0), HealthyZeroAnomalies.args.efficiencyLedger!.naiveTokensAvoided);
    assert.equal(SelectorAnomalyDegraded.args.efficiencyLedger!.failedOrBlockedRunsCount, 1);
    assert.equal(BlockedByWafDegraded.args.efficiencyLedger!.failedOrBlockedRunsCount, 2);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealthyZeroAnomalies.args} />), /316,000/);
    assert.match(renderToStaticMarkup(<StoryComponent {...HealedWithAmortization.args} />), /Inspect patch \(2 selectors\)/);
    assert.match(renderToStaticMarkup(<StoryComponent {...SelectorAnomalyDegraded.args} />), /selector_anomaly/);
    assert.match(renderToStaticMarkup(<StoryComponent {...BlockedByWafDegraded.args} />), /blocked_by_waf/);
    assert.match(renderToStaticMarkup(<StoryComponent {...NocturnalTheme.args} />), /data-gridlock-theme="nocturnal"/);
  });
});

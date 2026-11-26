import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL, isWebpBuffer, PlateLineageResponseSchema, SCENARIO_BRANCH_WATERMARK, type GridlockRepository,
} from "@samasastudio/gridlock-core";
import { fetchPlateLineageSnapshot, GridlockPlateWidget } from "../src/index.ts";
import { seedTestPlateLineage, withTestPlatesServer } from "./helpers/plate-fixtures.ts";

async function streamHtml(node: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

function readKpiValues(html: string): number[] {
  return Array.from(html.matchAll(/class="gridlock-kpi-value"><span[^>]*><span aria-label="([^"]+)"/g), (m) => Number(m[1]));
}

describe("<GridlockPlateWidget /> Multi-Mode Shell, KPIs & Adaptive Summary (Ticket #34 Phase 2)", () => {
  test("Loading placeholder, static prop validation, theme cascade, and rejected snapshotPromise error boundary", async () => {
    const loadingHtml = renderToStaticMarkup(<GridlockPlateWidget apiBaseUrl="https://api.example.com" timelineId="texas-corridor-main" />);
    assert.match(loadingHtml, /data-gridlock-theme="inherit"/);
    assert.match(loadingHtml, /data-loading-placeholder="plate-lineage"/);
    assert.match(loadingHtml, /Corridor Plate Lineage/);
    assert.match(loadingHtml, /texas-corridor-main/);
    assert.doesNotMatch(loadingHtml, /<progress/);

    const malformedStaticHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={{ broken: true } as never} timelineId="texas-corridor-main" />);
    assert.match(malformedStaticHtml, /role="alert"/);
    assert.match(malformedStaticHtml, /Unable to load Plate Lineage:/);
    assert.match(malformedStaticHtml, /Malformed Plate Lineage props/);
    assert.doesNotMatch(malformedStaticHtml, /<button[^>]*>Retry<\/button>/);

    const rejectedPromiseHtml = await streamHtml(
      <GridlockPlateWidget apiBaseUrl="" timelineId="texas-corridor-main" snapshotPromise={Promise.reject(new Error("Lineage upstream socket hang up"))} />
    );
    assert.match(rejectedPromiseHtml, /role="alert"/);
    assert.match(rejectedPromiseHtml, /Lineage upstream socket hang up/);
    assert.match(rejectedPromiseHtml, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

    const seeded = await seedTestPlateLineage();
    const diurnalHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={seeded.lineage} theme="diurnal" apiBaseUrl="" />);
    const styleBlock = diurnalHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (match) => Number(match[1]));
    assert.ok(remFontSizes.length > 0 && remFontSizes.every((size) => size >= 0.75));
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(diurnalHtml, /--gridlock-radius:\s*0rem/);

    const nocturnalHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={seeded.lineage} theme="nocturnal" apiBaseUrl="" />);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /color-scheme:\s*only dark/);
  });

  test("Live HTTP 200 end-to-end: anchors to activeCanonicalPlateId, renders KPI trio + multi-observation prose, and serves valid image/webp bytes", async () => {
    const seeded = await seedTestPlateLineage();

    await withTestPlatesServer({ repository: seeded.repository }, async (apiBaseUrl) => {
      const html = await streamHtml(<GridlockPlateWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchPlateLineageSnapshot({ apiBaseUrl })} />);

      assert.doesNotMatch(html, new RegExp(SCENARIO_BRANCH_WATERMARK));
      assert.deepEqual(readKpiValues(html), [2, 2, 2]);
      for (const pattern of [
        new RegExp(`data-plate-id="${seeded.t2.plateId}"`), /data-branch="false"/, new RegExp(CANONICAL_MILESTONE_LABEL), /4 Visual Plates/,
        /Canonical Milestones/, new RegExp(`head ${seeded.t2.plateId}`), /Scenario Branches/, /90-day ephemeral projections/, /Linked Filings/, /distinct TDLR project IDs/,
        /250,000 sq ft structural steel erection and chilled-water loop expansion/, /TABS2027003697/, /Construction Started/, /\$125,000,000/, /250,000 sq ft/, /2026-10-28/,
        /TABS2027004200/, /140,000 sq ft adjacent switchgear interconnect building/, /\$65,000,000/,
      ]) {
        assert.match(html, pattern);
      }

      const imgSrc = html.match(/<img[^>]*src="([^"]+)"/)?.[1];
      assert.equal(imgSrc, `${apiBaseUrl}/api/illustrations/assets/${seeded.t2.plateId}.webp`);
      const imgRes = await fetch(imgSrc!);
      assert.equal(imgRes.status, 200);
      assert.equal(imgRes.headers.get("content-type"), "image/webp");
      assert.equal(isWebpBuffer(Buffer.from(await imgRes.arrayBuffer())), true);
    });
  });

  test("Same-origin apiBaseUrl='', branch selection, stale selectedPlateId re-anchor, 0-observation baseline, empty lineage, and HTTP 400/500 alert shells", async () => {
    const seeded = await seedTestPlateLineage();

    const sameOriginHtml = await streamHtml(<GridlockPlateWidget apiBaseUrl="" snapshotPromise={Promise.resolve({ ok: true, lineage: seeded.lineage })} />);
    assert.match(sameOriginHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.plateId}\\.webp"`));

    const branchHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={seeded.lineage} selectedPlateId={seeded.b1.plateId} apiBaseUrl="" />);
    for (const pattern of [
      new RegExp(`data-plate-id="${seeded.b1.plateId}"`), /data-branch="true"/, /data-tone="alert"/, new RegExp(SCENARIO_BRANCH_WATERMARK),
      /Simulate \+400MW ERCOT substation interconnection delay/, /Unverified projection/, new RegExp(`Forked from Turn 2 \\(${seeded.t2.plateId}\\)`), /Expires/,
    ]) {
      assert.match(branchHtml, pattern);
    }

    const staleSelectionHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={seeded.lineage} selectedPlateId="plate_missing" apiBaseUrl="" />);
    assert.match(staleSelectionHtml, new RegExp(`data-plate-id="${seeded.t2.plateId}"`));

    const t1Node = seeded.lineage.nodes.find((node) => node.plate.plateId === seeded.t1.plateId)!;
    const zeroObsLineage = PlateLineageResponseSchema.parse({
      timelineId: seeded.lineage.timelineId,
      activeCanonicalPlateId: t1Node.plate.plateId,
      nodes: [{ ...t1Node, plate: { ...t1Node.plate, projectNumbers: [], triggeringObservationIds: [], rawCaptureHashes: [] }, triggeringObservations: [], rawCaptures: [] }],
      edges: [],
    });
    const baselineHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={zeroObsLineage} apiBaseUrl="" />);
    assert.match(baselineHtml, /Corridor baseline canvas initialized prior to incremental filing delta turns\./);
    assert.match(baselineHtml, /Baseline Turn 1/);
    assert.match(baselineHtml, /1 Visual Plate(?!s)/);

    const emptyLineage = PlateLineageResponseSchema.parse({ timelineId: "empty-corridor", activeCanonicalPlateId: null, nodes: [], edges: [] });
    const emptyHtml = renderToStaticMarkup(<GridlockPlateWidget lineage={emptyLineage} />);
    assert.deepEqual(readKpiValues(emptyHtml), [0, 0, 0]);
    assert.match(emptyHtml, /awaiting Turn 1 bootstrap/);
    assert.match(emptyHtml, /0 Visual Plates/);
    assert.match(emptyHtml, /data-empty-lineage="true"/);

    let force500 = true;
    const flakyRepo: GridlockRepository = {
      ...seeded.repository,
      async listGeneratedIllustrationsByTimeline(timelineId) {
        return force500 ? ([{ broken: true }] as never) : seeded.repository.listGeneratedIllustrationsByTimeline(timelineId);
      },
    };

    await withTestPlatesServer({ repository: flakyRepo }, async (apiBaseUrl) => {
      const err400Html = await streamHtml(
        <GridlockPlateWidget apiBaseUrl={apiBaseUrl} timelineId="bad/id" snapshotPromise={fetchPlateLineageSnapshot({ apiBaseUrl, timelineId: "bad/id" })} />
      );
      assert.match(err400Html, /role="alert"/);
      assert.match(err400Html, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

      const err500Html = await streamHtml(<GridlockPlateWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchPlateLineageSnapshot({ apiBaseUrl })} />);
      assert.match(err500Html, /role="alert"/);
      assert.match(err500Html, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

      force500 = false;
      const subsequentHtml = await streamHtml(<GridlockPlateWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchPlateLineageSnapshot({ apiBaseUrl })} />);
      assert.match(subsequentHtml, new RegExp(`data-plate-id="${seeded.t2.plateId}"`));
    });
  });
});

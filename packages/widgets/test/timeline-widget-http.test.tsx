import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import {
  CANONICAL_MILESTONE_LABEL, isWebpBuffer, FrameTimelineResponseSchema, SCENARIO_BRANCH_WATERMARK, type GridlockRepository,
} from "@samasastudio/gridlock-core";
import { fetchFrameTimelineSnapshot, GridlockTimelineWidget } from "../src/index.ts";
import { seedTestFrameTimeline, withTestTimelineServer } from "./helpers/timeline-fixtures.ts";

async function streamHtml(node: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

function readKpiValues(html: string): number[] {
  return Array.from(html.matchAll(/class="gridlock-kpi-value"><span[^>]*><span aria-label="([^"]+)"/g), (m) => Number(m[1]));
}

describe("<GridlockTimelineWidget /> Multi-Mode Shell, KPIs & Adaptive Summary (Ticket #34 Phase 2)", () => {
  test("Loading placeholder, static prop validation, theme cascade, and rejected snapshotPromise error boundary", async () => {
    const loadingHtml = renderToStaticMarkup(<GridlockTimelineWidget apiBaseUrl="https://api.example.com" timelineId="texas-corridor-main" />);
    assert.match(loadingHtml, /data-gridlock-theme="inherit"/);
    assert.match(loadingHtml, /data-loading-placeholder="frame-timeline"/);
    assert.match(loadingHtml, /Corridor Frame Timeline/);
    assert.match(loadingHtml, /texas-corridor-main/);
    assert.doesNotMatch(loadingHtml, /<progress/);

    const malformedStaticHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={{ broken: true } as never} timelineId="texas-corridor-main" />);
    assert.match(malformedStaticHtml, /role="alert"/);
    assert.match(malformedStaticHtml, /Unable to load Frame Timeline:/);
    assert.match(malformedStaticHtml, /Malformed Frame Timeline props/);
    assert.doesNotMatch(malformedStaticHtml, /<button[^>]*>Retry<\/button>/);

    const rejectedPromiseHtml = await streamHtml(
      <GridlockTimelineWidget apiBaseUrl="" timelineId="texas-corridor-main" snapshotPromise={Promise.reject(new Error("Timeline upstream socket hang up"))} />
    );
    assert.match(rejectedPromiseHtml, /role="alert"/);
    assert.match(rejectedPromiseHtml, /Timeline upstream socket hang up/);
    assert.match(rejectedPromiseHtml, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

    const seeded = await seedTestFrameTimeline();
    const diurnalHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={seeded.timeline} theme="diurnal" apiBaseUrl="" />);
    const styleBlock = diurnalHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (match) => Number(match[1]));
    assert.ok(remFontSizes.length > 0 && remFontSizes.every((size) => size >= 0.75));
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(diurnalHtml, /--gridlock-radius:\s*0rem/);

    const nocturnalHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={seeded.timeline} theme="nocturnal" apiBaseUrl="" />);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /color-scheme:\s*only dark/);
  });

  test("Live HTTP 200 end-to-end: anchors to activeCanonicalIllustrationId, renders KPI trio + multi-observation prose, and serves valid image/webp bytes", async () => {
    const seeded = await seedTestFrameTimeline();

    await withTestTimelineServer({ repository: seeded.repository }, async (apiBaseUrl) => {
      const html = await streamHtml(<GridlockTimelineWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchFrameTimelineSnapshot({ apiBaseUrl })} />);

      assert.doesNotMatch(html, new RegExp(SCENARIO_BRANCH_WATERMARK));
      assert.deepEqual(readKpiValues(html), [2, 2, 2]);
      for (const pattern of [
        new RegExp(`data-illustration-id="${seeded.t2.illustrationId}"`), /data-branch="false"/, new RegExp(CANONICAL_MILESTONE_LABEL), /4 Generated Illustrations/,
        /Canonical Milestones/, new RegExp(`head ${seeded.t2.illustrationId}`), /Scenario Branches/, /90-day ephemeral projections/, /Linked Filings/, /distinct TDLR project IDs/,
        /250,000 sq ft structural steel erection and chilled-water loop expansion/, /TABS2027003697/, /Construction Started/, /\$125,000,000/, /250,000 sq ft/, /2026-10-28/,
        /TABS2027004200/, /140,000 sq ft adjacent switchgear interconnect building/, /\$65,000,000/,
      ]) {
        assert.match(html, pattern);
      }

      const imgSrc = html.match(/<img[^>]*src="([^"]+)"/)?.[1];
      assert.equal(imgSrc, `${apiBaseUrl}/api/illustrations/assets/${seeded.t2.illustrationId}.webp`);
      const imgRes = await fetch(imgSrc!);
      assert.equal(imgRes.status, 200);
      assert.equal(imgRes.headers.get("content-type"), "image/webp");
      assert.equal(isWebpBuffer(Buffer.from(await imgRes.arrayBuffer())), true);
    });
  });

  test("Same-origin apiBaseUrl='', branch selection, stale selectedIllustrationId re-anchor, 0-observation baseline, empty timeline, and HTTP 400/500 alert shells", async () => {
    const seeded = await seedTestFrameTimeline();

    const sameOriginHtml = await streamHtml(<GridlockTimelineWidget apiBaseUrl="" snapshotPromise={Promise.resolve({ ok: true, timeline: seeded.timeline })} />);
    assert.match(sameOriginHtml, new RegExp(`src="/api/illustrations/assets/${seeded.t2.illustrationId}\\.webp"`));

    const branchHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={seeded.timeline} selectedIllustrationId={seeded.b1.illustrationId} apiBaseUrl="" />);
    for (const pattern of [
      new RegExp(`data-illustration-id="${seeded.b1.illustrationId}"`), /data-branch="true"/, /data-tone="alert"/, new RegExp(SCENARIO_BRANCH_WATERMARK),
      /Simulate \+400MW ERCOT substation interconnection delay/, /Unverified projection/, new RegExp(`Forked from Turn 2 \\(${seeded.t2.illustrationId}\\)`), /Expires/,
    ]) {
      assert.match(branchHtml, pattern);
    }

    const staleSelectionHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={seeded.timeline} selectedIllustrationId="plate_missing" apiBaseUrl="" />);
    assert.match(staleSelectionHtml, new RegExp(`data-illustration-id="${seeded.t2.illustrationId}"`));

    const t1Node = seeded.timeline.nodes.find((node) => node.plate.illustrationId === seeded.t1.illustrationId)!;
    const zeroObsTimeline = FrameTimelineResponseSchema.parse({
      timelineId: seeded.timeline.timelineId,
      activeCanonicalIllustrationId: t1Node.plate.illustrationId,
      nodes: [{ ...t1Node, plate: { ...t1Node.plate, projectNumbers: [], triggeringObservationIds: [], rawCaptureHashes: [] }, triggeringObservations: [], rawCaptures: [] }],
      edges: [],
    });
    const baselineHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={zeroObsTimeline} apiBaseUrl="" />);
    assert.match(baselineHtml, /Corridor baseline canvas initialized prior to incremental filing delta turns\./);
    assert.match(baselineHtml, /Baseline Turn 1/);
    assert.match(baselineHtml, /1 Generated Illustration(?!s)/);

    const emptyTimeline = FrameTimelineResponseSchema.parse({ timelineId: "empty-corridor", activeCanonicalIllustrationId: null, nodes: [], edges: [] });
    const emptyHtml = renderToStaticMarkup(<GridlockTimelineWidget timeline={emptyTimeline} />);
    assert.deepEqual(readKpiValues(emptyHtml), [0, 0, 0]);
    assert.match(emptyHtml, /awaiting Turn 1 bootstrap/);
    assert.match(emptyHtml, /0 Generated Illustrations/);
    assert.match(emptyHtml, /data-empty-timeline="true"/);

    let force500 = true;
    const flakyRepo: GridlockRepository = {
      ...seeded.repository,
      async listGeneratedIllustrationsByTimeline(timelineId) {
        return force500 ? ([{ broken: true }] as never) : seeded.repository.listGeneratedIllustrationsByTimeline(timelineId);
      },
    };

    await withTestTimelineServer({ repository: flakyRepo }, async (apiBaseUrl) => {
      const err400Html = await streamHtml(
        <GridlockTimelineWidget apiBaseUrl={apiBaseUrl} timelineId="bad/id" snapshotPromise={fetchFrameTimelineSnapshot({ apiBaseUrl, timelineId: "bad/id" })} />
      );
      assert.match(err400Html, /role="alert"/);
      assert.match(err400Html, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

      const err500Html = await streamHtml(<GridlockTimelineWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchFrameTimelineSnapshot({ apiBaseUrl })} />);
      assert.match(err500Html, /role="alert"/);
      assert.match(err500Html, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

      force500 = false;
      const subsequentHtml = await streamHtml(<GridlockTimelineWidget apiBaseUrl={apiBaseUrl} snapshotPromise={fetchFrameTimelineSnapshot({ apiBaseUrl })} />);
      assert.match(subsequentHtml, new RegExp(`data-illustration-id="${seeded.t2.illustrationId}"`));
    });
  });
});

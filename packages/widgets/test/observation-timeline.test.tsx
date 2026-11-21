import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CANONICAL_MILESTONE_LABEL } from "@samasastudio/gridlock-core";
import { ObservationTimeline } from "../src/index.ts";
import { makeCitedObservation, makeInterleavedObservations } from "./helpers/ast-card-fixtures.ts";

const TWO_TRACKED_PROJECTS = ["TABS2027003697", "TABS2027004112"] as const;

describe("<ObservationTimeline /> Seam 4 UI AST Card (Ticket #38 Phase 2)", () => {
  test("Isolates per-project filing deltas across interleaved multi-project timelines and renders milestone vs. routine markers", () => {
    const observations = makeInterleavedObservations();
    const html = renderToStaticMarkup(
      <ObservationTimeline projectNumbers={TWO_TRACKED_PROJECTS} observations={observations} nodeId="timeline-corridor" />
    );

    assert.match(html, /data-ast-card="ObservationTimeline"/);
    assert.match(html, /data-node-id="timeline-corridor"/);
    assert.match(html, /2 \$25M\+ milestones/);
    assert.match(html, /latest \$148,000,000/);

    const itemBlocks = html.split('<li class="gridlock-timeline-item"').slice(1);
    assert.equal(itemBlocks.length, 3);

    assert.match(itemBlocks[0]!, /data-milestone="true"/);
    assert.match(itemBlocks[0]!, /data-project-number="TABS2027003697"/);
    assert.match(itemBlocks[0]!, /Initial filing/);
    assert.match(itemBlocks[0]!, /Initial registration for \[Building A\]/);
    assert.doesNotMatch(itemBlocks[0]!, /\\\[Building A\\\]/);
    assert.match(itemBlocks[0]!, new RegExp(CANONICAL_MILESTONE_LABEL));

    assert.match(itemBlocks[1]!, /data-milestone="false"/);
    assert.match(itemBlocks[1]!, /data-project-number="TABS2027004112"/);
    assert.match(itemBlocks[1]!, /Initial filing/);
    assert.match(itemBlocks[1]!, /Construct \[Auxiliary Yard\] adjacent to \[REDACTED_ADDRESS\]/);
    assert.doesNotMatch(itemBlocks[1]!, new RegExp(CANONICAL_MILESTONE_LABEL));

    assert.match(itemBlocks[2]!, /data-milestone="true"/);
    assert.match(itemBlocks[2]!, /data-project-number="TABS2027003697"/);
    assert.match(itemBlocks[2]!, /\+\$53,000,000 capital/);
    assert.match(itemBlocks[2]!, /\+60,000 sq ft/);
    assert.match(itemBlocks[2]!, /Registered → Under Construction/);
    assert.match(itemBlocks[2]!, /\$617 \/ sq ft/);

    const narrativeAndDownsizeHtml = renderToStaticMarkup(
      <ObservationTimeline
        projectNumbers={["TABS2027003697"]}
        observations={[
          makeCitedObservation(),
          makeCitedObservation({
            observation: { id: "obs-narrative", observedAt: "2026-10-01T14:00:00.000Z" },
          }),
          makeCitedObservation({
            observation: {
              id: "obs-downsize",
              observedAt: "2026-11-01T14:00:00.000Z",
              estimatedCostUsd: 80_000_000,
            },
          }),
        ]}
      />
    );
    assert.match(narrativeAndDownsizeHtml, /Scope narrative revision/);
    assert.match(narrativeAndDownsizeHtml, /−\$15,000,000 capital/);
  });

  test("Sorts out-of-order observations chronologically without mutating input before computing forward deltas and latestCapitalUsd", () => {
    const shuffled = [...makeInterleavedObservations()].reverse();
    const html = renderToStaticMarkup(
      <ObservationTimeline projectNumbers={TWO_TRACKED_PROJECTS} observations={shuffled} />
    );
    const itemBlocks = html.split('<li class="gridlock-timeline-item"').slice(1);

    assert.equal(shuffled[0]?.observation.id, "obs-3697-2");
    assert.equal(itemBlocks.length, 3);
    assert.match(html, /latest \$148,000,000/);
    assert.match(itemBlocks[0]!, /2026-09-10[\s\S]*?Initial filing/);
    assert.match(itemBlocks[1]!, /2026-10-04[\s\S]*?Initial filing/);
    assert.match(itemBlocks[2]!, /2026-11-18[\s\S]*?\+\$53,000,000 capital/);
  });

  test("SSR renders inherit, diurnal, and nocturnal themes, enforces >= 0.75rem CSS floor, and handles empty observations", () => {
    const singleObs = [makeCitedObservation()];
    const inheritHtml = renderToStaticMarkup(
      <ObservationTimeline projectNumbers={["TABS2027003697"]} observations={singleObs} />
    );
    const diurnalHtml = renderToStaticMarkup(
      <ObservationTimeline projectNumbers={TWO_TRACKED_PROJECTS} observations={makeInterleavedObservations()} theme="diurnal" />
    );
    const nocturnalHtml = renderToStaticMarkup(
      <ObservationTimeline projectNumbers={TWO_TRACKED_PROJECTS} observations={[]} theme="nocturnal" />
    );

    assert.match(inheritHtml, /data-gridlock-theme="inherit"/);
    assert.match(inheritHtml, /<code class="gridlock-connector-chip">TABS2027003697<\/code>/);
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(diurnalHtml, /class="gridlock-tracked-projects"/);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(nocturnalHtml, /data-empty-timeline="true"/);
    assert.match(
      nocturnalHtml,
      /0 citable observations remain in active window for TABS2027003697, TABS2027004112\./
    );
    assert.doesNotMatch(nocturnalHtml, /<ol class="gridlock-timeline-rail">/);

    const styleBlock = diurnalHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) =>
      Number(m[1])
    );

    assert.ok(
      remFontSizes.length > 0 && remFontSizes.every((size) => size >= 0.75),
      "Expected all rem font-size rules >= 0.75rem"
    );
    assert.match(
      styleBlock,
      /\.gridlock-ast-card :where\(\.gridlock-timeline-item\[data-milestone="true"\] \.gridlock-timeline-marker\)\s*\{[^}]*background-color:\s*var\(--gridlock-accent\);/
    );
  });
});

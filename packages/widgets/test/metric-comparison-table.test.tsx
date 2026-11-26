import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricComparisonTable } from "../src/index.ts";
import {
  makeArtifactHash,
  makeCitedProject,
  makeEscapedShellCitedProject,
} from "./helpers/ast-card-fixtures.ts";
import { withWidgetDom } from "./helpers/dom-harness.ts";

function makeSubstationCitedProject() {
  const hash = makeArtifactHash("c");

  return makeCitedProject({
    project: {
      projectNumber: "TABS2027004112",
      projectName: "Taylor Switchyard \\[Substation Yard\\]",
      county: "Williamson",
      estimatedCostUsd: 52_000_000,
      squareFootage: 85_000,
      latestRawCaptureHash: hash,
    },
    citation: {
      sha256: hash,
    },
  });
}

describe("<MetricComparisonTable /> Seam 4 UI AST Card (Ticket #38 Phase 3)", () => {
  test("Preserves planner row order verbatim, computes cohort KPIs, framing prose, $/sq ft cells, and proportional 2px scale bars", () => {
    const rows = [
      makeEscapedShellCitedProject(),
      makeSubstationCitedProject(),
      makeCitedProject(),
    ];
    const html = renderToStaticMarkup(
      <MetricComparisonTable rows={rows} nodeId="comparison-corridor" theme="diurnal" />
    );

    assert.match(html, /data-ast-card="MetricComparisonTable"/);
    assert.match(html, /data-node-id="comparison-corridor"/);
    assert.match(html, /data-gridlock-theme="diurnal"/);
    assert.match(html, /3 projects/);
    assert.match(html, /2 counties represented/);
    assert.match(html, /\$218,500,000/);
    assert.match(html, /peak \$148,000,000 filing/);
    assert.match(html, /\$617 \/ sq ft/);
    assert.match(
      html,
      /Benchmarking 3 filings across Hays, Williamson Counties spanning \$18,500,000–\$148,000,000 declared capital\./
    );

    const rowBlocks = html.split("<tr data-project-number=").slice(1);
    assert.equal(rowBlocks.length, 3);

    assert.match(rowBlocks[0]!, /^"TABS2027004890"/);
    assert.match(rowBlocks[0]!, /San Marcos Logistics \[Phase 2\]/);
    assert.doesNotMatch(rowBlocks[0]!, /\\\[Phase 2\\\]/);
    assert.match(rowBlocks[0]!, /\[REDACTED_ADDRESS\]/);
    assert.match(rowBlocks[0]!, /\$60 \/ sq ft · \*Core &amp; Shell\*/);
    assert.match(rowBlocks[0]!, /class="gridlock-scale-bar" style="inline-size:12\.5%"/);

    assert.match(rowBlocks[1]!, /^"TABS2027004112"/);
    assert.match(rowBlocks[1]!, /Taylor Switchyard \[Substation Yard\]/);
    assert.match(rowBlocks[1]!, /\$612 \/ sq ft/);
    assert.match(rowBlocks[1]!, /class="gridlock-scale-bar" style="inline-size:35\.14%"/);

    assert.match(rowBlocks[2]!, /^"TABS2027003697"/);
    assert.match(rowBlocks[2]!, /\$617 \/ sq ft/);
    assert.match(rowBlocks[2]!, /class="gridlock-scale-bar" style="inline-size:100%"/);
  });

  test("Enforces < 38em accessible table CSS invariants, >= 0.75rem font floor, and empty rows state without table chrome", () => {
    const singleHtml = renderToStaticMarkup(<MetricComparisonTable rows={[makeCitedProject()]} />);
    const emptyNocturnalHtml = renderToStaticMarkup(
      <MetricComparisonTable rows={[]} theme="nocturnal" />
    );

    assert.match(singleHtml, /data-gridlock-theme="inherit"/);
    assert.match(singleHtml, /1 project</);
    assert.match(emptyNocturnalHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(emptyNocturnalHtml, /data-empty-comparison="true"/);
    assert.match(emptyNocturnalHtml, /0 projects selected for comparative density benchmarking\./);
    assert.doesNotMatch(emptyNocturnalHtml, /<table/);
    assert.doesNotMatch(emptyNocturnalHtml, /<dl class="gridlock-headline-stats">/);

    const styleBlock = singleHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) =>
      Number(m[1])
    );

    assert.ok(
      remFontSizes.length > 0 && remFontSizes.every((size) => size >= 0.75),
      "Expected all rem font-size rules >= 0.75rem"
    );
    assert.match(styleBlock, /@container\s*\(width\s*<\s*38em\)/);
    const theadRule =
      styleBlock.match(/:where\(\.gridlock-comparison-table thead\)\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(theadRule, /clip-path:\s*inset\(50%\);/);
    assert.doesNotMatch(theadRule, /display:\s*none/);

    for (const colIdx of [2, 3, 4, 5, 6]) {
      assert.match(
        styleBlock,
        new RegExp(
          `:where\\(\\.gridlock-comparison-table td:nth-child\\(${colIdx}\\)\\)::before\\s*\\{[^}]*content:\\s*var\\(--col-${colIdx}\\)`
        )
      );
    }
  });

  test("Forwards ref, copies row sha256 to clipboard, and resets data-copied synchronously on nodeId or rows swap", async () => {
    const initialRows = [makeCitedProject(), makeEscapedShellCitedProject()];
    const sameHashDifferentProject = [
      makeCitedProject({ project: { projectNumber: "TABS2027009101" } }),
    ];

    await withWidgetDom(async ({ container, root, getLastCopiedText }) => {
      const sectionRef = createRef<HTMLElement>();

      await act(async () => {
        root.render(
          <MetricComparisonTable ref={sectionRef} nodeId="table-a" rows={initialRows} />
        );
      });

      assert.equal(sectionRef.current?.tagName, "SECTION");
      const getFirstCopyBtn = () =>
        Array.from(container.querySelectorAll("button")).find((btn) =>
          btn.classList.contains("gridlock-copy-chip")
        );

      const firstBtn = getFirstCopyBtn();
      assert.ok(firstBtn);

      await act(async () => {
        firstBtn.click();
      });

      assert.equal(getLastCopiedText(), initialRows[0]!.citation.sha256);
      assert.equal(firstBtn.getAttribute("data-copied"), "true");

      await act(async () => {
        root.render(
          <MetricComparisonTable ref={sectionRef} nodeId="table-b" rows={initialRows} />
        );
      });

      assert.equal(getFirstCopyBtn()?.getAttribute("data-copied"), "false");

      await act(async () => {
        getFirstCopyBtn()?.click();
      });
      assert.equal(getFirstCopyBtn()?.getAttribute("data-copied"), "true");

      await act(async () => {
        root.render(
          <MetricComparisonTable
            ref={sectionRef}
            nodeId="table-b"
            rows={sameHashDifferentProject}
          />
        );
      });

      assert.equal(getFirstCopyBtn()?.getAttribute("data-copied"), "false");
    });
  });

  test("Sad Path: duplicate projectNumber, > 10 rows, or mismatched citation renders DossierErrorShell without Retry", () => {
    const duplicateRows = [makeCitedProject(), makeCitedProject()];
    const elevenRows = Array.from({ length: 11 }, (_, idx) =>
      makeCitedProject({
        project: { projectNumber: `TABS20270060${String(idx).padStart(2, "0")}` },
      })
    );
    const mismatchedCitationRows = [
      makeCitedProject({ citation: { sha256: makeArtifactHash("f") } }),
    ];

    for (const invalidNode of [
      <MetricComparisonTable key="dup" rows={duplicateRows} />,
      <MetricComparisonTable key="over-max" rows={elevenRows} />,
      <MetricComparisonTable key="bad-hash" rows={mismatchedCitationRows} />,
    ]) {
      const html = renderToStaticMarkup(invalidNode);
      assert.match(html, /role="alert"/);
      assert.match(html, /Malformed MetricComparisonTable props:/);
      assert.doesNotMatch(html, /Retry/);
    }
  });
});

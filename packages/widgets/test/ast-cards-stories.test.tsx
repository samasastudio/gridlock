import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GridlockPlateWidget, GridlockRepairLogWidget } from "../src/index.ts";
import astCardsMeta, * as astCardsStories from "../stories/GridlockAstCards.stories.tsx";
import { CanonicalAndBranchLineage } from "../stories/GridlockPlateWidget.stories.tsx";
import { HealedWithAmortization } from "../stories/GridlockRepairLogWidget.stories.tsx";
import { withWidgetDom } from "./helpers/dom-harness.ts";

const {
  CohortMetricComparison,
  EmptyComparisonTable,
  EmptyTimeline,
  InvestigativeBriefDiurnal,
  InvestigativeBriefNocturnal,
  MultiProjectObservationTimeline,
  StandaloneProjectDossier,
} = astCardsStories;

function extractZeroSpecificityWhereRules(css: string): ReadonlyMap<string, string> {
  return new Map(
    Array.from(
      css.matchAll(/^\s*(:where\([^{}]*)\s*\{([^}]*)\}/gm),
      (match) => [match[1]!.trim(), match[2]!.trim()]
    )
  );
}

describe("GridlockAstCards CSF3 Stories, Browser Boundary & Co-Mount Parity (Ticket #38)", () => {
  test("Browser-safe runtime boundary: widget barrel and Seam 4 CSF3 stories import zero node:* modules", () => {
    const guardScript = `
      import { registerHooks } from "node:module";
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith("node:")) {
            throw new Error("Browser-unsafe import: " + specifier);
          }
          return nextResolve(specifier, context);
        },
      });
      await import("./packages/widgets/src/index.ts");
      await import("./packages/widgets/stories/GridlockAstCards.stories.tsx");
    `;

    assert.doesNotThrow(() => {
      execFileSync(
        process.execPath,
        ["--import", "./scripts/tsx-loader.mjs", "--input-type=module", "-e", guardScript],
        { encoding: "utf-8" }
      );
    });
  });

  test("CSF3 story suite exports exact 7 stories, renders Live API and empty-brief fallbacks cleanly, and keeps disclosures closed", () => {
    const StoryComponent = astCardsMeta.component;
    const namedStoryKeys = Object.keys(astCardsStories)
      .filter((key) => key !== "default")
      .sort();

    assert.deepEqual(namedStoryKeys, [
      "CohortMetricComparison",
      "EmptyComparisonTable",
      "EmptyTimeline",
      "InvestigativeBriefDiurnal",
      "InvestigativeBriefNocturnal",
      "MultiProjectObservationTimeline",
      "StandaloneProjectDossier",
    ]);

    const briefDiurnalHtml = renderToStaticMarkup(
      <StoryComponent {...InvestigativeBriefDiurnal.args} />
    );
    assert.match(briefDiurnalHtml, /<article[^>]*class="gridlock-dossier-surface"[^>]*data-gridlock-theme="diurnal"/);
    assert.match(briefDiurnalHtml, /data-ast-card="ProjectDossierCard"/);
    assert.match(briefDiurnalHtml, /data-ast-card="ObservationTimeline"/);
    assert.match(briefDiurnalHtml, /data-ast-card="MetricComparisonTable"/);
    assert.match(briefDiurnalHtml, /<article[^>]*><header(?![^>]*gridlock-repair-header)(?![^>]*border)/);
    assert.doesNotMatch(briefDiurnalHtml, /<details[^>]*open/);

    const emptyBriefHtml = renderToStaticMarkup(
      <StoryComponent nodes={[]} surfaceMode="brief-sheet" theme="diurnal" />
    );
    assert.match(emptyBriefHtml, /<style[^>]*>[\s\S]*?\.gridlock-dossier-surface/);
    assert.match(emptyBriefHtml, /0 verified AST cards/);

    const briefNocturnalHtml = renderToStaticMarkup(
      <StoryComponent {...InvestigativeBriefNocturnal.args} />
    );
    assert.match(briefNocturnalHtml, /<article[^>]*data-gridlock-theme="nocturnal"/);
    assert.doesNotMatch(briefNocturnalHtml, /<details[^>]*open/);

    const liveFallbackHtml = renderToStaticMarkup(
      <StoryComponent apiBaseUrl="" theme="nocturnal" />
    );
    assert.match(liveFallbackHtml, /data-source-mode="live-fallback"/);
    assert.match(liveFallbackHtml, /data-gridlock-theme="nocturnal"/);
    assert.match(liveFallbackHtml, /3 verified AST cards/);
    assert.match(liveFallbackHtml, /data-ast-card="ProjectDossierCard"/);
    assert.match(liveFallbackHtml, /data-ast-card="ObservationTimeline"/);
    assert.match(liveFallbackHtml, /data-ast-card="MetricComparisonTable"/);
    assert.doesNotMatch(liveFallbackHtml, /<details[^>]*open/);

    const dossierHtml = renderToStaticMarkup(
      <StoryComponent {...StandaloneProjectDossier.args} />
    );
    assert.doesNotMatch(dossierHtml, /<article/);
    assert.match(dossierHtml, /data-ast-card="ProjectDossierCard"/);
    assert.match(dossierHtml, /\$617 \/ sq ft capital intensity/);
    assert.doesNotMatch(dossierHtml, /<details[^>]*open/);

    const timelineHtml = renderToStaticMarkup(
      <StoryComponent {...MultiProjectObservationTimeline.args} />
    );
    assert.match(timelineHtml, /data-ast-card="ObservationTimeline"/);
    assert.match(timelineHtml, /\+\$53,000,000 capital/);
    assert.match(timelineHtml, /\[Substation Yard\] \*Phase 1\*/);

    const comparisonHtml = renderToStaticMarkup(
      <StoryComponent {...CohortMetricComparison.args} />
    );
    assert.match(comparisonHtml, /data-ast-card="MetricComparisonTable"/);
    assert.match(comparisonHtml, /\[REDACTED_ADDRESS\], San Marcos, TX 78666/);

    const emptyTimelineHtml = renderToStaticMarkup(
      <StoryComponent {...EmptyTimeline.args} />
    );
    assert.match(emptyTimelineHtml, /data-empty-timeline="true"/);
    assert.match(emptyTimelineHtml, /TABS2027003697, TABS2027004112/);

    const emptyComparisonHtml = renderToStaticMarkup(
      <StoryComponent {...EmptyComparisonTable.args} />
    );
    assert.match(emptyComparisonHtml, /data-empty-comparison="true"/);
    assert.doesNotMatch(emptyComparisonHtml, /<table/);
  });

  test("Co-mounting InvestigativeBriefDiurnal ahead of Plate and Repair widgets deduplicates <style> and preserves nested AST framing", async () => {
    const StoryComponent = astCardsMeta.component;

    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => {
        root.render(
          <div>
            <StoryComponent {...InvestigativeBriefDiurnal.args} />
            <GridlockPlateWidget {...CanonicalAndBranchLineage.args} />
            <GridlockRepairLogWidget {...HealedWithAmortization.args} />
          </div>
        );
      });

      assert.equal(container.querySelectorAll("[data-ast-card]").length, 3);
      assert.ok(container.querySelector(".gridlock-plate-viewport"));
      assert.ok(container.querySelector(".gridlock-chart-frame"));

      const styleContents = Array.from(win.document.querySelectorAll("style")).map(
        (el) => el.textContent ?? ""
      );
      const astIdx = styleContents.findIndex((css) => css.includes(".gridlock-ast-card"));
      const plateIdx = styleContents.findIndex((css) => css.includes(".gridlock-plate-tab-indicator"));
      const repairIdx = styleContents.findIndex((css) => css.includes(".gridlock-version-tab"));

      assert.equal(styleContents.filter((css) => css.includes(".gridlock-ast-card")).length, 1);
      assert.ok(astIdx >= 0 && astIdx < plateIdx && astIdx < repairIdx);

      const astRules = extractZeroSpecificityWhereRules(styleContents[astIdx]!);
      const plateRules = extractZeroSpecificityWhereRules(styleContents[plateIdx]!);
      const repairRules = extractZeroSpecificityWhereRules(styleContents[repairIdx]!);
      assert.ok(astRules.size >= 25);

      for (const [selector, astBody] of astRules) {
        assert.equal(plateRules.get(selector), astBody, `Plate mismatch on ${selector}`);
        assert.equal(repairRules.get(selector), astBody, `Repair mismatch on ${selector}`);
      }

      for (const el of win.document.querySelectorAll("style")) {
        assert.match(el.textContent ?? "", /^@layer gridlock-widgets\s*\{[\s\S]*\}\s*$/);
        el.textContent = (el.textContent ?? "").replace(
          /^@layer gridlock-widgets\s*\{([\s\S]*)\}\s*$/,
          "$1"
        );
      }

      const nestedCard = container.querySelector("article.gridlock-dossier-surface .gridlock-ast-card");
      const nestedHeader = nestedCard?.querySelector(".gridlock-repair-header") ?? null;
      assert.ok(nestedCard && nestedHeader);

      const cardStyle = win.getComputedStyle(nestedCard);
      const headerStyle = win.getComputedStyle(nestedHeader);
      assert.equal(cardStyle.borderLeftWidth, "0px");
      assert.match(cardStyle.getPropertyValue("border-block-start"), /^1px solid/);
      assert.match(cardStyle.getPropertyValue("padding-inline"), /^0(?:px)?$/);
      assert.equal(cardStyle.backgroundColor, "transparent");
      assert.match(headerStyle.getPropertyValue("margin-block-end"), /^0(?:px)?$/);
    });
  });
});

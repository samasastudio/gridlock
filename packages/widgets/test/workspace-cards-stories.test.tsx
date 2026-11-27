import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GridlockTimelineWidget, GridlockRepairChangelogWidget } from "../src/index.ts";
import workspaceCardsMeta, * as workspaceCardsStories from "../stories/GridlockWorkspaceCards.stories.tsx";
import { CanonicalAndBranchTimeline } from "../stories/GridlockTimelineWidget.stories.tsx";
import { HealedWithAmortization } from "../stories/GridlockRepairChangelogWidget.stories.tsx";
import { withWidgetDom } from "./helpers/dom-harness.ts";

const {
  CohortMetricComparison,
  EmptyComparisonTable,
  EmptyTimeline,
  InvestigativeBriefDiurnal,
  InvestigativeBriefNocturnal,
  MultiProjectObservationTimeline,
  StandaloneProjectDossier,
} = workspaceCardsStories;

describe("GridlockWorkspaceCards CSF3 Stories, Browser Boundary & Co-Mount Parity (Ticket #38)", () => {
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
      await import("./packages/widgets/stories/GridlockWorkspaceCards.stories.tsx");
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
    const StoryComponent = workspaceCardsMeta.component;
    const namedStoryKeys = Object.keys(workspaceCardsStories)
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
    assert.match(briefDiurnalHtml, /data-workspace-card="ProjectDossierCard"/);
    assert.match(briefDiurnalHtml, /data-workspace-card="ObservationTimeline"/);
    assert.match(briefDiurnalHtml, /data-workspace-card="MetricComparisonTable"/);
    assert.match(briefDiurnalHtml, /<article[^>]*><header(?![^>]*gridlock-repair-header)(?![^>]*border)/);
    assert.doesNotMatch(briefDiurnalHtml, /<details[^>]*open/);

    const emptyBriefHtml = renderToStaticMarkup(
      <StoryComponent nodes={[]} surfaceMode="brief-sheet" theme="diurnal" />
    );
    assert.match(emptyBriefHtml, /<style[^>]*>[\s\S]*?\.gridlock-dossier-surface/);
    assert.match(emptyBriefHtml, /0 verified workspace cards/);

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
    assert.match(liveFallbackHtml, /3 verified workspace cards/);
    assert.match(liveFallbackHtml, /data-workspace-card="ProjectDossierCard"/);
    assert.match(liveFallbackHtml, /data-workspace-card="ObservationTimeline"/);
    assert.match(liveFallbackHtml, /data-workspace-card="MetricComparisonTable"/);
    assert.doesNotMatch(liveFallbackHtml, /<details[^>]*open/);

    const dossierHtml = renderToStaticMarkup(
      <StoryComponent {...StandaloneProjectDossier.args} />
    );
    assert.doesNotMatch(dossierHtml, /<article/);
    assert.match(dossierHtml, /data-workspace-card="ProjectDossierCard"/);
    assert.match(dossierHtml, /\$617 \/ sq ft capital intensity/);
    assert.doesNotMatch(dossierHtml, /<details[^>]*open/);

    const timelineHtml = renderToStaticMarkup(
      <StoryComponent {...MultiProjectObservationTimeline.args} />
    );
    assert.match(timelineHtml, /data-workspace-card="ObservationTimeline"/);
    assert.match(timelineHtml, /\+\$53,000,000 capital/);
    assert.match(timelineHtml, /\[Substation Yard\] \*Phase 1\*/);

    const comparisonHtml = renderToStaticMarkup(
      <StoryComponent {...CohortMetricComparison.args} />
    );
    assert.match(comparisonHtml, /data-workspace-card="MetricComparisonTable"/);
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

  test("Co-mounting InvestigativeBriefDiurnal ahead of Plate and Repair widgets deduplicates <style> and preserves nested workspace framing", async () => {
    const StoryComponent = workspaceCardsMeta.component;

    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => {
        root.render(
          <div>
            <StoryComponent {...InvestigativeBriefDiurnal.args} />
            <GridlockTimelineWidget {...CanonicalAndBranchTimeline.args} />
            <GridlockRepairChangelogWidget {...HealedWithAmortization.args} />
          </div>
        );
      });

      assert.equal(container.querySelectorAll("[data-workspace-card]").length, 3);
      assert.ok(container.querySelector(".gridlock-timeline-viewport"));
      assert.ok(container.querySelector(".gridlock-chart-frame"));

      const styleContents = Array.from(win.document.querySelectorAll("style")).map(
        (el) => el.textContent ?? ""
      );
      const isBaseSheet = (css: string) => /^\s*:where\(\.gridlock-dossier-surface\)\s*\{/m.test(css);
      const baseSheets = styleContents.filter(isBaseSheet);
      const workspaceSheets = styleContents.filter((css) => css.includes(".gridlock-workspace-card"));
      const timelineSheets = styleContents.filter((css) => css.includes(".gridlock-timeline-tab-indicator"));
      const repairSheets = styleContents.filter((css) => css.includes(".gridlock-version-tab"));

      assert.equal(baseSheets.length, 1, "Co-mounted widgets must emit exactly one deduplicated gridlock-dossier-base stylesheet");
      assert.equal(workspaceSheets.length, 1);
      assert.equal(timelineSheets.length, 1);
      assert.equal(repairSheets.length, 1);
      assert.ok(!isBaseSheet(workspaceSheets[0]!));
      assert.ok(!isBaseSheet(timelineSheets[0]!));
      assert.ok(!isBaseSheet(repairSheets[0]!));

      const allCss = styleContents.join("\n");
      assert.doesNotMatch(allCss, /var\(--(?:card|muted-foreground|border)\b/);

      for (const el of win.document.querySelectorAll("style")) {
        assert.match(el.textContent ?? "", /^@layer gridlock-widgets\s*\{[\s\S]*\}\s*$/);
        el.textContent = (el.textContent ?? "").replace(
          /^@layer gridlock-widgets\s*\{([\s\S]*)\}\s*$/,
          "$1"
        );
      }

      const nestedCard = container.querySelector("article.gridlock-dossier-surface .gridlock-workspace-card");
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

  test("Opposite-theme host CSS variables (--card, --muted-foreground, --border) do not leak into diurnal/nocturnal/inherit widgets while --paper/--ink inherit", async () => {
    await withWidgetDom(async ({ window: win, container, root }) => {
      await act(async () => {
        root.render(
          <div
            style={
              {
                "--paper": "#faf6ef",
                "--ink": "#191c20",
                "--card": "#000000",
                "--muted-foreground": "#ff00ff",
                "--border": "#00ff00",
              } as Record<string, string>
            }
          >
            <GridlockTimelineWidget {...CanonicalAndBranchTimeline.args} theme="diurnal" />
            <GridlockRepairChangelogWidget {...HealedWithAmortization.args} theme="nocturnal" />
            <GridlockRepairChangelogWidget {...HealedWithAmortization.args} theme="inherit" />
          </div>
        );
      });

      const styleElements = Array.from(win.document.querySelectorAll("style"));
      const baseSheets = styleElements.filter((el) => (el.textContent ?? "").includes(":where(.gridlock-dossier-surface)"));
      assert.equal(baseSheets.length, 1, "Co-mounted timeline + repair widgets must share one gridlock-dossier-base stylesheet");

      for (const el of styleElements) {
        assert.doesNotMatch(el.textContent ?? "", /var\(--(?:card|muted-foreground|border)\b/);
        el.textContent = (el.textContent ?? "").replace(/^@layer gridlock-widgets\s*\{([\s\S]*)\}\s*$/, "$1");
      }

      const diurnalSurface = container.querySelector('[data-gridlock-theme="diurnal"]');
      const nocturnalSurface = container.querySelector('[data-gridlock-theme="nocturnal"]');
      const inheritSurface = container.querySelector('[data-gridlock-theme="inherit"]');
      assert.ok(diurnalSurface && nocturnalSurface && inheritSurface);

      const diurnalStyle = win.getComputedStyle(diurnalSurface);
      const nocturnalStyle = win.getComputedStyle(nocturnalSurface);
      const inheritStyle = win.getComputedStyle(inheritSurface);

      assert.notEqual(diurnalStyle.getPropertyValue("--gridlock-card").trim(), "#000000");
      assert.notEqual(diurnalStyle.getPropertyValue("--gridlock-muted").trim(), "#ff00ff");
      assert.notEqual(nocturnalStyle.getPropertyValue("--gridlock-card").trim(), "#000000");
      assert.notEqual(nocturnalStyle.getPropertyValue("--gridlock-border").trim(), "#00ff00");
      assert.doesNotMatch(inheritStyle.getPropertyValue("--gridlock-card"), /--card/);
      assert.doesNotMatch(inheritStyle.getPropertyValue("--gridlock-muted"), /--muted-foreground/);
      assert.doesNotMatch(inheritStyle.getPropertyValue("--gridlock-border"), /--border/);
      assert.match(inheritStyle.getPropertyValue("--gridlock-paper"), /#faf6ef|var\(--paper/);
      assert.match(inheritStyle.getPropertyValue("--gridlock-ink"), /#191c20|var\(--ink/);
    });
  });
});

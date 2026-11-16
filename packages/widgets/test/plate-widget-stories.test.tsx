import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isWebpBuffer, SCENARIO_BRANCH_WATERMARK } from "@samasastudio/gridlock-core";
import { GridlockPlateWidget } from "../src/index.ts";
import plateWidgetMeta, * as plateStories from "../stories/GridlockPlateWidget.stories.tsx";

const {
  BrokenAssetFallback,
  CanonicalAndBranchLineage,
  EmptyLineage,
  NocturnalTheme,
  ScenarioBranchSelected,
  SingleFrameBootstrap,
} = plateStories;

describe("<GridlockPlateWidget /> CSF3 Stories & Browser Boundary (Ticket #34)", () => {
  test("Browser-safe runtime boundary: widget barrel and Seam 3 CSF3 stories import zero node:* modules", () => {
    const guardScript = `
      import { registerHooks } from "node:module";
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith("node:")) throw new Error("Browser-unsafe import: " + specifier);
          return nextResolve(specifier, context);
        },
      });
      await import("./packages/widgets/src/index.ts");
      await import("./packages/widgets/stories/GridlockPlateWidget.stories.tsx");
    `;
    assert.doesNotThrow(() => {
      execFileSync(
        process.execPath,
        ["--import", "./scripts/tsx-loader.mjs", "--input-type=module", "-e", guardScript],
        { encoding: "utf-8" }
      );
    });
  });

  test("CSF3 story suite exports exact 6 stories with valid lossless WebP overrides and closed-by-default provenance", () => {
    const StoryComponent = plateWidgetMeta.component;
    assert.equal(StoryComponent, GridlockPlateWidget);

    const namedStoryKeys = Object.keys(plateStories)
      .filter((key) => key !== "default")
      .sort();
    assert.deepEqual(namedStoryKeys, [
      "BrokenAssetFallback",
      "CanonicalAndBranchLineage",
      "EmptyLineage",
      "NocturnalTheme",
      "ScenarioBranchSelected",
      "SingleFrameBootstrap",
    ]);

    const overrideUris = Object.values(CanonicalAndBranchLineage.args.assetUrlOverrides ?? {});
    assert.equal(overrideUris.length, 3);
    for (const uri of overrideUris) {
      assert.match(uri, /^data:image\/webp;base64,/);
      const rawBytes = Buffer.from(uri.slice("data:image/webp;base64,".length), "base64");
      assert.equal(isWebpBuffer(rawBytes), true);
    }

    const canonicalHtml = renderToStaticMarkup(<StoryComponent {...CanonicalAndBranchLineage.args} />);
    assert.doesNotMatch(canonicalHtml, /<details[^>]*open/);
    assert.match(canonicalHtml, /sha256:bbbbbbbbbbbb/);
    assert.match(canonicalHtml, /tdlr-tabs filing/);
    assert.match(canonicalHtml, /90d TTL archived/);
    assert.match(canonicalHtml, /Inspect Stateful Painter provenance \(2 turns\)/);

    const branchHtml = renderToStaticMarkup(<StoryComponent {...ScenarioBranchSelected.args} />);
    assert.match(branchHtml, new RegExp(SCENARIO_BRANCH_WATERMARK));
    assert.match(branchHtml, /Inspect Stateful Painter provenance \(3 turns\)/);
    assert.match(branchHtml, /re-bootstrapped from parent WebP/);

    const singleHtml = renderToStaticMarkup(<StoryComponent {...SingleFrameBootstrap.args} />);
    assert.match(singleHtml, /1 Visual Plate(?!s)/);
    assert.match(singleHtml, /Inspect Stateful Painter provenance \(1 turn\)/);

    const emptyHtml = renderToStaticMarkup(<StoryComponent {...EmptyLineage.args} />);
    assert.match(emptyHtml, /data-empty-lineage="true"/);

    const fallbackHtml = renderToStaticMarkup(<StoryComponent {...BrokenAssetFallback.args} />);
    assert.match(fallbackHtml, /data-plate-fallback="true"/);
    assert.match(fallbackHtml, /Inspect Stateful Painter provenance \(2 turns\)/);

    const nocturnalHtml = renderToStaticMarkup(<StoryComponent {...NocturnalTheme.args} />);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);
  });
});

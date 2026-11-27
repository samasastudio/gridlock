import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CANONICAL_MILESTONE_LABEL } from "@samasastudio/gridlock-core";
import { ProjectDossierCard } from "../src/index.ts";
import {
  makeArtifactHash,
  makeCitedProject,
  makeEscapedShellCitedProject,
} from "./helpers/workspace-card-fixtures.ts";
import { extractStylesheetText, withWidgetDom } from "./helpers/dom-harness.ts";

describe("<ProjectDossierCard /> Seam 4 Workspace Card (Ticket #38 Phase 1)", () => {
  test("SSR renders inherit, diurnal, and nocturnal themes, enforces >= 0.75rem CSS floor, and defines standalone + nested hairline rules", () => {
    const computeProject = makeCitedProject();
    const inheritHtml = renderToStaticMarkup(
      <ProjectDossierCard citedProject={computeProject} nodeId="dossier-lead" />
    );
    const diurnalHtml = renderToStaticMarkup(
      <ProjectDossierCard citedProject={computeProject} theme="diurnal" />
    );
    const nocturnalHtml = renderToStaticMarkup(
      <ProjectDossierCard citedProject={computeProject} theme="nocturnal" />
    );

    assert.match(inheritHtml, /data-gridlock-theme="inherit"/);
    assert.match(inheritHtml, /data-workspace-card="ProjectDossierCard"/);
    assert.match(inheritHtml, /data-node-id="dossier-lead"/);
    assert.match(diurnalHtml, /data-gridlock-theme="diurnal"/);
    assert.match(nocturnalHtml, /data-gridlock-theme="nocturnal"/);

    const styleBlock = extractStylesheetText(diurnalHtml);
    const remFontSizes = Array.from(styleBlock.matchAll(/font-size:\s*([0-9.]+)rem/g), (m) =>
      Number(m[1])
    );

    assert.ok(
      remFontSizes.length > 0 && remFontSizes.every((size) => size >= 0.75),
      "Expected all rem font-size rules >= 0.75rem"
    );
    assert.match(
      styleBlock,
      /\.gridlock-workspace-card:where\(\.gridlock-dossier-surface\)\s*\{[^}]*border:\s*1px solid var\(--gridlock-border-strong\);/
    );
    assert.match(
      styleBlock,
      /\.gridlock-dossier-surface \.gridlock-workspace-card\s*\{[^}]*border:\s*0;[\s\S]*?border-block-start:\s*1px solid var\(--gridlock-border\);/
    );
  });

  test("Derives $/sq ft intensity, months vs. days build windows, unescapes CommonMark prose without corrupting [REDACTED_ADDRESS], and keeps <details> closed", () => {
    const computeHtml = renderToStaticMarkup(<ProjectDossierCard citedProject={makeCitedProject()} />);
    const shellHtml = renderToStaticMarkup(
      <ProjectDossierCard citedProject={makeEscapedShellCitedProject()} />
    );

    assert.match(computeHtml, /\$617 \/ sq ft capital intensity/);
    assert.match(computeHtml, /18[\s\S]*? mos/);
    assert.match(computeHtml, /Williamson County · 2027-02-01 → 2028-08-01/);
    assert.match(computeHtml, /Corgan Associates, Inc\./);
    assert.match(computeHtml, new RegExp(CANONICAL_MILESTONE_LABEL));
    assert.match(
      computeHtml,
      /<a[^>]*href="https:\/\/www\.tdlr\.texas\.gov\/TABS\/Search\/Project\/TABS2027003697"[^>]*target="_blank"[^>]*rel="noreferrer noopener"/
    );
    assert.doesNotMatch(computeHtml, /<details[^>]*open/);

    assert.match(shellHtml, /\$60 \/ sq ft capital intensity/);
    assert.match(shellHtml, /28[\s\S]*? days/);
    assert.match(shellHtml, /San Marcos Logistics \[Phase 2\]/);
    assert.match(shellHtml, /\*Core &amp; Shell\*/);
    assert.match(shellHtml, /\[REDACTED_ADDRESS\], San Marcos, TX 78666/);
    assert.match(shellHtml, /adjacent to \[REDACTED_ADDRESS\] buffer zone/);
    assert.doesNotMatch(shellHtml, /\\\[Phase 2\\\]/);
    assert.doesNotMatch(shellHtml, /\\\*Core/);
    assert.doesNotMatch(shellHtml, /Corgan Associates/);
    assert.match(shellHtml, /90-day non-milestone window/);
  });

  test("Forwards ref, copies 64-char sha256, and synchronously resets copy chip + <details> on citedProject or same-sha256 nodeId swap", async () => {
    const primary = makeCitedProject();
    const secondary = makeEscapedShellCitedProject();

    await withWidgetDom(async ({ container, root, getLastCopiedText }) => {
      const sectionRef = createRef<HTMLElement>();

      await act(async () => {
        root.render(<ProjectDossierCard ref={sectionRef} nodeId="node-a" citedProject={primary} />);
      });

      assert.equal(sectionRef.current?.tagName, "SECTION");
      assert.equal(sectionRef.current?.getAttribute("data-gridlock-theme"), "inherit");

      const getCopyBtn = () =>
        Array.from(container.querySelectorAll("button")).find((btn) =>
          btn.classList.contains("gridlock-copy-chip")
        );

      const copyBtn = getCopyBtn();
      const detailsEl = container.querySelector("details");
      assert.ok(copyBtn && detailsEl);
      assert.equal(detailsEl.open, false);

      await act(async () => {
        copyBtn.click();
        detailsEl.open = true;
      });

      assert.equal(getLastCopiedText(), primary.citation.sha256);
      assert.equal(copyBtn.getAttribute("data-copied"), "true");
      assert.equal(detailsEl.open, true);

      await act(async () => {
        root.render(<ProjectDossierCard ref={sectionRef} nodeId="node-b" citedProject={primary} />);
      });

      assert.equal(getCopyBtn()?.getAttribute("data-copied"), "false");
      assert.equal(container.querySelector("details")?.open, false);

      const nextDetails = container.querySelector("details");
      assert.ok(nextDetails);

      await act(async () => {
        getCopyBtn()?.click();
        nextDetails.open = true;
      });
      assert.equal(getCopyBtn()?.getAttribute("data-copied"), "true");
      assert.equal(nextDetails.open, true);

      await act(async () => {
        root.render(<ProjectDossierCard ref={sectionRef} nodeId="node-b" citedProject={secondary} />);
      });

      assert.equal(getCopyBtn()?.getAttribute("data-copied"), "false");
      assert.equal(container.querySelector("details")?.open, false);
    });
  });

  test("Sad Path: mismatched citation sha256, non-HTTP sourceUrl, or unsafe nodeId renders DossierErrorShell without Retry", () => {
    const mismatched = makeCitedProject({ citation: { sha256: makeArtifactHash("f") } });
    const ftpCitation = makeCitedProject({
      citation: { sourceUrl: "ftp://files.tdlr.texas.gov/project.html" },
    });

    for (const invalidNode of [
      <ProjectDossierCard key="mismatch" citedProject={mismatched} />,
      <ProjectDossierCard key="ftp" citedProject={ftpCitation} />,
      <ProjectDossierCard key="bad-id" citedProject={makeCitedProject()} nodeId="../unsafe/id" />,
    ]) {
      const html = renderToStaticMarkup(invalidNode);
      assert.match(html, /role="alert"/);
      assert.match(html, /Malformed ProjectDossierCard props:/);
      assert.doesNotMatch(html, /Retry/);
    }
  });
});

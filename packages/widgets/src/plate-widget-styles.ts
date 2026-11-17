import { GRIDLOCK_DOSSIER_BASE_CSS } from "./dossier-styles.ts";

export const GRIDLOCK_PLATE_WIDGET_STYLESHEET = `@layer gridlock-widgets {
${GRIDLOCK_DOSSIER_BASE_CSS}
  :where(.gridlock-plate-stage:not(.gridlock-dossier-surface *)) {
    --gridlock-paper: var(--paper, var(--background, var(--atlas-paper, #f4efe6)));
    --gridlock-ink: var(--ink, var(--foreground, var(--atlas-ink, #18181b)));
    --gridlock-card: var(--card, color-mix(in oklab, var(--gridlock-paper) 92%, var(--gridlock-ink)));
    --gridlock-muted: var(--muted-foreground, color-mix(in oklab, var(--gridlock-ink) 68%, var(--gridlock-paper)));
    --gridlock-border: var(--border, color-mix(in oklab, var(--gridlock-ink) 16%, transparent));
    --gridlock-border-strong: color-mix(in oklab, var(--gridlock-ink) 26%, transparent);
    --gridlock-accent: var(--signal-coral, #e06d53); --gridlock-radius: 0rem;
    --gridlock-font-display: var(--font-display, "Geomanist", "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-serif: var(--font-serif, "Tinos", Georgia, serif);
    --gridlock-font-sans: var(--font-sans, "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-mono: var(--font-mono, "Google Sans Code", ui-monospace, SFMono-Regular, monospace);
    color: var(--gridlock-ink); font-family: var(--gridlock-font-sans); font-size-adjust: from-font; line-height: 1.5; container-type: inline-size;
  }
  :where(.gridlock-plate-stage code) { font-family: var(--gridlock-font-mono); font-size-adjust: from-font; font-variant-numeric: tabular-nums; font-size: max(0.75rem, 0.875em); }
  :where(.gridlock-plate-stage :is(button, a, [role="button"], [tabindex="0"], summary)):focus-visible { outline: 2px solid var(--gridlock-ink); outline-offset: 2px; }
  :where(.gridlock-plate-widget .gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-block-end: 1.35rem; margin-block-end: 1.75rem; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-plate-widget .gridlock-title-block) { display: flex; flex-direction: column; gap: 0.5rem; min-inline-size: 0; max-inline-size: 100%; }
  :where(.gridlock-plate-widget .gridlock-dossier-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--gridlock-font-display); font-size: clamp(1.35rem, 1.15rem + 0.55cqi, 1.65rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.1; }
  :where(.gridlock-plate-widget .gridlock-connector-chip) { display: inline-flex; align-items: center; max-inline-size: 100%; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  :where(.gridlock-plate-widget .gridlock-title-rule) { block-size: 2px; inline-size: 2.75rem; background-color: var(--gridlock-ink); }
  :where(.gridlock-plate-widget .gridlock-header-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
  :where(.gridlock-plate-widget .gridlock-scorecard-section) { display: flex; flex-direction: column; gap: 1.75rem; }
  :where(.gridlock-plate-widget .gridlock-headline-stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1.25rem 2rem; }
  :where(.gridlock-plate-widget .gridlock-headline-stat) { display: flex; flex-direction: column; gap: 0.35rem; min-inline-size: 0; }
  @container (width >= 42em) {
    :where(.gridlock-plate-widget .gridlock-headline-stat + .gridlock-headline-stat) { padding-inline-start: 1.75rem; border-inline-start: 1px solid var(--gridlock-border); }
  }
  :where(.gridlock-plate-widget .gridlock-headline-stat dt) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-plate-widget .gridlock-kpi-value) { display: block; contain: layout style; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: clamp(2rem, 1.65rem + 1.1vw, 2.75rem); font-weight: 900; letter-spacing: -0.03em; line-height: 1.02; font-variant-numeric: tabular-nums; color: var(--gridlock-ink); }
  :where(.gridlock-plate-widget .gridlock-kpi-sub) { display: block; margin-block-start: 0.25rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-plate-widget .gridlock-plate-stage) { margin-block-start: 2.25rem; padding-block-start: 1.5rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-plate-stage) { display: flex; flex-direction: column; gap: 1rem; min-inline-size: 0; }
  :where(.gridlock-plate-scrubber-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; border-block-end: 1px solid var(--gridlock-border); padding-block-end: 0.5rem; }
  :where(.gridlock-plate-stage .gridlock-section-heading) { margin: 0; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: 0.875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-ink); }
  :where(.gridlock-plate-stage .gridlock-tab-list) { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; max-inline-size: 100%; }
  :where(.gridlock-plate-tab) { position: relative; min-block-size: 2.35rem; padding-inline: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: var(--gridlock-radius); background-color: transparent; color: var(--gridlock-muted); font-family: var(--gridlock-font-mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-plate-tab:hover, .gridlock-plate-tab[aria-selected="true"]) { color: var(--gridlock-ink); background-color: var(--gridlock-card); }
  :where(.gridlock-branch-dot) { display: inline-block; flex-shrink: 0; inline-size: 0.45rem; block-size: 0.45rem; background-color: var(--gridlock-accent); }
  :where(.gridlock-plate-tab-indicator) { position: absolute; inset-inline: 0; inset-block-end: 0; block-size: 2px; background-color: var(--gridlock-accent); }
  :where(.gridlock-plate-panel) { display: flex; flex-direction: column; gap: 1.15rem; min-inline-size: 0; }
  :where(.gridlock-plate-viewport) {
    margin: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--gridlock-border-strong);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    box-shadow: none;
    min-inline-size: 0;
  }
  :where(.gridlock-plate-viewport[data-branch="true"]) { border-color: var(--gridlock-accent); }
  :where(.gridlock-plate-meta-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.65rem 1rem; padding-block: 0.65rem; padding-inline: clamp(0.85rem, 2cqi, 1.25rem); border-block-end: 1px solid var(--gridlock-border); background-color: var(--gridlock-paper); }
  :where(.gridlock-plate-stage .gridlock-status-badge) { padding-block: 0.25rem; }
  :where(.gridlock-plate-turn-stamp) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-inline-size: 0; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-plate-img, .gridlock-plate-fallback) {
    margin-block-start: auto;
  }
  :where(.gridlock-plate-img) { display: block; inline-size: 100%; block-size: auto; aspect-ratio: 16 / 9; object-fit: cover; }
  :where(.gridlock-plate-fallback) { display: flex; flex-direction: column; justify-content: center; gap: 0.55rem; min-block-size: 13rem; padding: clamp(1rem, 3cqi, 1.75rem); background-color: var(--gridlock-card); color: var(--gridlock-ink); }
  :where(.gridlock-plate-fallback-head) { display: inline-flex; align-items: center; gap: 0.55rem; font-family: var(--gridlock-font-display); font-size: 0.9375rem; font-weight: 700; }
  :where(.gridlock-plate-fallback-copy) { margin: 0; max-inline-size: 62ch; font-size: 0.875rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-plate-stage .gridlock-empty-row) { margin: 0; display: flex; align-items: center; gap: 0.55rem; padding-block: 1.25rem 0.25rem; font-size: 0.9375rem; color: var(--gridlock-ink); }
  :where(.gridlock-plate-specimen) { display: flex; flex-direction: column; gap: 0.85rem; padding-block-start: 0.25rem; min-inline-size: 0; }
  :where(.gridlock-plate-lead) { max-inline-size: 64ch; font-family: var(--gridlock-font-serif); font-size-adjust: from-font; font-size: clamp(1.15rem, 1.05rem + 0.35vw, 1.32rem); line-height: 1.62; color: var(--gridlock-ink); }
  :where(.gridlock-plate-stage .gridlock-inline-meta) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.65rem; min-inline-size: 0; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-additional-obs) { margin: 0; padding-inline-start: 1.15rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.875rem; color: var(--gridlock-ink); overflow-wrap: anywhere; }
  :where(.gridlock-additional-obs-meta) { font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-citations-row) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem 0.9rem; padding-block-start: 0.15rem; }
  :where(.gridlock-citation-item) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; max-inline-size: 100%; }
  :where(.gridlock-citation-link) { display: inline-flex; align-items: center; gap: 0.3rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-ink); text-decoration: underline; text-decoration-color: var(--gridlock-border-strong); transition: color 240ms cubic-bezier(0.16, 1, 0.3, 1), text-decoration-color 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-citation-link:hover) { text-decoration-color: var(--gridlock-accent); }
  :where(.gridlock-citation-aged) { display: inline-flex; align-items: center; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-plate-disclosure) { margin-block-start: 0.35rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-plate-disclosure-summary) { list-style: none; display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 2.5rem; cursor: pointer; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); transition: color 300ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-plate-disclosure-summary::-webkit-details-marker) { display: none; }
  :where(.gridlock-plate-disclosure-summary)::before { content: "+"; font-family: var(--gridlock-font-mono); font-size: 0.875rem; color: var(--gridlock-accent); }
  :where(.gridlock-plate-disclosure[open] > .gridlock-plate-disclosure-summary)::before { content: "−"; }
  :where(.gridlock-plate-disclosure-summary:hover) { color: var(--gridlock-ink); }
  @keyframes gridlock-plate-disclosure-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  :where(.gridlock-plate-disclosure-body) { display: flex; flex-direction: column; gap: 0.75rem; padding-block: 0.5rem 0.25rem; min-inline-size: 0; }
  :where(.gridlock-plate-disclosure[open] > .gridlock-plate-disclosure-body) { animation: gridlock-plate-disclosure-in 480ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-plate-invariant-strip) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding-block: 0.65rem; padding-inline: 0.9rem; background-color: var(--gridlock-card); border: 1px solid var(--gridlock-border); font-size: 0.8125rem; overflow-wrap: anywhere; }
  :where(.gridlock-plate-stage .gridlock-provenance-meta) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-plate-stage .gridlock-provenance-meta .gridlock-copy-chip) { max-inline-size: 100%; overflow-wrap: anywhere; text-align: start; }
  :where(.gridlock-provenance-hops) { margin: 0; padding-inline-start: 1.25rem; display: flex; flex-direction: column; gap: 0.45rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-ink); }
  :where(.gridlock-provenance-hop) { line-height: 1.45; overflow-wrap: anywhere; }
  :where(.gridlock-hop-btn) { padding-block: 0.15rem; padding-inline: 0.45rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-mono); font-size: 0.75rem; text-align: start; cursor: pointer; overflow-wrap: anywhere; transition: border-color 240ms cubic-bezier(0.16, 1, 0.3, 1), background-color 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-hop-btn:hover) { border-color: var(--gridlock-accent); background-color: var(--gridlock-card); }
  :where(.gridlock-hop-note) { display: inline-block; margin-inline-start: 0.45rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-painter-prompt) { padding-block: 0.6rem; padding-inline: 0.9rem; border: 1px solid var(--gridlock-border); background-color: var(--gridlock-card); font-size: 0.8125rem; color: var(--gridlock-ink); overflow-wrap: anywhere; }

  :where(.gridlock-plate-compare-bar) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    padding-block: 0.55rem;
    padding-inline: clamp(0.85rem, 2cqi, 1.25rem);
    border: 1px solid var(--gridlock-border);
    background-color: var(--gridlock-card);
  }

  :where(.gridlock-plate-compare-context) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    min-inline-size: 0;
    max-inline-size: 100%;
    font-family: var(--gridlock-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    overflow-wrap: anywhere;
  }

  :where(.gridlock-plate-compare-toggle[aria-pressed="true"]) {
    color: var(--atlas-ink, #18181b);
    border-color: var(--gridlock-accent);
  }

  :where(.gridlock-plate-compare-toggle[aria-pressed="true"])::before {
    transform: scaleX(1);
  }

  :where(.gridlock-plate-comparison-grid) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    min-inline-size: 0;
  }

  @container (width >= 42em) {
    :where(.gridlock-plate-comparison-grid) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-plate-disclosure[open] > .gridlock-plate-disclosure-body) { animation: none; }
    :where(.gridlock-plate-tab, .gridlock-plate-disclosure-summary, .gridlock-citation-link, .gridlock-hop-btn) { transition: none; }
  }

  @media (forced-colors: active) {
    :where(.gridlock-plate-compare-toggle[aria-pressed="true"]) {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
}`;

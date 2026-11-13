import { GRIDLOCK_DOSSIER_BASE_CSS } from "./dossier-styles.ts";

export const GRIDLOCK_REPAIR_LOG_STYLESHEET = `@layer gridlock-widgets {
${GRIDLOCK_DOSSIER_BASE_CSS}
  :where(.gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-block-end: 1.35rem; margin-block-end: 1.75rem; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-title-block) { display: flex; flex-direction: column; gap: 0.5rem; }
  :where(.gridlock-dossier-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--gridlock-font-display); font-size: clamp(1.35rem, 1.15rem + 0.55cqi, 1.65rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.1; }
  :where(.gridlock-connector-chip) { display: inline-flex; align-items: center; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; }
  :where(.gridlock-title-rule) { block-size: 2px; inline-size: 2.75rem; background-color: var(--gridlock-ink); }
  :where(.gridlock-header-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
  :where(.gridlock-scorecard-section) { display: flex; flex-direction: column; gap: 1.75rem; }
  :where(.gridlock-headline-stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1.25rem 2rem; }
  :where(.gridlock-headline-stat) { display: flex; flex-direction: column; gap: 0.35rem; }
  @container (width >= 42em) {
    :where(.gridlock-headline-stat + .gridlock-headline-stat) { padding-inline-start: 1.75rem; border-inline-start: 1px solid var(--gridlock-border); }
  }
  :where(.gridlock-headline-stat dt) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-kpi-value) { display: block; contain: layout style; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: clamp(2rem, 1.65rem + 1.1vw, 2.75rem); font-weight: 900; letter-spacing: -0.03em; line-height: 1.02; font-variant-numeric: tabular-nums; color: var(--gridlock-ink); }
  :where(.gridlock-kpi-sub) { display: block; margin-block-start: 0.25rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-chart-frame) { display: flex; flex-direction: column; gap: 0.75rem; background-color: var(--gridlock-card); border-block: 1px solid var(--gridlock-border-strong); padding-block: 1.1rem 0.9rem; padding-inline: clamp(0.9rem, 2cqi, 1.35rem); }
  :where(.gridlock-chart-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.25rem; }
  :where(.gridlock-chart-title) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-chart-legend) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 1rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-ink); }
  :where(.gridlock-legend-item) { display: inline-flex; align-items: center; gap: 0.4rem; }
  :where(.gridlock-legend-swatch) { display: inline-block; inline-size: 0.9rem; block-size: 2px; background-color: var(--gridlock-ink); }
  :where(.gridlock-legend-swatch[data-swatch="actual"]) { background: repeating-linear-gradient(to right, var(--gridlock-accent) 0 4px, transparent 4px 7px); }
  :where(.gridlock-line-svg) { display: block; inline-size: 100%; block-size: auto; min-block-size: 8.5rem; overflow: visible; }
  :where(.gridlock-chart-marker) { cursor: pointer; }
  :where(.gridlock-chart-axis) { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-changelog-section) { margin-block-start: 2.25rem; padding-block-start: 1.5rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-changelog-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; border-block-end: 1px solid var(--gridlock-border); padding-block-end: 0.5rem; }
  :where(.gridlock-section-heading) { font-family: var(--gridlock-font-display); font-size: 0.875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-ink); }
  :where(.gridlock-tab-list) { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; }
  :where(.gridlock-version-tab) { position: relative; min-block-size: 2.35rem; padding-inline: 0.85rem; display: inline-flex; align-items: center; border: 0; border-radius: var(--gridlock-radius); background-color: transparent; color: var(--gridlock-muted); font-family: var(--gridlock-font-mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-version-tab:hover, .gridlock-version-tab[aria-selected="true"]) { color: var(--gridlock-ink); background-color: var(--gridlock-card); }
  :where(.gridlock-tab-indicator) { position: absolute; inset-inline: 0; inset-block-end: -0.55rem; block-size: 2px; background-color: var(--gridlock-accent); }
  :where(.gridlock-empty-row) { display: flex; align-items: center; gap: 0.55rem; padding-block: 1.25rem 0.25rem; font-size: 0.9375rem; color: var(--gridlock-ink); }
  :where(.gridlock-specimen-panel) { display: flex; flex-direction: column; gap: 1rem; padding-block-start: 1.25rem; }
  :where(.gridlock-root-cause) { max-inline-size: 62ch; font-family: var(--gridlock-font-serif); font-size-adjust: from-font; font-size: clamp(1.15rem, 1.05rem + 0.35vw, 1.32rem); line-height: 1.62; color: var(--gridlock-ink); }
  :where(.gridlock-inline-meta) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.65rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-verified-inline) { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--gridlock-ink); }
  :where(.gridlock-patch-disclosure) { margin-block-start: 0.25rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-patch-summary) { list-style: none; display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 2.5rem; cursor: pointer; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); transition: color 300ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-patch-summary::-webkit-details-marker) { display: none; }
  :where(.gridlock-patch-summary)::before { content: "+"; font-family: var(--gridlock-font-mono); font-size: 0.875rem; color: var(--gridlock-accent); }
  :where(.gridlock-patch-disclosure[open] > .gridlock-patch-summary)::before { content: "−"; }
  :where(.gridlock-patch-summary:hover) { color: var(--gridlock-ink); }
  @keyframes gridlock-disclosure-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  :where(.gridlock-patch-body) { display: flex; flex-direction: column; gap: 0.75rem; padding-block: 0.5rem 0.25rem; }
  :where(.gridlock-patch-disclosure[open] > .gridlock-patch-body) { animation: gridlock-disclosure-in 480ms cubic-bezier(0.16, 1, 0.3, 1); }
  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-patch-disclosure[open] > .gridlock-patch-body) { animation: none; }
    :where(.gridlock-version-tab, .gridlock-patch-summary) { transition: none; }
  }
  :where(.gridlock-invariant-strip) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding-block: 0.65rem; padding-inline: 0.9rem; background-color: var(--gridlock-card); border: 1px solid var(--gridlock-border); font-size: 0.8125rem; }
  :where(.gridlock-provenance-meta) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-diff-scroll) { overflow: auto; max-inline-size: 100%; container-type: inline-size; border: 1px solid var(--gridlock-border); }
  :where(.gridlock-diff-table) { inline-size: 100%; border-collapse: separate; border-spacing: 0; --label-2: "Before"; --label-3: "After"; font-size: 0.8125rem; }
  :where(.gridlock-diff-table caption) { padding-block: 0.55rem; padding-inline: 0.9rem; text-align: start; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); background-color: var(--gridlock-card); border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-diff-table thead) { position: sticky; inset-block-start: 0; z-index: 1; background-color: var(--gridlock-paper); }
  :where(.gridlock-diff-table thead th) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-diff-table tbody th) { position: sticky; inset-inline-start: 0; background-color: var(--gridlock-card); text-align: start; font-weight: 600; }
  :where(.gridlock-diff-table th, .gridlock-diff-table td) { padding-block: 0.55rem; padding-inline: 0.9rem; border-block-end: 1px solid var(--gridlock-border); text-align: start; vertical-align: top; }
  :where(.gridlock-diff-table tbody tr:last-child :is(th, td)) { border-block-end: 0; }
  :where(.gridlock-diff-before) { color: var(--gridlock-muted); background-color: var(--gridlock-paper); }
  :where(.gridlock-diff-after) { color: var(--gridlock-ink); background-color: var(--gridlock-card); }
  @container (width < 34em) {
    :where(.gridlock-diff-table, .gridlock-diff-table caption, .gridlock-diff-table tbody, .gridlock-diff-table tr, .gridlock-diff-table th, .gridlock-diff-table td) { display: block; inline-size: 100%; }
    :where(.gridlock-diff-table thead) { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    :where(.gridlock-diff-table tbody th) { position: sticky; inset-block-start: 0; z-index: 2; }
    :where(.gridlock-diff-table td:nth-child(2))::before { content: var(--label-2) ": "; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    :where(.gridlock-diff-table td:nth-child(3))::before { content: var(--label-3) ": "; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  }
}`;

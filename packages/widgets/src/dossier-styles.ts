import { createElement } from "react";

const GRIDLOCK_DOSSIER_BASE_STYLESHEET = `@layer gridlock-widgets {
  :where(.gridlock-dossier-surface, .gridlock-timeline-stage:not(.gridlock-dossier-surface *)) {
    --gridlock-paper: var(--paper, var(--background, var(--atlas-paper, #f4efe6)));
    --gridlock-ink: var(--ink, var(--foreground, var(--atlas-ink, #18181b)));
    --gridlock-card: color-mix(in oklab, var(--gridlock-paper) 92%, var(--gridlock-ink));
    --gridlock-muted: color-mix(in oklab, var(--gridlock-ink) 68%, var(--gridlock-paper));
    --gridlock-border: color-mix(in oklab, var(--gridlock-ink) 16%, transparent);
    --gridlock-border-strong: color-mix(in oklab, var(--gridlock-ink) 26%, transparent);
    --gridlock-accent: var(--signal-coral, #e06d53); --gridlock-radius: 0rem;
    --gridlock-font-display: var(--font-display, "Geomanist", "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-serif: var(--font-serif, "Tinos", Georgia, serif);
    --gridlock-font-sans: var(--font-sans, "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-mono: var(--font-mono, "Google Sans Code", ui-monospace, SFMono-Regular, monospace);
    color: var(--gridlock-ink); font-family: var(--gridlock-font-sans); font-size-adjust: from-font; line-height: 1.5; container-type: inline-size;
  }
  :where(.gridlock-dossier-surface) {
    background-color: var(--gridlock-paper); border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); box-shadow: none;
    padding: clamp(1.25rem, 1rem + 1.5cqi, 2rem); accent-color: var(--gridlock-accent); caret-color: var(--gridlock-accent); scrollbar-color: var(--gridlock-muted) transparent;
    transition: background-color 650ms cubic-bezier(0.16, 1, 0.3, 1), color 650ms cubic-bezier(0.16, 1, 0.3, 1), border-color 650ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .gridlock-dossier-surface[data-gridlock-theme="diurnal"] {
    color-scheme: only light; --paper: var(--atlas-paper, #f4efe6); --ink: var(--atlas-ink, #18181b);
    --gridlock-paper: var(--paper); --gridlock-ink: var(--ink); --gridlock-card: var(--atlas-mist, #edf0ee); --gridlock-muted: var(--atlas-charcoal, #4a525a);
    --gridlock-border: oklch(0.205 0.006 285 / 16%); --gridlock-border-strong: oklch(0.205 0.006 285 / 26%); --relief-sky-mid: #6e7c87; --relief-coral-mid: #e06d53;
    background-color: var(--gridlock-paper); color: var(--gridlock-ink); accent-color: var(--gridlock-accent); caret-color: var(--gridlock-accent);
  }
  .gridlock-dossier-surface[data-gridlock-theme="nocturnal"] {
    color-scheme: only dark; --paper: var(--terrain-estuary, oklch(0.215 0.026 244)); --ink: var(--atlas-paper, #f4efe6);
    --gridlock-paper: var(--paper); --gridlock-ink: var(--ink); --gridlock-card: var(--terrain-ridge-dark, #22272d); --gridlock-muted: var(--signal-lichen, #a3b19b);
    --gridlock-border: oklch(0.952 0.015 84 / 16%); --gridlock-border-strong: oklch(0.952 0.015 84 / 26%); --relief-sky-mid: #6e88a1; --relief-coral-mid: #e06d53;
    background-color: var(--gridlock-paper); color: var(--gridlock-ink); accent-color: var(--gridlock-accent); caret-color: var(--gridlock-accent);
  }
  :where(.gridlock-dossier-surface) ::selection { background-color: var(--gridlock-ink); color: var(--gridlock-paper); }
  :where(.gridlock-dossier-surface :is(h2, h3, h4, p, dl, dd, ol, figure)) { margin: 0; }
  :where(.gridlock-dossier-surface :is(h2, h3, h4)) { font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; }
  :where(:is(.gridlock-dossier-surface, .gridlock-timeline-stage) code) { font-family: var(--gridlock-font-mono); font-size-adjust: from-font; font-variant-numeric: tabular-nums; font-size: max(0.75rem, 0.875em); }
  :where(.gridlock-dossier-surface a) { text-underline-offset: 0.2em; }
  :where(.gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-block-end: 1.35rem; margin-block-end: 1.75rem; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-title-block) { display: flex; flex-direction: column; gap: 0.5rem; min-inline-size: 0; max-inline-size: 100%; }
  :where(.gridlock-dossier-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--gridlock-font-display); font-size: clamp(1.35rem, 1.15rem + 0.55cqi, 1.65rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.1; overflow-wrap: anywhere; }
  :where(.gridlock-connector-chip, .gridlock-project-chip) { display: inline-flex; align-items: center; max-inline-size: 100%; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  :where(.gridlock-title-rule) { block-size: 2px; inline-size: 2.75rem; background-color: var(--gridlock-ink); }
  :where(.gridlock-header-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
  :where(.gridlock-scorecard-section) { display: flex; flex-direction: column; gap: 1.75rem; }
  :where(.gridlock-headline-stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1.25rem 2rem; }
  :where(.gridlock-headline-stat) { display: flex; flex-direction: column; gap: 0.35rem; min-inline-size: 0; }
  @container (width >= 42em) {
    :where(.gridlock-headline-stat + .gridlock-headline-stat) { padding-inline-start: 1.75rem; border-inline-start: 1px solid var(--gridlock-border); }
  }
  :where(.gridlock-headline-stat dt) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-kpi-value) { display: block; contain: layout style; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: clamp(2rem, 1.65rem + 1.1vw, 2.75rem); font-weight: 900; letter-spacing: -0.03em; line-height: 1.02; font-variant-numeric: tabular-nums; color: var(--gridlock-ink); }
  :where(.gridlock-kpi-sub) { display: block; margin-block-start: 0.25rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-inline-meta) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.65rem; min-inline-size: 0; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-citations-row) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem 0.9rem; padding-block-start: 0.15rem; }
  :where(.gridlock-citation-item) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; max-inline-size: 100%; }
  :where(.gridlock-citation-link) { display: inline-flex; align-items: center; gap: 0.3rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-ink); text-decoration: underline; text-decoration-color: var(--gridlock-border-strong); transition: color 240ms cubic-bezier(0.16, 1, 0.3, 1), text-decoration-color 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-citation-link:hover) { text-decoration-color: var(--gridlock-accent); }
  :where(.gridlock-patch-disclosure, .gridlock-timeline-disclosure, .gridlock-workspace-disclosure) { margin-block-start: 0.25rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-patch-summary, .gridlock-timeline-disclosure-summary, .gridlock-workspace-disclosure-summary) { list-style: none; display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 2.5rem; cursor: pointer; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); transition: color 300ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-patch-summary, .gridlock-timeline-disclosure-summary, .gridlock-workspace-disclosure-summary)::-webkit-details-marker { display: none; }
  :where(.gridlock-patch-summary, .gridlock-timeline-disclosure-summary, .gridlock-workspace-disclosure-summary)::before { content: "+"; font-family: var(--gridlock-font-mono); font-size: 0.875rem; color: var(--gridlock-accent); }
  :where(.gridlock-patch-disclosure[open] > .gridlock-patch-summary, .gridlock-timeline-disclosure[open] > .gridlock-timeline-disclosure-summary, .gridlock-workspace-disclosure[open] > .gridlock-workspace-disclosure-summary)::before { content: "−"; }
  :where(.gridlock-patch-summary:hover, .gridlock-timeline-disclosure-summary:hover, .gridlock-workspace-disclosure-summary:hover) { color: var(--gridlock-ink); }
  @keyframes gridlock-disclosure-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  :where(.gridlock-patch-body, .gridlock-timeline-disclosure-body, .gridlock-workspace-disclosure-body) { display: flex; flex-direction: column; gap: 0.75rem; padding-block: 0.5rem 0.25rem; min-inline-size: 0; }
  :where(.gridlock-patch-disclosure[open] > .gridlock-patch-body, .gridlock-timeline-disclosure[open] > .gridlock-timeline-disclosure-body) { animation: gridlock-disclosure-in 480ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-status-badge) { display: inline-flex; align-items: center; gap: 0.45rem; min-block-size: 2.25rem; padding-inline: 0.75rem; border: 1px solid transparent; border-radius: var(--gridlock-radius); background-color: var(--gridlock-ink); color: var(--gridlock-paper); font-family: var(--gridlock-font-mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
  :where(.gridlock-status-badge[data-tone="alert"]) { background-color: var(--gridlock-card); color: var(--gridlock-ink); border-color: var(--gridlock-accent); }
  :where(.gridlock-status-badge[data-tone="alert"] svg) { color: var(--gridlock-accent); }
  :where(.gridlock-banner) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.875rem; border: 1px solid var(--gridlock-accent); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); padding-block: 0.875rem; padding-inline: 1.1rem; margin-block-end: 1.5rem; font-size: 0.875rem; }
  :where(.gridlock-banner-copy) { display: flex; align-items: flex-start; gap: 0.6rem; }
  :where(.gridlock-banner-icon) { flex-shrink: 0; color: var(--gridlock-accent); margin-block-start: 0.15rem; }
  :where(.gridlock-action-btn, .gridlock-md-link) { position: relative; overflow: hidden; min-block-size: 2.25rem; padding-inline: 0.85rem; display: inline-flex; align-items: center; gap: 0.45rem; border: 1px solid var(--gridlock-ink); border-radius: var(--gridlock-radius); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; cursor: pointer; isolation: isolate; transition: color 360ms cubic-bezier(0.16, 1, 0.3, 1), border-color 360ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-action-btn, .gridlock-md-link)::before { content: ""; position: absolute; inset: 0; z-index: -1; background-color: var(--gridlock-accent); transform: scaleX(0); transform-origin: left center; transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-action-btn:hover:not(:disabled), .gridlock-md-link:hover, .gridlock-action-btn:focus-visible, .gridlock-md-link:focus-visible) { color: var(--atlas-ink, #18181b); border-color: var(--gridlock-accent); }
  :where(.gridlock-action-btn:hover:not(:disabled), .gridlock-md-link:hover, .gridlock-action-btn:focus-visible, .gridlock-md-link:focus-visible)::before { transform: scaleX(1); }
  :where(.gridlock-action-btn:disabled) {
    opacity: 0.48;
    cursor: not-allowed;
  }
  :where(.gridlock-copy-chip) { display: inline-flex; align-items: center; gap: 0.4rem; min-block-size: 1.875rem; padding-block: 0.2rem; padding-inline: 0.55rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-mono); font-size: 0.75rem; line-height: 1.2; cursor: pointer; transition: border-color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-copy-chip:hover, .gridlock-copy-chip[data-copied="true"]) { border-color: var(--gridlock-accent); background-color: var(--gridlock-card); }
  :where(.gridlock-copy-chip[data-copied="true"] .gridlock-copy-icon) { color: var(--gridlock-accent); }
  :where(:is(.gridlock-dossier-surface, .gridlock-timeline-stage) :is(button, a, input, textarea, select, [role="button"], [tabindex="0"], summary)):focus-visible {
    outline: 2px solid var(--gridlock-ink);
    outline-offset: 2px;
  }
  @keyframes gridlock-opacity-pulse { 0%, 100% { opacity: 0.84; } 50% { opacity: 0.44; } }
  :where(.gridlock-loading-placeholder) { display: grid; gap: 1.75rem; min-block-size: 36rem; align-content: start; animation: gridlock-opacity-pulse 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite; }
  :where(.gridlock-loading-stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1.25rem 2rem; }
  :where(.gridlock-loading-stat) { min-block-size: 5rem; background-color: var(--gridlock-card); border-inline-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-loading-chart) { min-block-size: 13.5rem; background-color: var(--gridlock-card); border-block: 1px solid var(--gridlock-border-strong); }
  :where(.gridlock-loading-sheet) { min-block-size: 13rem; background-color: var(--gridlock-card); border-block-start: 1px solid var(--gridlock-border); }
  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-loading-placeholder, .gridlock-patch-disclosure[open] > .gridlock-patch-body, .gridlock-timeline-disclosure[open] > .gridlock-timeline-disclosure-body) { animation: none; }
    :where(.gridlock-dossier-surface, .gridlock-action-btn, .gridlock-md-link, .gridlock-copy-chip, .gridlock-citation-link, .gridlock-patch-summary, .gridlock-timeline-disclosure-summary, .gridlock-workspace-disclosure-summary), :where(.gridlock-action-btn, .gridlock-md-link)::before { transition: none; }
  }
  @media (forced-colors: active) {
    :where(.gridlock-status-badge, .gridlock-copy-chip, .gridlock-banner) { border: 1px solid CanvasText; }
  }
}`;

export const DOSSIER_BASE_STYLESHEET_NODE = createElement(
  "style",
  { href: "gridlock-dossier-base", precedence: "default" },
  GRIDLOCK_DOSSIER_BASE_STYLESHEET
);


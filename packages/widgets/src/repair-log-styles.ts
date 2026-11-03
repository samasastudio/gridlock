export const GRIDLOCK_REPAIR_LOG_STYLESHEET = `@layer gridlock-widgets {
  :where(.gridlock-repair-widget) {
    --gridlock-paper: var(--paper, var(--background, var(--atlas-paper, #f4efe6)));
    --gridlock-ink: var(--ink, var(--foreground, var(--atlas-ink, #18181b)));
    --gridlock-card: var(--card, var(--atlas-mist, #edf0ee));
    --gridlock-muted: var(--muted-foreground, var(--atlas-charcoal, #4a525a));
    --gridlock-border: var(--border, oklch(0.205 0.006 285 / 16%));
    --gridlock-border-strong: oklch(0.205 0.006 285 / 26%);
    --gridlock-accent: var(--signal-coral, #e06d53);
    --gridlock-lichen: var(--signal-lichen, #6d8368);
    --gridlock-estuary: var(--terrain-estuary, #1f2d3a);
    --gridlock-radius: var(--radius, 0rem);
    --gridlock-font-serif: var(--font-serif, "Tinos", Georgia, serif);
    --gridlock-font-display: var(--font-display, "Geomanist", "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-sans: var(--font-sans, "Google Sans Flex", ui-sans-serif, system-ui, sans-serif);
    --gridlock-font-mono: var(--font-mono, "Google Sans Code", ui-monospace, SFMono-Regular, monospace);
    --gridlock-diff-before: color-mix(in oklab, var(--gridlock-accent) 12%, var(--gridlock-paper));
    --gridlock-diff-after: color-mix(in oklab, var(--gridlock-lichen) 18%, var(--gridlock-paper));
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
    border: 1px solid var(--gridlock-border-strong);
    border-radius: var(--gridlock-radius);
    padding: clamp(1.25rem, 1rem + 1.5cqi, 2rem);
    font-family: var(--gridlock-font-sans);
    line-height: 1.5;
    container-type: inline-size;
    transition: background-color 350ms cubic-bezier(0.22, 1, 0.36, 1), color 350ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .gridlock-repair-widget[data-gridlock-theme="diurnal"] {
    color-scheme: only light;
    --paper: var(--atlas-paper, #f4efe6);
    --ink: var(--atlas-ink, #18181b);
    --gridlock-paper: var(--paper);
    --gridlock-ink: var(--ink);
    --gridlock-card: var(--atlas-mist, #edf0ee);
    --gridlock-muted: var(--atlas-charcoal, #4a525a);
    --gridlock-border: oklch(0.205 0.006 285 / 16%);
    --gridlock-border-strong: oklch(0.205 0.006 285 / 26%);
    --gridlock-lichen: #556b52;
    --relief-sky-mid: #6e7c87;
    --relief-coral-mid: #e06d53;
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
  }
  .gridlock-repair-widget[data-gridlock-theme="nocturnal"] {
    color-scheme: only dark;
    --paper: oklch(0.215 0.026 244);
    --ink: var(--atlas-paper, #f4efe6);
    --gridlock-paper: var(--paper);
    --gridlock-ink: var(--ink);
    --gridlock-card: var(--terrain-ridge-dark, #22272d);
    --gridlock-muted: var(--signal-lichen, #a3b19b);
    --gridlock-border: oklch(0.952 0.015 84 / 16%);
    --gridlock-border-strong: oklch(0.952 0.015 84 / 26%);
    --gridlock-lichen: #a3b19b;
    --relief-sky-mid: #172636;
    --relief-coral-mid: #742d22;
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
  }
  :where(.gridlock-repair-widget :is(h2, h3, h4, p, dl, dd, ol)) { margin: 0; }
  :where(.gridlock-repair-widget code) { font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.84em; }
  :where(.gridlock-eyebrow) { font-family: var(--gridlock-font-sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 1rem; padding-block-end: 1.25rem; margin-block-end: 1.5rem; border-block-end: 1px solid var(--gridlock-border-strong); }
  :where(.gridlock-title-block) { display: flex; flex-direction: column; gap: 0.45rem; }
  :where(.gridlock-dossier-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem; font-family: var(--gridlock-font-serif); font-size: clamp(1.5rem, 1.25rem + 0.9vw, 2.05rem); font-weight: 400; letter-spacing: -0.01em; line-height: 1.12; }
  :where(.gridlock-connector-chip) { display: inline-flex; align-items: center; padding-block: 0.15rem; padding-inline: 0.45rem; border: 1px solid var(--gridlock-border-strong); background-color: var(--gridlock-card); font-size: 0.78rem; letter-spacing: 0.02em; }
  :where(.gridlock-title-rule) { block-size: 2px; inline-size: 3rem; background-color: var(--gridlock-ink); margin-block-start: 0.25rem; transform-origin: left center; }
  :where(.gridlock-header-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
  :where(.gridlock-status-badge) { display: inline-flex; align-items: center; gap: 0.4rem; min-block-size: 2.25rem; padding-inline: 0.7rem; background-color: var(--gridlock-ink); color: var(--gridlock-paper); font-family: var(--gridlock-font-mono); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
  :where(.gridlock-status-badge[data-tone="alert"]) { background-color: var(--gridlock-accent); color: #18181b; }
  :where(.gridlock-section-bar) { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-block-end: 0.65rem; }
  :where(.gridlock-section-heading) { font-family: var(--gridlock-font-sans); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--gridlock-ink); }
  :where(.gridlock-scorecard-section) { margin-block-end: 1.75rem; }
  :where(.gridlock-scorecard-grid) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); border-block-start: 1px solid var(--gridlock-border-strong); border-inline-start: 1px solid var(--gridlock-border-strong); }
  :where(.gridlock-metric-tile) { display: flex; flex-direction: column; justify-content: space-between; gap: 0.65rem; background-color: var(--gridlock-card); border-inline-end: 1px solid var(--gridlock-border-strong); border-block-end: 1px solid var(--gridlock-border-strong); padding-block: 1rem; padding-inline: 1.1rem; }
  :where(.gridlock-metric-tile[data-accent="kiln"]) { background-color: color-mix(in oklab, var(--gridlock-accent) 11%, var(--gridlock-card)); border-block-start: 2px solid var(--gridlock-accent); }
  :where(.gridlock-metric-tile dt) { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gridlock-muted); line-height: 1.35; }
  :where(.gridlock-kpi-value) { display: block; font-family: var(--gridlock-font-display); font-size: clamp(1.65rem, 1.35rem + 0.8vw, 2.15rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; font-variant-numeric: tabular-nums; color: var(--gridlock-ink); }
  :where(.gridlock-kpi-sub) { display: block; margin-block-start: 0.3rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-meter-svg) { display: block; inline-size: 100%; block-size: 0.45rem; margin-block-start: 0.45rem; }
  :where(.gridlock-banner) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.875rem; border: 1px solid var(--gridlock-border-strong); border-inline-start: 4px solid var(--gridlock-accent); background-color: color-mix(in oklab, var(--gridlock-accent) 8%, var(--gridlock-card)); padding-block: 0.9rem; padding-inline: 1.1rem; margin-block-end: 1.5rem; font-size: 0.9rem; }
  :where(.gridlock-empty-panel) { border: 1px solid var(--gridlock-border-strong); background-color: var(--gridlock-card); padding-block: 1.25rem; padding-inline: 1.25rem; font-size: 0.95rem; }
  :where(.gridlock-timeline-list) { list-style: none; padding-inline-start: 0; display: flex; flex-direction: column; gap: 1.25rem; }
  :where(.gridlock-timeline-card) { border: 1px solid var(--gridlock-border-strong); background-color: var(--gridlock-paper); }
  :where(.gridlock-specimen-head) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding-block: 0.9rem; padding-inline: 1.1rem; background-color: var(--gridlock-card); border-block-end: 1px solid var(--gridlock-border-strong); }
  :where(.gridlock-specimen-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--gridlock-font-display); font-size: 1.02rem; font-weight: 700; letter-spacing: -0.01em; }
  :where(.gridlock-patch-pill) { display: inline-flex; align-items: center; padding-block: 0.18rem; padding-inline: 0.5rem; background-color: var(--gridlock-ink); color: var(--gridlock-paper); font-family: var(--gridlock-font-mono); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  :where(.gridlock-timestamp) { font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-root-cause) { padding-block: 0.85rem; padding-inline: 1.1rem; font-size: 0.95rem; line-height: 1.55; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-specimen-metrics) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr)); border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-specimen-cell) { padding-block: 0.75rem; padding-inline: 1.1rem; border-inline-end: 1px solid var(--gridlock-border); border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-specimen-cell dt) { font-size: 0.65rem; font-weight: 600; letter-spacing: 0.11em; text-transform: uppercase; color: var(--gridlock-muted); margin-block-end: 0.25rem; }
  :where(.gridlock-specimen-cell dd) { font-family: var(--gridlock-font-mono); font-size: 0.82rem; font-weight: 600; color: var(--gridlock-ink); }
  :where(.gridlock-invariant-strip) { padding-block: 0.65rem; padding-inline: 1.1rem; background-color: var(--gridlock-diff-before); border-block-end: 1px solid var(--gridlock-border); font-size: 0.82rem; }
  :where(.gridlock-diff-details summary) { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-block: 0.75rem; padding-inline: 1.1rem; cursor: pointer; list-style: none; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; background-color: var(--gridlock-card); user-select: none; }
  :where(.gridlock-diff-details summary::-webkit-details-marker) { display: none; }
  :where(.gridlock-diff-chevron) { transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1); display: inline-block; margin-inline-end: 0.45rem; }
  :where(.gridlock-diff-details[open] .gridlock-diff-chevron) { transform: rotate(90deg); }
  :where(.gridlock-diff-scroll) { overflow: auto; max-inline-size: 100%; container-type: inline-size; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-diff-table) { inline-size: 100%; border-collapse: separate; border-spacing: 0; --label-2: "Before"; --label-3: "After"; font-size: 0.84rem; }
  :where(.gridlock-diff-table caption) { padding-block: 0.5rem; padding-inline: 1.1rem; text-align: start; font-family: var(--gridlock-font-mono); font-size: 0.72rem; color: var(--gridlock-muted); background-color: var(--gridlock-paper); border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-diff-table thead) { position: sticky; inset-block-start: 0; z-index: 1; background-color: var(--gridlock-paper); }
  :where(.gridlock-diff-table thead th) { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-diff-table tbody th) { position: sticky; inset-inline-start: 0; background-color: var(--gridlock-card); text-align: start; font-weight: 600; }
  :where(.gridlock-diff-table th, .gridlock-diff-table td) { padding-block: 0.55rem; padding-inline: 0.85rem; border-block-end: 1px solid var(--gridlock-border); text-align: start; vertical-align: top; }
  :where(.gridlock-diff-before) { background-color: var(--gridlock-diff-before); }
  :where(.gridlock-diff-after) { background-color: var(--gridlock-diff-after); }
  @container (width < 32.5em) {
    :where(.gridlock-diff-table, .gridlock-diff-table thead, .gridlock-diff-table tbody, .gridlock-diff-table tr, .gridlock-diff-table th, .gridlock-diff-table td) { display: block; }
    :where(.gridlock-diff-table thead) { display: none; }
    :where(.gridlock-diff-table tbody th) { position: sticky; inset-block-start: 0; z-index: 2; }
    :where(.gridlock-diff-table td:nth-child(2))::before { content: var(--label-2) ": "; font-family: var(--gridlock-font-sans); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    :where(.gridlock-diff-table td:nth-child(3))::before { content: var(--label-3) ": "; font-family: var(--gridlock-font-sans); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  }
  :where(.gridlock-action-btn, .gridlock-md-link) { position: relative; overflow: hidden; min-block-size: 2.35rem; padding-inline: 0.95rem; display: inline-flex; align-items: center; gap: 0.45rem; border: 1px solid var(--gridlock-ink); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-sans); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; cursor: pointer; isolation: isolate; transition: color 220ms cubic-bezier(0.22, 1, 0.36, 1), border-color 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  :where(.gridlock-action-btn, .gridlock-md-link)::before { content: ""; position: absolute; inset: 0; z-index: -1; background-color: var(--gridlock-accent); transform: scaleX(0); transform-origin: left center; transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
  :where(.gridlock-action-btn:hover:not(:disabled), .gridlock-md-link:hover, .gridlock-action-btn:focus-visible, .gridlock-md-link:focus-visible) { color: #18181b; border-color: var(--gridlock-accent); }
  :where(.gridlock-action-btn:hover:not(:disabled), .gridlock-md-link:hover, .gridlock-action-btn:focus-visible, .gridlock-md-link:focus-visible)::before { transform: scaleX(1); }
  :where(.gridlock-action-btn, .gridlock-diff-scroll, .gridlock-md-link, .gridlock-repair-widget summary):focus-visible { outline: 2px solid var(--gridlock-ink); outline-offset: 2px; }
  :where(.gridlock-progress) { inline-size: 100%; block-size: 0.35rem; accent-color: var(--gridlock-accent); }
}`;

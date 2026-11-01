export const GRIDLOCK_REPAIR_LOG_STYLESHEET = `@layer gridlock-widgets {
  :where(.gridlock-repair-widget) {
    --gridlock-paper: var(--paper, var(--background, var(--atlas-paper, #f4efe6)));
    --gridlock-ink: var(--ink, var(--foreground, var(--atlas-ink, #18181b)));
    --gridlock-card: var(--card, var(--atlas-mist, #edf0ee));
    --gridlock-muted: var(--muted-foreground, var(--atlas-charcoal, #4a525a));
    --gridlock-border: var(--border, oklch(0.205 0.006 285 / 16%));
    --gridlock-accent: var(--signal-coral, var(--relief-coral-mid, #e06d53));
    --gridlock-radius: var(--radius, 0rem);
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
    border: 1px solid var(--gridlock-border);
    border-radius: var(--gridlock-radius);
    padding: 1.25rem;
    font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
    line-height: 1.5;
  }
  .gridlock-repair-widget[data-gridlock-theme="diurnal"] {
    color-scheme: light;
    --paper: var(--atlas-paper, #f4efe6);
    --ink: var(--atlas-ink, #18181b);
    --gridlock-paper: var(--paper);
    --gridlock-ink: var(--ink);
    --gridlock-card: var(--atlas-mist, #edf0ee);
    --gridlock-muted: var(--atlas-charcoal, #4a525a);
    --gridlock-border: oklch(0.205 0.006 285 / 16%);
    --relief-sky-mid: #6e7c87;
    --relief-coral-mid: #e06d53;
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
  }
  .gridlock-repair-widget[data-gridlock-theme="nocturnal"] {
    color-scheme: dark;
    --paper: oklch(0.215 0.026 244);
    --ink: var(--atlas-paper, #f4efe6);
    --gridlock-paper: var(--paper);
    --gridlock-ink: var(--ink);
    --gridlock-card: var(--terrain-ridge-dark, #22272d);
    --gridlock-muted: var(--signal-lichen, #a3b19b);
    --gridlock-border: oklch(0.952 0.015 84 / 16%);
    --relief-sky-mid: #172636;
    --relief-coral-mid: #742d22;
    background-color: var(--gridlock-paper);
    color: var(--gridlock-ink);
  }
  :where(.gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding-block-end: 0.875rem; margin-block-end: 1rem; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-scorecard-grid) { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; margin-block-end: 1.25rem; }
  :where(.gridlock-metric-tile, .gridlock-timeline-card, .gridlock-empty-panel) { background-color: var(--gridlock-card); border: 1px solid var(--gridlock-border); padding-block: 0.75rem; padding-inline: 0.875rem; }
  :where(.gridlock-banner) { border: 1px solid var(--gridlock-accent); border-inline-start-width: 4px; background-color: var(--gridlock-card); padding-block: 0.75rem; padding-inline: 0.875rem; margin-block-end: 1rem; }
  :where(.gridlock-timeline-list) { list-style: none; padding-inline-start: 0; margin-block: 0; }
  :where(.gridlock-timeline-item:not(:last-child)) { margin-block-end: 1rem; }
  :where(.gridlock-diff-scroll) { overflow: auto; max-inline-size: 100%; container-type: inline-size; margin-block-start: 0.625rem; }
  :where(.gridlock-diff-table) { inline-size: 100%; border-collapse: separate; border-spacing: 0; --label-2: "Before"; --label-3: "After"; }
  :where(.gridlock-diff-table thead) { position: sticky; inset-block-start: 0; z-index: 1; background-color: var(--gridlock-paper); }
  :where(.gridlock-diff-table tbody th) { position: sticky; inset-inline-start: 0; background-color: var(--gridlock-card); text-align: start; }
  :where(.gridlock-diff-table th, .gridlock-diff-table td) { padding-block: 0.375rem; padding-inline: 0.5rem; border-block-end: 1px solid var(--gridlock-border); text-align: start; }
  @container (width < 520px) {
    :where(.gridlock-diff-table, .gridlock-diff-table thead, .gridlock-diff-table tbody, .gridlock-diff-table tr, .gridlock-diff-table th, .gridlock-diff-table td) { display: block; }
    :where(.gridlock-diff-table thead) { display: none; }
    :where(.gridlock-diff-table tbody th) { position: sticky; inset-block-start: 0; z-index: 2; }
    :where(.gridlock-diff-table td:nth-child(2))::before { content: var(--label-2) ": "; font-weight: 600; }
    :where(.gridlock-diff-table td:nth-child(3))::before { content: var(--label-3) ": "; font-weight: 600; }
  }
  :where(.gridlock-action-btn, .gridlock-md-link) { min-block-size: 2.25rem; padding-inline: 0.75rem; display: inline-flex; align-items: center; }
  :where(.gridlock-action-btn) { border: 1px solid var(--gridlock-ink); background-color: var(--gridlock-paper); color: var(--gridlock-ink); cursor: pointer; }
  :where(.gridlock-action-btn:hover:not(:disabled)) { border-color: var(--gridlock-accent); }
  :where(.gridlock-action-btn, .gridlock-diff-scroll, .gridlock-md-link, .gridlock-repair-widget summary):focus-visible { outline: 2px solid var(--gridlock-accent); outline-offset: 2px; }
}`;

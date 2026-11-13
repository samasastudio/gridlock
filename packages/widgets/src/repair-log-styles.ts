import { GRIDLOCK_DOSSIER_BASE_CSS } from "./dossier-styles.ts";

export const GRIDLOCK_REPAIR_LOG_STYLESHEET = `@layer gridlock-widgets {
${GRIDLOCK_DOSSIER_BASE_CSS}
  :where(.gridlock-repair-header) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-block-end: 1.35rem; margin-block-end: 1.75rem; border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-title-block) { display: flex; flex-direction: column; gap: 0.5rem; }
  :where(.gridlock-dossier-title) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--gridlock-font-display); font-size: clamp(1.35rem, 1.15rem + 0.55cqi, 1.65rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.1; }
  :where(.gridlock-connector-chip) { display: inline-flex; align-items: center; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; }
  :where(.gridlock-title-rule) { block-size: 2px; inline-size: 2.75rem; background-color: var(--gridlock-ink); }
  :where(.gridlock-header-controls) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
  :where(.gridlock-scorecard-grid) { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; margin-block-end: 1.25rem; }
  :where(.gridlock-metric-tile, .gridlock-timeline-card, .gridlock-empty-panel) { background-color: var(--gridlock-card); border: 1px solid var(--gridlock-border); padding-block: 0.75rem; padding-inline: 0.875rem; }
  :where(.gridlock-timeline-list) { list-style: none; padding-inline-start: 0; margin-block: 0; }
  :where(.gridlock-timeline-item:not(:last-child)) { margin-block-end: 1rem; }
  :where(.gridlock-diff-scroll) { overflow: auto; max-inline-size: 100%; container-type: inline-size; border: 1px solid var(--gridlock-border); margin-block-start: 0.625rem; }
  :where(.gridlock-diff-table) { inline-size: 100%; border-collapse: separate; border-spacing: 0; --label-2: "Before"; --label-3: "After"; font-size: 0.8125rem; }
  :where(.gridlock-diff-table caption) { padding-block: 0.55rem; padding-inline: 0.9rem; text-align: start; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); background-color: var(--gridlock-card); border-block-end: 1px solid var(--gridlock-border); }
  :where(.gridlock-diff-table thead) { position: sticky; inset-block-start: 0; z-index: 1; background-color: var(--gridlock-paper); }
  :where(.gridlock-diff-table thead th) { font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-muted); }
  :where(.gridlock-diff-table tbody th) { position: sticky; inset-inline-start: 0; background-color: var(--gridlock-card); text-align: start; font-weight: 600; }
  :where(.gridlock-diff-table th, .gridlock-diff-table td) { padding-block: 0.55rem; padding-inline: 0.9rem; border-block-end: 1px solid var(--gridlock-border); text-align: start; vertical-align: top; }
  :where(.gridlock-diff-table tbody tr:last-child :is(th, td)) { border-block-end: 0; }
  @container (width < 34em) {
    :where(.gridlock-diff-table, .gridlock-diff-table caption, .gridlock-diff-table tbody, .gridlock-diff-table tr, .gridlock-diff-table th, .gridlock-diff-table td) { display: block; inline-size: 100%; }
    :where(.gridlock-diff-table thead) { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    :where(.gridlock-diff-table tbody th) { position: sticky; inset-block-start: 0; z-index: 2; }
    :where(.gridlock-diff-table td:nth-child(2))::before { content: var(--label-2) ": "; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    :where(.gridlock-diff-table td:nth-child(3))::before { content: var(--label-3) ": "; font-family: var(--gridlock-font-sans); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  }
}`;

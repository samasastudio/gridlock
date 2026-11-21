import { GRIDLOCK_DOSSIER_BASE_CSS } from "./dossier-styles.ts";

export const GRIDLOCK_AST_CARD_STYLESHEET = `@layer gridlock-widgets {
${GRIDLOCK_DOSSIER_BASE_CSS}
  .gridlock-ast-card:where(.gridlock-dossier-surface) {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-inline-size: 0;
    border: 1px solid var(--gridlock-border-strong);
  }
  .gridlock-dossier-surface .gridlock-ast-card {
    border: 0;
    border-block-start: 1px solid var(--gridlock-border);
    padding-block: 1.75rem;
    padding-inline: 0;
    background-color: transparent;
  }
  .gridlock-ast-card :where(.gridlock-banner) {
    margin-block-end: 0;
  }

  .gridlock-ast-card :where(.gridlock-repair-header) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-block-end: 1.25rem;
    margin-block-end: 0;
    border-block-end: 1px solid var(--gridlock-border);
  }
  .gridlock-ast-card :where(.gridlock-title-block) {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  .gridlock-ast-card :where(.gridlock-dossier-title) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    font-family: var(--gridlock-font-display);
    font-size: clamp(1.3rem, 1.12rem + 0.55cqi, 1.6rem);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.12;
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-connector-chip, .gridlock-project-chip) {
    display: inline-flex;
    align-items: center;
    max-inline-size: 100%;
    padding-block: 0.2rem;
    padding-inline: 0.5rem;
    border: 1px solid var(--gridlock-border-strong);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-title-rule) {
    block-size: 2px;
    inline-size: 2.75rem;
    background-color: var(--gridlock-ink);
  }
  .gridlock-ast-card :where(.gridlock-header-controls) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  .gridlock-ast-card :where(.gridlock-headline-stats) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: 1.25rem 2rem;
  }
  .gridlock-ast-card :where(.gridlock-headline-stat) {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-inline-size: 0;
  }
  @container (width >= 42em) {
    .gridlock-ast-card :where(.gridlock-headline-stat + .gridlock-headline-stat) {
      padding-inline-start: 1.75rem;
      border-inline-start: 1px solid var(--gridlock-border);
    }
  }
  .gridlock-ast-card :where(.gridlock-headline-stat dt) {
    font-family: var(--gridlock-font-sans);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gridlock-muted);
  }
  .gridlock-ast-card :where(.gridlock-kpi-value) {
    display: block;
    contain: layout style;
    font-family: var(--gridlock-font-display);
    font-size-adjust: cap-height from-font;
    font-size: clamp(1.9rem, 1.6rem + 1vw, 2.6rem);
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 1.04;
    font-variant-numeric: tabular-nums;
    color: var(--gridlock-ink);
  }
  .gridlock-ast-card :where(.gridlock-kpi-sub) {
    display: block;
    margin-block-start: 0.25rem;
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    overflow-wrap: anywhere;
  }

  .gridlock-ast-card :where(.gridlock-ast-specimen) {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding-block-start: 1.25rem;
    border-block-start: 1px solid var(--gridlock-border);
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-ast-lead) {
    max-inline-size: 62ch;
    font-family: var(--gridlock-font-serif);
    font-size-adjust: from-font;
    font-size: clamp(1.15rem, 1.05rem + 0.35vw, 1.32rem);
    line-height: 1.62;
    color: var(--gridlock-ink);
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-inline-meta) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.65rem;
    min-inline-size: 0;
    max-inline-size: 100%;
    font-family: var(--gridlock-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-citations-row) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem 0.9rem;
    padding-block-start: 0.15rem;
  }
  .gridlock-ast-card :where(.gridlock-citation-item) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    max-inline-size: 100%;
  }
  .gridlock-ast-card :where(.gridlock-citation-link) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-ink);
    text-decoration: underline;
    text-decoration-color: var(--gridlock-border-strong);
    transition: color 240ms cubic-bezier(0.16, 1, 0.3, 1), text-decoration-color 240ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .gridlock-ast-card :where(.gridlock-citation-link:hover) {
    text-decoration-color: var(--gridlock-accent);
  }

  .gridlock-ast-card :where(.gridlock-ast-disclosure) {
    margin-block-start: 0.25rem;
    border-block-start: 1px solid var(--gridlock-border);
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure-summary) {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.5rem;
    cursor: pointer;
    font-family: var(--gridlock-font-sans);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gridlock-muted);
    transition: color 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure-summary)::-webkit-details-marker {
    display: none;
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure-summary)::before {
    content: "+";
    font-family: var(--gridlock-font-mono);
    font-size: 0.875rem;
    color: var(--gridlock-accent);
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure[open] > .gridlock-ast-disclosure-summary)::before {
    content: "−";
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure-summary:hover) {
    color: var(--gridlock-ink);
  }
  .gridlock-ast-card :where(.gridlock-ast-disclosure-body) {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding-block: 0.35rem 0.15rem;
    min-inline-size: 0;
  }

  .gridlock-ast-card :where(.gridlock-tracked-projects) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-timeline-rail) {
    list-style: none;
    padding-inline-start: 1.35rem;
    border-inline-start: 1px solid var(--gridlock-border);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-timeline-item) {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-timeline-marker) {
    position: absolute;
    box-sizing: border-box;
    inset-inline-start: -1.73rem;
    inset-block-start: 0.25rem;
    inline-size: 0.7rem;
    block-size: 0.7rem;
    background-color: var(--gridlock-paper);
    border: 1.5px solid var(--gridlock-border-strong);
  }
  .gridlock-ast-card :where(.gridlock-timeline-item[data-milestone="true"] .gridlock-timeline-marker) {
    background-color: var(--gridlock-accent);
    border-color: var(--gridlock-accent);
  }
  .gridlock-ast-card :where(.gridlock-timeline-head) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.65rem;
    min-inline-size: 0;
    font-family: var(--gridlock-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-milestone-tag) {
    display: inline-flex;
    align-items: center;
    padding-block: 0.15rem;
    padding-inline: 0.45rem;
    border: 1px solid var(--gridlock-accent);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    color: var(--gridlock-ink);
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-delta-strip) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-delta-pill) {
    display: inline-flex;
    align-items: center;
    max-inline-size: 100%;
    padding-block: 0.15rem;
    padding-inline: 0.45rem;
    border: 1px solid var(--gridlock-border);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    color: var(--gridlock-ink);
    font-family: var(--gridlock-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  .gridlock-ast-card :where(.gridlock-empty-row) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
    padding-block: 0.5rem 0.25rem;
    font-size: 0.9375rem;
    color: var(--gridlock-ink);
    overflow-wrap: anywhere;
  }

  .gridlock-ast-card :where(.gridlock-comparison-scroll) {
    overflow-x: auto;
    max-inline-size: 100%;
    container-type: inline-size;
    border-block: 1px solid var(--gridlock-border-strong);
  }
  .gridlock-ast-card :where(.gridlock-comparison-table) {
    inline-size: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.8125rem;
    --col-2: "Location & Owner";
    --col-3: "Estimated Capital";
    --col-4: "Footprint & Density";
    --col-5: "Window & Status";
    --col-6: "Provenance";
  }
  .gridlock-ast-card :where(.gridlock-comparison-table caption) {
    padding-block: 0.55rem;
    padding-inline: 0.85rem;
    text-align: start;
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    background-color: var(--gridlock-card);
    border-block-end: 1px solid var(--gridlock-border);
  }
  .gridlock-ast-card :where(.gridlock-comparison-table thead th) {
    font-family: var(--gridlock-font-sans);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gridlock-muted);
    background-color: var(--gridlock-paper);
  }
  .gridlock-ast-card :where(.gridlock-comparison-table tbody th) {
    font-family: var(--gridlock-font-display);
    font-size: 0.9375rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--gridlock-ink);
  }
  .gridlock-ast-card :where(.gridlock-comparison-table th, .gridlock-comparison-table td) {
    padding-block: 0.75rem;
    padding-inline: 0.65rem;
    border-block-end: 1px solid var(--gridlock-border);
    text-align: start;
    vertical-align: top;
    font-variant-numeric: tabular-nums;
  }
  .gridlock-ast-card :where(.gridlock-comparison-table :is(.gridlock-project-chip, .gridlock-copy-chip, .gridlock-citation-link)) {
    white-space: nowrap;
  }
  .gridlock-ast-card :where(.gridlock-comparison-table tbody tr:last-child :is(th, td)) {
    border-block-end: 0;
  }
  .gridlock-ast-card :where(.gridlock-comparison-cell-stack) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    min-inline-size: 0;
  }
  .gridlock-ast-card :where(.gridlock-comparison-sub) {
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
  }
  .gridlock-ast-card :where(.gridlock-scale-track) {
    block-size: 2px;
    inline-size: 100%;
    margin-block-start: 0.45rem;
    background-color: var(--gridlock-border);
  }
  .gridlock-ast-card :where(.gridlock-scale-bar) {
    block-size: 2px;
    background-color: var(--gridlock-accent);
  }
  @container (width < 38em) {
    .gridlock-ast-card :where(.gridlock-comparison-table, .gridlock-comparison-table caption, .gridlock-comparison-table tbody, .gridlock-comparison-table tr, .gridlock-comparison-table th, .gridlock-comparison-table td) {
      display: block;
      inline-size: 100%;
      min-inline-size: 0;
      box-sizing: border-box;
      overflow-wrap: anywhere;
    }
    .gridlock-ast-card :where(.gridlock-comparison-table :is(.gridlock-project-chip, .gridlock-copy-chip, .gridlock-citation-link)) {
      white-space: normal;
    }
    .gridlock-ast-card :where(.gridlock-comparison-table thead) {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    .gridlock-ast-card :where(.gridlock-comparison-table tbody tr + tr > th) {
      border-block-start: 1px solid var(--gridlock-border-strong);
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td)::before {
      display: block;
      margin-block-end: 0.2rem;
      font-family: var(--gridlock-font-sans);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--gridlock-muted);
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td:nth-child(2))::before {
      content: var(--col-2) ": ";
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td:nth-child(3))::before {
      content: var(--col-3) ": ";
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td:nth-child(4))::before {
      content: var(--col-4) ": ";
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td:nth-child(5))::before {
      content: var(--col-5) ": ";
    }
    .gridlock-ast-card :where(.gridlock-comparison-table td:nth-child(6))::before {
      content: var(--col-6) ": ";
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gridlock-ast-card :where(.gridlock-citation-link, .gridlock-ast-disclosure-summary) {
      transition: none;
    }
  }
}`;

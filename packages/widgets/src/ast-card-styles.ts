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

  @media (prefers-reduced-motion: reduce) {
    .gridlock-ast-card :where(.gridlock-citation-link, .gridlock-ast-disclosure-summary) {
      transition: none;
    }
  }
}`;

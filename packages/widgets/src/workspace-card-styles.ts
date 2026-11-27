import { createElement, Fragment } from "react";
import { DOSSIER_BASE_STYLESHEET_NODE } from "./dossier-styles.ts";

const GRIDLOCK_WORKSPACE_CARD_STYLESHEET = `@layer gridlock-widgets {
  .gridlock-workspace-card:where(.gridlock-dossier-surface) {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-inline-size: 0;
    border: 1px solid var(--gridlock-border-strong);
  }
  .gridlock-dossier-surface .gridlock-workspace-card {
    border: 0;
    border-block-start: 1px solid var(--gridlock-border);
    padding-block: 1.75rem;
    padding-inline: 0;
    background-color: transparent;
  }
  .gridlock-workspace-card :where(.gridlock-banner) {
    margin-block-end: 0;
  }
  .gridlock-workspace-card :where(.gridlock-repair-header) {
    align-items: flex-start;
    padding-block-end: 1.25rem;
    margin-block-end: 0;
  }
  .gridlock-workspace-card :where(.gridlock-dossier-title) {
    font-size: clamp(1.3rem, 1.12rem + 0.55cqi, 1.6rem);
    line-height: 1.12;
  }
  .gridlock-workspace-card :where(.gridlock-kpi-value) {
    font-size: clamp(1.9rem, 1.6rem + 1vw, 2.6rem);
    line-height: 1.04;
  }

  .gridlock-workspace-card :where(.gridlock-workspace-specimen) {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding-block-start: 1.25rem;
    border-block-start: 1px solid var(--gridlock-border);
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-workspace-lead) {
    max-inline-size: 62ch;
    font-family: var(--gridlock-font-serif);
    font-size-adjust: from-font;
    font-size: clamp(1.15rem, 1.05rem + 0.35vw, 1.32rem);
    line-height: 1.62;
    color: var(--gridlock-ink);
    overflow-wrap: anywhere;
  }
  .gridlock-workspace-card :where(.gridlock-workspace-disclosure-body) {
    gap: 0.65rem;
    padding-block: 0.35rem 0.15rem;
  }

  .gridlock-workspace-card :where(.gridlock-tracked-projects) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-timeline-rail) {
    list-style: none;
    padding-inline-start: 1.35rem;
    border-inline-start: 1px solid var(--gridlock-border);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-timeline-item) {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-timeline-marker) {
    position: absolute;
    box-sizing: border-box;
    inset-inline-start: -1.73rem;
    inset-block-start: 0.25rem;
    inline-size: 0.7rem;
    block-size: 0.7rem;
    background-color: var(--gridlock-paper);
    border: 1.5px solid var(--gridlock-border-strong);
  }
  .gridlock-workspace-card :where(.gridlock-timeline-item[data-milestone="true"] .gridlock-timeline-marker) {
    background-color: var(--gridlock-accent);
    border-color: var(--gridlock-accent);
  }
  .gridlock-workspace-card :where(.gridlock-timeline-head) {
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
  .gridlock-workspace-card :where(.gridlock-milestone-tag) {
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
  .gridlock-workspace-card :where(.gridlock-delta-strip) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-delta-pill) {
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
  .gridlock-workspace-card :where(.gridlock-empty-row) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
    padding-block: 0.5rem 0.25rem;
    font-size: 0.9375rem;
    color: var(--gridlock-ink);
    overflow-wrap: anywhere;
  }

  .gridlock-workspace-card :where(.gridlock-comparison-scroll) {
    overflow-x: auto;
    max-inline-size: 100%;
    container-type: inline-size;
    border-block: 1px solid var(--gridlock-border-strong);
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table) {
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
  .gridlock-workspace-card :where(.gridlock-comparison-table caption) {
    padding-block: 0.55rem;
    padding-inline: 0.85rem;
    text-align: start;
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    background-color: var(--gridlock-card);
    border-block-end: 1px solid var(--gridlock-border);
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table thead th) {
    font-family: var(--gridlock-font-sans);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gridlock-muted);
    background-color: var(--gridlock-paper);
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table tbody th) {
    font-family: var(--gridlock-font-display);
    font-size: 0.9375rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--gridlock-ink);
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table th, .gridlock-comparison-table td) {
    padding-block: 0.75rem;
    padding-inline: 0.65rem;
    border-block-end: 1px solid var(--gridlock-border);
    text-align: start;
    vertical-align: top;
    font-variant-numeric: tabular-nums;
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table :is(.gridlock-project-chip, .gridlock-copy-chip, .gridlock-citation-link)) {
    white-space: nowrap;
  }
  .gridlock-workspace-card :where(.gridlock-comparison-table tbody tr:last-child :is(th, td)) {
    border-block-end: 0;
  }
  .gridlock-workspace-card :where(.gridlock-comparison-cell-stack) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    min-inline-size: 0;
  }
  .gridlock-workspace-card :where(.gridlock-comparison-sub) {
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
  }
  .gridlock-workspace-card :where(.gridlock-scale-track) {
    block-size: 2px;
    inline-size: 100%;
    margin-block-start: 0.45rem;
    background-color: var(--gridlock-border);
  }
  .gridlock-workspace-card :where(.gridlock-scale-bar) {
    block-size: 2px;
    background-color: var(--gridlock-accent);
  }
  @container (width < 38em) {
    .gridlock-workspace-card :where(.gridlock-comparison-table, .gridlock-comparison-table caption, .gridlock-comparison-table tbody, .gridlock-comparison-table tr, .gridlock-comparison-table th, .gridlock-comparison-table td) {
      display: block;
      inline-size: 100%;
      min-inline-size: 0;
      box-sizing: border-box;
      overflow-wrap: anywhere;
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table :is(.gridlock-project-chip, .gridlock-copy-chip, .gridlock-citation-link)) {
      white-space: normal;
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table thead) {
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
    .gridlock-workspace-card :where(.gridlock-comparison-table tbody tr + tr > th) {
      border-block-start: 1px solid var(--gridlock-border-strong);
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td)::before {
      display: block;
      margin-block-end: 0.2rem;
      font-family: var(--gridlock-font-sans);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--gridlock-muted);
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td:nth-child(2))::before {
      content: var(--col-2) ": ";
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td:nth-child(3))::before {
      content: var(--col-3) ": ";
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td:nth-child(4))::before {
      content: var(--col-4) ": ";
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td:nth-child(5))::before {
      content: var(--col-5) ": ";
    }
    .gridlock-workspace-card :where(.gridlock-comparison-table td:nth-child(6))::before {
      content: var(--col-6) ": ";
    }
  }
}`;

export const WORKSPACE_CARD_STYLESHEET_NODE = createElement(
  Fragment,
  null,
  DOSSIER_BASE_STYLESHEET_NODE,
  createElement(
    "style",
    { href: "gridlock-workspace-cards", precedence: "default" },
    GRIDLOCK_WORKSPACE_CARD_STYLESHEET
  )
);

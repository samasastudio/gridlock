export const GRIDLOCK_TIMELINE_WIDGET_STYLESHEET = `@layer gridlock-widgets {
  :where(.gridlock-timeline-widget .gridlock-timeline-stage) { margin-block-start: 2.25rem; padding-block-start: 1.5rem; border-block-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-timeline-stage) { display: flex; flex-direction: column; gap: 1rem; min-inline-size: 0; }
  :where(.gridlock-timeline-scrubber-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; border-block-end: 1px solid var(--gridlock-border); padding-block-end: 0.5rem; }
  :where(.gridlock-timeline-stage .gridlock-section-heading) { margin: 0; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: 0.875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-ink); }
  :where(.gridlock-timeline-stage .gridlock-tab-list) { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; max-inline-size: 100%; }
  :where(.gridlock-timeline-tab) { position: relative; min-block-size: 2.35rem; padding-inline: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: var(--gridlock-radius); background-color: transparent; color: var(--gridlock-muted); font-family: var(--gridlock-font-mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-timeline-tab:hover, .gridlock-timeline-tab[aria-selected="true"]) { color: var(--gridlock-ink); background-color: var(--gridlock-card); }
  :where(.gridlock-branch-dot) { display: inline-block; flex-shrink: 0; inline-size: 0.45rem; block-size: 0.45rem; background-color: var(--gridlock-accent); }
  :where(.gridlock-timeline-tab-indicator) { position: absolute; inset-inline: 0; inset-block-end: 0; block-size: 2px; background-color: var(--gridlock-accent); }
  :where(.gridlock-timeline-panel) { display: flex; flex-direction: column; gap: 1.15rem; min-inline-size: 0; }
  :where(.gridlock-timeline-viewport) {
    margin: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--gridlock-border-strong);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    box-shadow: none;
    min-inline-size: 0;
  }
  :where(.gridlock-timeline-viewport[data-branch="true"]) { border-color: var(--gridlock-accent); }
  :where(.gridlock-timeline-meta-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.65rem 1rem; padding-block: 0.65rem; padding-inline: clamp(0.85rem, 2cqi, 1.25rem); border-block-end: 1px solid var(--gridlock-border); background-color: var(--gridlock-paper); }
  :where(.gridlock-timeline-stage .gridlock-status-badge) { padding-block: 0.25rem; }
  :where(.gridlock-timeline-turn-stamp) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-inline-size: 0; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-timeline-img, .gridlock-timeline-fallback) {
    margin-block-start: auto;
  }
  :where(.gridlock-timeline-img) { display: block; inline-size: 100%; block-size: auto; aspect-ratio: 16 / 9; object-fit: cover; }
  :where(.gridlock-timeline-fallback) { display: flex; flex-direction: column; justify-content: center; gap: 0.55rem; min-block-size: 13rem; padding: clamp(1rem, 3cqi, 1.75rem); background-color: var(--gridlock-card); color: var(--gridlock-ink); }
  :where(.gridlock-timeline-fallback-head) { display: inline-flex; align-items: center; gap: 0.55rem; font-family: var(--gridlock-font-display); font-size: 0.9375rem; font-weight: 700; }
  :where(.gridlock-timeline-fallback-copy) { margin: 0; max-inline-size: 62ch; font-size: 0.875rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-timeline-stage .gridlock-empty-row) { margin: 0; display: flex; align-items: center; gap: 0.55rem; padding-block: 1.25rem 0.25rem; font-size: 0.9375rem; color: var(--gridlock-ink); }
  :where(.gridlock-timeline-specimen) { display: flex; flex-direction: column; gap: 0.85rem; padding-block-start: 0.25rem; min-inline-size: 0; }
  :where(.gridlock-timeline-lead) { max-inline-size: 64ch; font-family: var(--gridlock-font-serif); font-size-adjust: from-font; font-size: clamp(1.15rem, 1.05rem + 0.35vw, 1.32rem); line-height: 1.62; color: var(--gridlock-ink); }
  :where(.gridlock-additional-obs) { margin: 0; padding-inline-start: 1.15rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.875rem; color: var(--gridlock-ink); overflow-wrap: anywhere; }
  :where(.gridlock-additional-obs-meta) { font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-citation-aged) { display: inline-flex; align-items: center; padding-block: 0.2rem; padding-inline: 0.5rem; border: 1px solid var(--gridlock-border); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-timeline-disclosure) { margin-block-start: 0.35rem; }
  :where(.gridlock-timeline-invariant-strip) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding-block: 0.65rem; padding-inline: 0.9rem; background-color: var(--gridlock-card); border: 1px solid var(--gridlock-border); font-size: 0.8125rem; overflow-wrap: anywhere; }
  :where(.gridlock-timeline-stage .gridlock-provenance-meta) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-muted); }
  :where(.gridlock-timeline-stage .gridlock-provenance-meta .gridlock-copy-chip) { max-inline-size: 100%; overflow-wrap: anywhere; text-align: start; }
  :where(.gridlock-provenance-hops) { margin: 0; padding-inline-start: 1.25rem; display: flex; flex-direction: column; gap: 0.45rem; font-family: var(--gridlock-font-mono); font-size: 0.75rem; color: var(--gridlock-ink); }
  :where(.gridlock-provenance-hop) { line-height: 1.45; overflow-wrap: anywhere; }
  :where(.gridlock-hop-btn) { padding-block: 0.15rem; padding-inline: 0.45rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-mono); font-size: 0.75rem; text-align: start; cursor: pointer; overflow-wrap: anywhere; transition: border-color 240ms cubic-bezier(0.16, 1, 0.3, 1), background-color 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-hop-btn:hover) { border-color: var(--gridlock-accent); background-color: var(--gridlock-card); }
  :where(.gridlock-hop-note) { display: inline-block; margin-inline-start: 0.45rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-painter-prompt) { padding-block: 0.6rem; padding-inline: 0.9rem; border: 1px solid var(--gridlock-border); background-color: var(--gridlock-card); font-size: 0.8125rem; color: var(--gridlock-ink); overflow-wrap: anywhere; }

  :where(.gridlock-timeline-compare-bar) {
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

  :where(.gridlock-timeline-compare-context) {
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

  :where(.gridlock-timeline-compare-toggle[aria-pressed="true"]) {
    color: var(--atlas-ink, #18181b);
    border-color: var(--gridlock-accent);
  }

  :where(.gridlock-timeline-compare-toggle[aria-pressed="true"])::before {
    transform: scaleX(1);
  }

  :where(.gridlock-timeline-comparison-grid) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    min-inline-size: 0;
  }

  @container (width >= 42em) {
    :where(.gridlock-timeline-comparison-grid) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  :where(.gridlock-timeline-branch-section) {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding-block-start: 0.9rem;
    border-block-start: 1px solid var(--gridlock-border);
    min-inline-size: 0;
  }

  :where(.gridlock-timeline-branch-head) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem 1rem;
  }

  :where(.gridlock-timeline-branch-target) {
    font-family: var(--gridlock-font-mono);
    font-size: 0.75rem;
    color: var(--gridlock-muted);
    overflow-wrap: anywhere;
  }

  :where(.gridlock-timeline-branch-label) {
    font-family: var(--gridlock-font-sans);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gridlock-muted);
  }

  :where(.gridlock-timeline-branch-input) {
    display: block;
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 4.75rem;
    padding-block: 0.65rem;
    padding-inline: 0.8rem;
    border: 1px solid var(--gridlock-border-strong);
    border-radius: var(--gridlock-radius);
    background-color: var(--gridlock-card);
    color: var(--gridlock-ink);
    font-family: var(--gridlock-font-sans);
    font-size: 0.875rem;
    line-height: 1.5;
    resize: vertical;
  }

  :where(.gridlock-timeline-branch-input:disabled) {
    opacity: 0.56;
    cursor: not-allowed;
  }

  :where(.gridlock-timeline-branch-input[aria-invalid="true"]) {
    border-color: var(--gridlock-accent);
  }

  :where(.gridlock-timeline-branch-footer) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem 1rem;
  }

  :where(.gridlock-timeline-branch-counter) {
    font-family: var(--gridlock-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: var(--gridlock-muted);
  }

  :where(.gridlock-timeline-branch-counter[data-over-limit="true"]) {
    color: var(--gridlock-accent);
    font-weight: 700;
  }

  :where(.gridlock-timeline-branch-section .gridlock-banner) {
    margin-block-end: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-timeline-tab, .gridlock-hop-btn) { transition: none; }
  }

  @media (forced-colors: active) {
    :where(.gridlock-timeline-compare-toggle[aria-pressed="true"]) {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
}`;


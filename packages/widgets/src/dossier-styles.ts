export const GRIDLOCK_DOSSIER_BASE_CSS = `
  :where(.gridlock-dossier-surface) {
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
    background-color: var(--gridlock-paper); color: var(--gridlock-ink); border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); box-shadow: none;
    padding: clamp(1.25rem, 1rem + 1.5cqi, 2rem); font-family: var(--gridlock-font-sans); font-size-adjust: from-font; line-height: 1.5;
    accent-color: var(--gridlock-accent); caret-color: var(--gridlock-accent); scrollbar-color: var(--gridlock-muted) transparent; container-type: inline-size;
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
  :where(.gridlock-dossier-surface code) { font-family: var(--gridlock-font-mono); font-size-adjust: from-font; font-variant-numeric: tabular-nums; font-size: max(0.75rem, 0.875em); }
  :where(.gridlock-dossier-surface a) { text-underline-offset: 0.2em; }
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
  :where(.gridlock-copy-chip) { display: inline-flex; align-items: center; gap: 0.4rem; min-block-size: 1.875rem; padding-block: 0.2rem; padding-inline: 0.55rem; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-paper); color: var(--gridlock-ink); font-family: var(--gridlock-font-mono); font-size: 0.75rem; line-height: 1.2; cursor: pointer; transition: border-color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-copy-chip:hover, .gridlock-copy-chip[data-copied="true"]) { border-color: var(--gridlock-accent); background-color: var(--gridlock-card); }
  :where(.gridlock-copy-chip[data-copied="true"] .gridlock-copy-icon) { color: var(--gridlock-accent); }
  :where(.gridlock-dossier-surface :is(button, a, [role="button"], [tabindex="0"], summary)):focus-visible { outline: 2px solid var(--gridlock-ink); outline-offset: 2px; }
  @keyframes gridlock-opacity-pulse { 0%, 100% { opacity: 0.84; } 50% { opacity: 0.44; } }
  :where(.gridlock-loading-placeholder) { display: grid; gap: 1.75rem; min-block-size: 36rem; align-content: start; animation: gridlock-opacity-pulse 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite; }
  :where(.gridlock-loading-stats) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 1.25rem 2rem; }
  :where(.gridlock-loading-stat) { min-block-size: 5rem; background-color: var(--gridlock-card); border-inline-start: 1px solid var(--gridlock-border); }
  :where(.gridlock-loading-chart) { min-block-size: 13.5rem; background-color: var(--gridlock-card); border-block: 1px solid var(--gridlock-border-strong); }
  :where(.gridlock-loading-sheet) { min-block-size: 13rem; background-color: var(--gridlock-card); border-block-start: 1px solid var(--gridlock-border); }
  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-loading-placeholder) { animation: none; }
    :where(.gridlock-dossier-surface, .gridlock-action-btn, .gridlock-md-link, .gridlock-copy-chip), :where(.gridlock-action-btn, .gridlock-md-link)::before { transition: none; }
  }
  @media (forced-colors: active) {
    :where(.gridlock-status-badge, .gridlock-copy-chip, .gridlock-banner) { border: 1px solid CanvasText; }
  }
`;

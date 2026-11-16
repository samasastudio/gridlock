import { GRIDLOCK_DOSSIER_BASE_CSS } from "./dossier-styles.ts";

export const GRIDLOCK_PLATE_WIDGET_STYLESHEET = `@layer gridlock-widgets {
${GRIDLOCK_DOSSIER_BASE_CSS}
  :where(.gridlock-plate-stage:not(.gridlock-dossier-surface *)) {
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
    color: var(--gridlock-ink); font-family: var(--gridlock-font-sans); font-size-adjust: from-font; line-height: 1.5; container-type: inline-size;
  }
  :where(.gridlock-plate-stage code) { font-family: var(--gridlock-font-mono); font-size-adjust: from-font; font-variant-numeric: tabular-nums; font-size: max(0.75rem, 0.875em); }
  :where(.gridlock-plate-stage :is(button, a, [role="button"], [tabindex="0"], summary)):focus-visible { outline: 2px solid var(--gridlock-ink); outline-offset: 2px; }
  :where(.gridlock-plate-stage) { display: flex; flex-direction: column; gap: 1rem; min-inline-size: 0; }
  :where(.gridlock-plate-scrubber-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; border-block-end: 1px solid var(--gridlock-border); padding-block-end: 0.5rem; }
  :where(.gridlock-plate-stage .gridlock-section-heading) { margin: 0; font-family: var(--gridlock-font-display); font-size-adjust: cap-height from-font; font-size: 0.875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gridlock-ink); }
  :where(.gridlock-plate-stage .gridlock-tab-list) { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; max-inline-size: 100%; }
  :where(.gridlock-plate-tab) { position: relative; min-block-size: 2.35rem; padding-inline: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: var(--gridlock-radius); background-color: transparent; color: var(--gridlock-muted); font-family: var(--gridlock-font-mono); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: color 320ms cubic-bezier(0.16, 1, 0.3, 1), background-color 320ms cubic-bezier(0.16, 1, 0.3, 1); }
  :where(.gridlock-plate-tab:hover, .gridlock-plate-tab[aria-selected="true"]) { color: var(--gridlock-ink); background-color: var(--gridlock-card); }
  :where(.gridlock-branch-dot) { display: inline-block; flex-shrink: 0; inline-size: 0.45rem; block-size: 0.45rem; background-color: var(--gridlock-accent); }
  :where(.gridlock-plate-tab-indicator) { position: absolute; inset-inline: 0; inset-block-end: 0; block-size: 2px; background-color: var(--gridlock-accent); }
  :where(.gridlock-plate-panel) { display: flex; flex-direction: column; gap: 1.15rem; min-inline-size: 0; }
  :where(.gridlock-plate-viewport) { margin: 0; border: 1px solid var(--gridlock-border-strong); border-radius: var(--gridlock-radius); background-color: var(--gridlock-card); box-shadow: none; min-inline-size: 0; }
  :where(.gridlock-plate-viewport[data-branch="true"]) { border-color: var(--gridlock-accent); }
  :where(.gridlock-plate-meta-bar) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.65rem 1rem; padding-block: 0.65rem; padding-inline: clamp(0.85rem, 2cqi, 1.25rem); border-block-end: 1px solid var(--gridlock-border); background-color: var(--gridlock-paper); }
  :where(.gridlock-plate-stage .gridlock-status-badge) { padding-block: 0.25rem; }
  :where(.gridlock-plate-turn-stamp) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-inline-size: 0; max-inline-size: 100%; font-family: var(--gridlock-font-mono); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-plate-img) { display: block; inline-size: 100%; block-size: auto; aspect-ratio: 16 / 9; object-fit: cover; }
  :where(.gridlock-plate-fallback) { display: flex; flex-direction: column; justify-content: center; gap: 0.55rem; min-block-size: 13rem; padding: clamp(1rem, 3cqi, 1.75rem); background-color: var(--gridlock-card); color: var(--gridlock-ink); }
  :where(.gridlock-plate-fallback-head) { display: inline-flex; align-items: center; gap: 0.55rem; font-family: var(--gridlock-font-display); font-size: 0.9375rem; font-weight: 700; }
  :where(.gridlock-plate-fallback-copy) { margin: 0; max-inline-size: 62ch; font-size: 0.875rem; color: var(--gridlock-muted); overflow-wrap: anywhere; }
  :where(.gridlock-plate-stage .gridlock-empty-row) { margin: 0; display: flex; align-items: center; gap: 0.55rem; padding-block: 1.25rem 0.25rem; font-size: 0.9375rem; color: var(--gridlock-ink); }
  @media (prefers-reduced-motion: reduce) {
    :where(.gridlock-plate-tab) { transition: none; }
  }
}`;

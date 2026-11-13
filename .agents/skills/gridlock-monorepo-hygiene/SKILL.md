---
name: gridlock-monorepo-hygiene
description: >-
  VM ext4 node_modules bind-mount setup and single-pass verification for gridlock.
  Use when virtiofs/npm reports EMFILE or EPERM, or before running local verification.
---

# Gridlock Monorepo Hygiene (`gridlock-monorepo-hygiene`)

## 1. Single-Pass Verification

- Run `npm run verify` for single-pass dependency mount, TypeScript project build/typecheck (`noUnusedLocals` / `noUnusedParameters`), architecture/unused-export lint, test execution, and headless widget workbench `--smoke-check`; run `PR_BASE_REF=<base> npm run check:pr-size` to verify the `<= 700`-line PR budget.
- Run `npm run preview:widgets` to launch the CSF3 Story + live HTTP API workbench on `http://localhost:6006` (or `npm run preview:widgets -- --smoke-check` standalone).
  - Keep workbench controls inside the single slim `#18181b` `<select>` header bar with generous `<main>` canvas margin so harness chrome stays visually separated from widget surfaces.
  - `/bundle.js` rebuilds `packages/widgets/**` on every request, while `INDEX_HTML`, `buildVirtualClientEntry()`, and seeded `/api/*` fixtures load once at server startup—restart any running `:6006` process after editing `scripts/widget-workbench.mjs` or story module exports.
  - For interactive `react-dom/client` widget tests on Node 24, mount via [`withWidgetDom`](../../../packages/widgets/test/helpers/dom-harness.ts) (pairing same-file SSR checks with `renderToStaticMarkup`, not `renderToReadableStream`). For local MotionScore audits against `:6006`, run `npx motionscore http://127.0.0.1:6006 --no-upload` (text mode; `--json` and `--threshold` require a paid plan).
- For branching, stacked PR targeting, `/code-review`, `/pr`, and `gh` CLI commands, read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md).

---

## 2. Android Laptop VM `ext4` Bind-Mount Discipline

- `/storage/emulated/10/saj-repositories/gridlock` is mounted over `virtiofs` (Android FUSE), where extracting `node_modules` exhausts host `crosvm` file descriptors (`EMFILE`) and POSIX symlinks return `EPERM`.
- [`scripts/ensure-ext4-deps.sh`](../../../scripts/ensure-ext4-deps.sh) installs packages in `$HOME/.cache/projects/gridlock-10494555/deps/node_modules` on native `ext4` and bind-mounts that directory onto `./node_modules`.
- If `virtiofs` reports `too many open files`, flush the guest kernel VFS dentry cache:
  ```bash
  echo 3 | sudo tee /proc/sys/vm/drop_caches
  ```

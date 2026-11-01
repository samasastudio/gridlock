---
name: gridlock-monorepo-hygiene
description: >-
  VM ext4 node_modules bind-mount setup and single-pass verification for gridlock.
  Use when virtiofs/npm reports EMFILE or EPERM, or before running local verification.
---

# Gridlock Monorepo Hygiene (`gridlock-monorepo-hygiene`)

## 1. Single-Pass Verification

- Run `npm run verify` for single-pass dependency mount, TypeScript project build/typecheck, architecture/style lint, and test execution, and `PR_BASE_REF=<base> npm run check:pr-size` to verify the `<= 700`-line PR budget.
- For branching, stacked PR targeting, `/code-review`, `/pr`, and `gh` CLI commands, read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md).

---

## 2. Android Laptop VM `ext4` Bind-Mount Discipline

- `/storage/emulated/10/saj-repositories/gridlock` is mounted over `virtiofs` (Android FUSE), where extracting `node_modules` exhausts host `crosvm` file descriptors (`EMFILE`) and POSIX symlinks return `EPERM`.
- [`scripts/ensure-ext4-deps.sh`](../../../scripts/ensure-ext4-deps.sh) installs packages in `$HOME/.cache/projects/gridlock-10494555/deps/node_modules` on native `ext4` and bind-mounts that directory onto `./node_modules`.
- If `virtiofs` reports `too many open files`, flush the guest kernel VFS dentry cache:
  ```bash
  echo 3 | sudo tee /proc/sys/vm/drop_caches
  ```

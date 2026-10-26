---
name: gridlock-monorepo-hygiene
description: >-
  Use when working in the gridlock repository: creating feature branches and PRs,
  running tests/typechecks with the VM ext4 node_modules bind-mount, implementing
  TDLR connectors, Gemini Interactions API agents, or Atlas Dossier React widgets.
---

# Gridlock Monorepo Hygiene (`gridlock-monorepo-hygiene`)

## 1. TDD, Two-Axis Review & PR Workflow

1. **Branch & PR Sequence**: Follow [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) (branch off `main` $\to$ `/tdd` $\to$ two-axis `/code-review` $\to$ `gh pr create` with `/pr` $\to$ present PR URL for human review).
2. **Drive Implementation via `/tdd`**:
   - Test only at the pre-agreed public seam (`packages/core` or `packages/widgets`), one Red → Green vertical slice at a time.
   - Run single-file TDD checks via `npm test -- packages/core/test/<file>.test.ts` so `pretest` (`ensure-ext4-deps.sh`) always verifies the `ext4` `node_modules` bind-mount.
   - Verify both the **Happy Path** and **Sad Path** gates in [`ROADMAP.md`](../../../ROADMAP.md) and check off their boxes (`- [x]`).

---

## 2. Android Laptop VM `ext4` Bind-Mount Discipline

- `/storage/emulated/10/saj-repositories/gridlock` is mounted over `virtiofs` (Android FUSE), where extracting `node_modules` exhausts host `crosvm` file descriptors (`EMFILE`) and POSIX symlinks return `EPERM`.
- `scripts/ensure-ext4-deps.sh` (wired automatically into `pretest`, `prelint`, `pretypecheck`, `prebuild`) installs packages in `$HOME/.cache/projects/gridlock-10494555/deps/node_modules` on native `ext4` and bind-mounts that directory onto `./node_modules`.
- If `virtiofs` ever reports `too many open files`, flush the guest kernel VFS dentry cache:
  ```bash
  echo 3 | sudo tee /proc/sys/vm/drop_caches
  ```

---

## 3. Specialist Skill Pointers by Wave

- **Wave 2 & 4 (`@google/genai` Interactions API)**: Read [`gemini-api-dev`](/home/droid/.gemini/config/plugins/gemini-api/skills/gemini-api-dev/SKILL.md) before calling `client.interactions.create` (`gemini-3.8-flash` and `gemini-3-pro-image`).
- **Wave 2 & 5 (Cloud Firestore & Security Rules)**: Read [`firebase-firestore`](/home/droid/.gemini/config/plugins/firebase/skills/firebase_firestore/SKILL.md) and delegate any `firestore.rules` authoring to the `firestore-rules-author` subagent.
- **Wave 3 & 4 (`@samasastudio/gridlock-widgets` & Storybook)**: Read [`atlas-repo-architecture`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/atlas-repo-architecture/SKILL.md), [`atlas-svg-artwork`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/atlas-svg-artwork/SKILL.md), and [`vercel-composition-patterns`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/vercel-composition-patterns/SKILL.md).

# Gridlock (`samasastudio/gridlock`) — Agent Pointers

- **GitHub Issues, `gh` CLI & Stacked PR Workflow**: Read [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) before running any `gh` command (`--json` and REST `PATCH` required), branching or stacking PRs, reading PR reviews, or committing/pushing/opening a Pull Request after human editor approval (`git commit`/`git push`/`gh pr create` require explicit user request; `gh pr merge` is human-only).
- **VM `ext4` Bind-Mount & Verification**: Read [`.agents/skills/gridlock-monorepo-hygiene/SKILL.md`](./.agents/skills/gridlock-monorepo-hygiene/SKILL.md) when `virtiofs` / `npm` hits `EMFILE` or `EPERM` or before running local verification.
- **Unblocked Frontier & Acceptance Gates**: Read [`ROADMAP.md`](./ROADMAP.md) when selecting the next ticket or verifying Happy/Sad Path test gates.
- **Coding Standards & TDLR Polite Access**: Read [`CODING_STANDARDS.md`](./CODING_STANDARDS.md) during `/code-review` or when touching Gemini/Firestore/Atlas widget seams, and [`docs/connectors/tdlr-site-access-and-cadence.md`](./docs/connectors/tdlr-site-access-and-cadence.md) when touching TDLR connectors.
- **Triage Labels**: Read [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) when triaging or filtering issue labels.
- **Domain Glossary & ADRs**: Read [`docs/agents/domain.md`](./docs/agents/domain.md), [`GLOSSARY.md`](./GLOSSARY.md), and [`docs/adr/`](./docs/adr/) before naming domain concepts or modifying architecture.

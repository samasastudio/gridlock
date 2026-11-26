# Gridlock (`samasastudio/gridlock`) — Agent Pointers

- **Unblocked Frontier & Acceptance Gates**: Query GitHub's live `blocked_by == 0` frontier (see [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)) when selecting the next ticket; read [`ROADMAP.md`](./ROADMAP.md) for wave scope and Happy/Sad Path test gates.
- **Coding Standards, Widgets & VM Hygiene**: Read [`CODING_STANDARDS.md`](./CODING_STANDARDS.md) during pre-PR reviews, when touching `packages/core` Gemini/Firestore seams (§2–§4), before styling or testing `packages/widgets` (§5, plus [`../profile-site/design-systems/`](../profile-site/design-systems/) and the `motion` / `impeccable` skills), or before running local verification / troubleshooting `virtiofs` `EMFILE` or `EPERM` errors (§6). Read [`docs/connectors/tdlr-site-access-and-cadence.md`](./docs/connectors/tdlr-site-access-and-cadence.md) when touching TDLR connectors.

## Agent skills

### Issue tracker

GitHub Issues and stacked PRs (`samasastudio/gridlock`). Read [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) before running `gh` commands (`--json` and REST `PATCH` required on `gh` 2.46), slicing follow-up issues, branching or stacking PRs, reading PR reviews, or committing/opening a Pull Request.

### Triage labels

Uses the five default canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Domain docs

Single-context (`GLOSSARY.md` + `docs/adr/` at the repo root across `packages/*`). Read [`docs/agents/domain.md`](./docs/agents/domain.md), [`GLOSSARY.md`](./GLOSSARY.md), and [`docs/adr/`](./docs/adr/) before naming domain concepts or modifying architecture.

# Gridlock — Agent Guidelines (`AGENTS.md`)

## Agent skills & context pointers

- **Execution Order & Validation Gates**: Read [`ROADMAP.md`](./ROADMAP.md) to find the unblocked ticket frontier and required Happy/Sad Path test gates.
- **Repo Hygiene, `ext4` Bind-Mount & PR Workflow**: Read [`.agents/skills/gridlock-monorepo-hygiene/SKILL.md`](./.agents/skills/gridlock-monorepo-hygiene/SKILL.md) before starting a ticket, running builds/tests, or opening a PR. Never commit directly to `main`; always work on a feature branch, run two-axis `/code-review`, and open a Pull Request shaped with `/pr`.
- **Coding Standards & Civic Stewardship**: Read [`CODING_STANDARDS.md`](./CODING_STANDARDS.md) and [`docs/connectors/tdlr-site-access-and-cadence.md`](./docs/connectors/tdlr-site-access-and-cadence.md) during `/code-review` or when touching connectors, Gemini agents, or widgets.
- **Issue Tracker (`gh` CLI & PR workflow)**: Read [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
- **Triage Labels**: Read [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).
- **Domain Glossary & ADRs**: Read [`docs/agents/domain.md`](./docs/agents/domain.md), [`GLOSSARY.md`](./GLOSSARY.md), and [`docs/adr/`](./docs/adr/).

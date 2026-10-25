# Gridlock — Agent Guidelines (`AGENTS.md`)

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md` and the execution order in `ROADMAP.md`.

### Triage labels

Uses the five default canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`GLOSSARY.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.

## Ethical, Legal & Civic Stewardship ("Cause No Harm")

- **Zero Circumvention**: Never bypass, spoof, or evade `robots.txt`, WAF challenges, CAPTCHAs, rate limiters (`429` / `Retry-After`), or authentication gates. If a portal restricts access, halt immediately with `blocked_by_waf`.
- **Transparent Identification & Polite Load**: Always identify requests with `GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)` and enforce `maxConcurrency: 1` with `>= 1,500ms` inter-request delay.
- **PII Redaction**: Strip incidental personal contact information (personal phone numbers, personal emails, residential addresses) before persisting `Project` or `Observation` records; retain only corporate entity and facility metadata. See `docs/connectors/tdlr-site-access-and-cadence.md`.

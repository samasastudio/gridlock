# Gridlock Coding Standards (`CODING_STANDARDS.md`)

Read during `/code-review` (Standards axis) and when designing modules across `packages/core` and `packages/widgets`. Every rule below must be satisfied before a Pull Request merges to `main`.

---

## 1. Branch, Pull Request & Review Discipline

- **Branch per Ticket**: All changes land on a dedicated branch (`feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `chore/<slug>`). `.githooks/pre-commit` rejects direct commits to `main`.
- **Two-Axis Review Before PR**: Run `/code-review` (`main...HEAD`) across both **Standards** (this file + `GLOSSARY.md` + `docs/adr/`) and **Spec** (the originating GitHub Issue + `ROADMAP.md` Happy/Sad Path gates) and resolve findings before opening a PR.
- **Structured PR Bodies (`/pr`) & Human-Only Merge Gate**: Shape every Pull Request body with `## Summary` (smallest diagram, call-tree, or diff-sketch), `## Evidence` (Before/After test or Storybook verification), and `## Merge Danger` (`Door: one-way | two-way` and `Blast Radius`). **Agents must never run `gh pr merge` or merge into `main` autonomously**—always stop after `gh pr create` and wait for the human repository owner to review and merge.

---

## 2. Clean Architecture, Deep Modules & Seams (`packages/core`)

- **Four-Folder Clean Architecture Layout (`ADR-0004`)**: Every file under `packages/core/src/` (except the public barrel `src/index.ts`) must reside in one of four directories and stay `<= 300` lines (enforced by `npm run lint`):
  1. `interfaces/` — Zod schemas, TypeScript domain models, adapter contracts (`GridlockRepository`, `PageLoader`, `GeminiInteractionsClient`, `TelemetrySpanSink`), constants, and seed defaults. Must never import from `use-cases/`, `adapters/`, or `controllers/`.
  2. `use-cases/` & `use-cases/helpers/` — Business logic orchestrators (`use-cases/`) and pure, zero-I/O deterministic parsers and state transitions (`use-cases/helpers/`). `use-cases/helpers/` must never import from `adapters/` or `controllers/`.
  3. `adapters/` — Concrete implementations interfacing with external tools (`in-memory-repository.ts`, `http-loaders.ts`, `cloud-logging-sink.ts`). Keep repository adapters focused on storage and delegate state transitions (heal amortization, MTTR averaging, quarantine promotion) to pure functions in `use-cases/helpers/`.
  4. `controllers/` — HTTP route controllers and request/query validation (`telemetry-controller.ts`, `http-server.ts`).
- **Shared Domain Primitives**: Define domain-specific Zod primitives (`Sha256HashSchema`, `TdlrProjectNumberSchema`) once in [`packages/core/src/interfaces/primitives.ts`](./packages/core/src/interfaces/primitives.ts) and compose them across entity schemas rather than repeating raw regular expressions.
- **Dependency Injection at Seams**: Inject external boundaries (`GridlockRepository`, `PageLoader`, Gemini client) as explicit parameters at the module's public seam. Test behavior exclusively through public interfaces (`ingestTdlrFiling`, HTTP handlers, widget props), never by mocking internal helpers.
- **Quarantine Isolation**: Quarantined `/quarantine/{sha256}.gz` `SourceArtifact` records must never satisfy the canonical `unchanged_artifact` SHA-256 short-circuit gate. Re-running ingestion after a `ConnectorConfig` heal must re-parse and promote the artifact to `/artifacts/{sha256}.gz`.
- **Pre-Parse Site Access Classification**: Inspect HTTP status (`403`, `429`, `503`), `robots.txt` directives, `Retry-After` headers, and WAF signatures (`_Incapsula_Resource`, `cf-mitigated`, `challenge-platform`, `g-recaptcha`) in `verifySiteAccess` **before** evaluating `ConnectorConfig` selectors. Classify access blocks as `blocked_by_waf` (`0` Gemini tokens) and reserve `selector_anomaly` strictly for verified portal HTML where extraction invariants fail.

---

## 3. Civic Stewardship & PII Redaction

- **Transparent Bot Identity & Polite Pacing**: Send `User-Agent: GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)` on every portal request, run single-flight (`maxConcurrency: 1`, `>= 1,500ms` inter-request delay), and enforce the `<= 100` records/run circuit breaker.
- **Deterministic PII Sanitization**: Redact personal phone numbers, personal email addresses, and residential street addresses before persisting `Project` or `Observation` records or hydrating `UI AST` props; retain only corporate entity names (`OwnerName`, `FacilityName`, `DesignFirmName`) and municipal/county fields.
- **Epistemic Labeling on Branched Plates**: Watermark and label all speculative user-branched `VisualPlate` records (`POST /api/plates/branch`) as `"Scenario Branch / Unverified Projection"`.

---

## 4. Bounded Gemini Interactions API (`ADR-0003`)

- **SDK & Models**: Use `@google/genai` (`>= 2.29.1`) `client.interactions.create` exclusively with `gemini-3.8-flash` (Out-of-Band Repair Agent and Investigation Planner) and `gemini-3-pro-image` (Stateful Painter Agent with `store: true` and `previous_interaction_id`).
- **Context Pointer**: Consult [`gemini-api-dev`](/home/droid/.gemini/config/plugins/gemini-api/skills/gemini-api-dev/SKILL.md) before writing or reviewing any `@google/genai` code.

---

## 5. React 19 & Atlas Dossier Widget Standards (`packages/widgets`)

- **Component Budgets & Composition**: Keep interactive `.tsx` files `<= 220` lines (enforced by `npm run lint`). Prefer compound components and explicit variant components over boolean prop proliferation, and pass `ref` as a standard React 19 prop (`vercel-composition-patterns`).
- **Tear-Free Browser Subscriptions & Static JSX Hoisting**: Use `useSyncExternalStore` for browser/theme subscriptions (`matchMedia`, `localStorage`) instead of `useEffect([])` + `useState`, and hoist static SVG/JSX elements to module scope (`vercel-react-best-practices`).
- **Diurnal / Nocturnal Theme Token Inheritance**: Bind widget surfaces and SVG plates to the Atlas Dossier CSS custom properties (`--paper`, `--ink`, `--relief-*`) so widgets adapt seamlessly between Light (`:root`) and Dark (`.dark`) modes when mounted in `profile-site`.
- **Cross-Repo Context Pointers**:
  - [`atlas-repo-architecture`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/atlas-repo-architecture/SKILL.md) — surface modularity, hook extraction, and CSS token structure.
  - [`atlas-svg-artwork`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/atlas-svg-artwork/SKILL.md) — multi-plane SVG relief geometry, negative-$Y$ `viewBox`, and `motion/react` parallax choreography.
  - [`vercel-composition-patterns`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/vercel-composition-patterns/SKILL.md) & [`vercel-react-best-practices`](/storage/emulated/10/saj-repositories/profile-site/.agents/skills/vercel-react-best-practices/SKILL.md) — React 19 component design and rendering performance.

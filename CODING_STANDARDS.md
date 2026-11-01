# Gridlock Coding Standards (`CODING_STANDARDS.md`)

Read during `/code-review` (Standards axis) and when designing modules across `packages/core` and `packages/widgets`. Every rule below must be satisfied before a Pull Request merges to `main`.

---

## 1. Branch, Pull Request & Review Discipline

- **Branch per Ticket**: All changes land on a dedicated branch (`feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `chore/<slug>`). `.githooks/pre-commit` rejects direct commits to `main` and runs `npm run verify`.
- **Pull Request Size Budget (`<= 700` Lines)**: Keep every Pull Request `<= 700` changed lines (`insertions + deletions` against its target base branch, enforced in CI via `npm run check:pr-size`). When a ticket requires more than `700` lines across implementation and tests, slice it into stacked vertical Pull Requests (`#N part 1/k..k/k`), each independently compiling, lint-clean, and test-verified.
- **Self-Contained Vertical Slices & Post-Restack PR Accuracy**: Every PR slice must wire and exercise every newly introduced production symbol through a caller-facing seam within that slice; defer future-ticket entrypoints to their own issue. After restacking or amending commits, verify every symbol identifier, `@samasastudio/*` package name, and `ADR-0001`–`ADR-0004` reference in the PR body against `git diff <base>...HEAD`.
- **Two-Axis Review, Editor Review Gate & Human-Only Merge**: Run `/code-review` across **Standards** (this file + `GLOSSARY.md` + `docs/adr/`) and **Spec** (the originating GitHub Issue + `ROADMAP.md` Happy/Sad Path gates), then leave verified changes uncommitted in the working tree and stop for human review in the code editor. Only when explicitly instructed by the user, commit, push, shape the PR body with `/pr` (`## Summary`, `## Evidence`, `## Merge Danger`), and stop after `gh pr create` (`gh pr merge` is human-only).

---

## 2. Clean Architecture, Deep Modules & Seams (`packages/core`)

- **Four-Folder Clean Architecture Layout (`ADR-0004`)**: Every file under `packages/core/src/` (except the public barrel and Composition Root `src/index.ts`) must reside in one of four directories and stay `<= 300` lines (enforced by `npm run lint`). Runtime control flow proceeds `controllers/ -> use-cases/ -> adapters/`, while source-code imports point strictly inward via Dependency Inversion:
  1. `controllers/` — Inbound HTTP route controllers and request/query validation (`telemetry-controller.ts`, `http-server.ts`). May only import from `controllers/`, top-level `use-cases/`, and `interfaces/` (never `adapters/` or `use-cases/helpers/`).
  2. `use-cases/` & `use-cases/helpers/` — Business logic orchestrators (`use-cases/`) and pure, synchronous, zero-I/O deterministic parsers and state transitions (`use-cases/helpers/`). `use-cases/` computes domain transitions via `use-cases/helpers/` and calls abstract port contracts in `interfaces/` (never importing concrete `adapters/` or `controllers/`). `use-cases/helpers/` must remain 100% pure and only import from `interfaces/` or sibling helpers.
  3. `adapters/` — Concrete implementations interfacing with external tools (`in-memory-repository.ts`, `http-loaders.ts`, `cloud-logging-sink.ts`). May only import from `adapters/` and `interfaces/` (never `use-cases/` or `controllers/`). Default adapter instances (`defaultPageLoader`, `defaultSearchLoader`) are wired at the Composition Root (`src/index.ts`).
  4. `interfaces/` — Zod schemas, TypeScript domain models, abstract port interfaces (`GridlockRepository`, `TdlrPageLoader`, `TdlrSearchLoader`, `GeminiInteractionsClient`, `TelemetrySpanSink`), constants, and seed defaults. Must never import from `use-cases/`, `adapters/`, or `controllers/`.
- **Non-Mutative Control Flow & Array Methods**: Avoid `let` declarations, imperative `for (...)` loops, and side-effecting `.forEach(...)` calls in `packages/core/src/` (enforced by `npm run lint`). Favor `const` bindings, early returns over nested conditionals, small pure helper functions for `try/catch` boundaries, and declarative expressions (`.map()`, `.filter()`, `.find()`, `.flatMap()`, `.reduce()`, `Array.from()`).
- **Shared Domain Primitives & Coupled Variants**: Define domain-specific Zod primitives (`Sha256HashSchema`, `TdlrProjectNumberSchema`, `IsoCalendarDateSchema`, `PositiveIntegerStringSchema`) once in [`packages/core/src/interfaces/primitives.ts`](./packages/core/src/interfaces/primitives.ts). When a schema, turn spec, or result type has mode-dependent invariants (e.g., canonical vs. scenario-branch `VisualPlate`, deterministic vs. agentic runs), model the variants as a discriminated union or `.superRefine` contract rather than loose boolean and nullable sibling fields.
- **Deep Modules & Seam Discipline**: Inject adapters (`GridlockRepository`, `TdlrPageLoader`, `TdlrSearchLoader`, `GeminiInteractionsClient`, `TelemetrySpanSink`) as explicit parameters at the use case's seam, require precomputed state transitions (`TelemetryStateUpdate`, `ConnectorPromotionStateUpdate`) on repository persistence methods so adapters stay thin, keep adapter-specific mechanics (`PlaywrightPageLike`) inside `adapters/`, and expose only caller-facing interfaces at `packages/core/src/index.ts` (enforced by `npm run lint`, which blocks new `use-cases/helpers/` barrel exports and deep `src/` imports from `packages/*/test/`). Test behavior exclusively through public interfaces (`ingestTdlrFiling`, `runTdlrDiscoverySweep`, `runOutOfBandRepairAgent`, `bootstrapCanvas`, `paintMilestoneDelta`, `branchLineage`, HTTP handlers, widget props).
- **TTL-Aware Reads, Zero-Write Precondition Guards & Collision-Safe IDs**:
  1. Filter `expiresAt === null || Date.parse(expiresAt) > nowMs` in application logic when enforcing active quotas or resolving parent records; Firestore background TTL deletion is asynchronous and lags wall-clock expiry (`ADR-0002`).
  2. Validate caller input, parent existence/expiry, and rate/quota preconditions at `0` Gemini tokens *before* writing permanent (`expiresAt: null`) `telemetry_runs` documents or incrementing `EfficiencyLedger.agenticRunsCount`.
  3. Include a unique turn or interaction discriminator alongside content hashes in deterministic entity IDs whenever sibling branches can share the same parent and output bytes.
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

# Gridlock Coding Standards (`CODING_STANDARDS.md`)

Read during pre-PR code reviews (Standards axis) and when designing modules across `packages/core` and `packages/widgets`. Mechanical rules enforced by `npm run lint` and `tsc -b` are noted concisely; this file focuses on architecture and judgement calls.

---

## 1. Branch, Pull Request & Slice Discipline

- **Single Source of Truth**: Follow [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) for issue chunking, branch naming, stacked PR mechanics, Editor Review Gate, merge rules, and opt-in GitHub inline reviews.
- **Pull Request Size (`<= 800` Lines, Target `<= 650-700`) & No Line-Golfing**: Enforced via `npm run check:pr-size` (and `--working-tree` during phase work). Never line-golf control flow or merge test assertions to fit a PR or file-line cap; chunk issues upfront into single-PR vertical slices and extract cohesive modules for file caps.
- **Self-Contained Vertical Slices**: Every PR slice must wire and exercise newly introduced production symbols through a caller-facing seam (`npm run lint` enforces non-barrel unused exports). Keep PR review fixes proportional at the owning seam and reuse existing test seed helpers rather than duplicating setup.

---

## 2. Clean Architecture, Deep Modules & Type Hygiene (`packages/core`)

- **Four-Folder Clean Architecture Layout (`ADR-0004`)**: Every file under `packages/core/src/` (except `src/index.ts`) resides in `controllers/`, `use-cases/` (plus pure zero-I/O `use-cases/helpers/`), `adapters/`, or `interfaces/` and stays `<= 400` lines (enforced by `npm run lint`). Source imports point strictly inward (`controllers -> use-cases -> interfaces`; `adapters -> interfaces`; `use-cases/helpers -> interfaces`). Default adapter instances are wired only at `src/index.ts`.
- **Cohesive Module Boundaries**: When a module approaches the `400`-line core or `280`-line widget cap, extract a cohesive domain capability with its own clear boundary rather than slicing one workflow into pass-through wrappers or `-seam-` sibling files.
- **Strict TypeScript & Non-Mutative Control Flow**: Production packages compile with `strict`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess`. `npm run lint` rejects `@ts-ignore`/`@ts-nocheck`, explicit or inherent `any` leaks (`JSON.parse`, `res.json()`, `.catch((err) => ...)`, `Array.isArray(x)` callbacks must narrow via `unknown`), and mutable `let`, `for`, `while`, or `.forEach` in `packages/*/src/`.
- **Shared Domain Primitives & Coupled Variants**: Define domain Zod primitives once in [`packages/core/src/interfaces/primitives.ts`](./packages/core/src/interfaces/primitives.ts). Model mode-dependent invariants (e.g., canonical vs. Scenario Branch `GeneratedIllustration`, deterministic vs. agentic runs) as discriminated unions or `.superRefine` contracts rather than loose boolean/nullable sibling fields.
- **Deep Modules & Seam Discipline**: Inject adapters (`GridlockRepository`, `TdlrPageLoader`, `TdlrSearchLoader`, `GeminiInteractionsClient`, `RunSpanSink`) at the use-case seam, keep adapter-specific mechanics inside `adapters/`, and test behavior exclusively through public package barrels (`npm run lint` blocks new helper barrel exports and deep `src/` test imports).
- **Transactional Persistence Callbacks & Bounded Reads**: Pass pure transition callbacks (`RecordRunTransition`, `ConnectorPromotionTransition`, `RawCaptureMetadataTransition` declared in `interfaces/adapter-contracts.ts`) into atomic `GridlockRepository` methods (`recordRunRecord`, `promoteConnectorConfig`, `updateRawCaptureMetadata`) instead of performing unlocked caller read-modify-write sequences or passing precomputed whole-collection state bags. Adapters read bounded `RECENT_RUN_RECORDS_LIMIT` (`50`) windows and single matching `RepairChangelogEntry` rows inside the atomic boundary, validate all callback outputs before mutating state (zero partial writes), and update `RawCapture` retention metadata without downloading or re-uploading `.gz` bytes.
- **TTL-Aware Reads, Zero-Write Precondition Guards & Collision-Safe IDs**:
  1. Serialize non-null `expiresAt` values in Firestore as native Firestore `Timestamp` objects (permanent records as `null`), normalize back to ISO-8601 at the read boundary, and filter `expiresAt === null || Date.parse(expiresAt) > nowMs` in application logic (`ADR-0002`).
  2. Validate caller input, parent existence/expiry, and rate/quota preconditions at `0` Gemini tokens *before* writing permanent `run_records` documents or incrementing `EfficiencyScorecard.agenticRunsCount`.
  3. Include a unique turn or interaction discriminator alongside content hashes in deterministic entity IDs whenever sibling branches can share a parent and output bytes.
- **Quarantine Isolation & Stored-Record Identity**: Quarantined `/quarantine/{sha256}.gz` `RawCapture` records must never satisfy the canonical `unchanged_artifact` short-circuit gate; re-ingesting after a heal must re-parse and promote to `/artifacts/{sha256}.gz`. Verify stored document identity fields match the queried key before returning `200`, and escape CommonMark/HTML metacharacters (`\`, `<`, `>`, `` ` ``, `*`, `_`, `[`, `]`, `~`) while collapsing newlines before interpolating portal or LLM strings into prose.
- **Classification Precedence & Fail-Closed Guards**: Inspect specific body signatures (e.g., WAF/CAPTCHA markers `_Incapsula_Resource`, `cf-mitigated`, `challenge-platform`, `g-recaptcha`) and `robots.txt` directives with clear precedence over generic HTTP status codes (`403`, `429`, `503`), reserving `selector_anomaly` strictly for verified portal HTML. In both production fast-paths and live-test skip guards (e.g., maintenance `503` returns or XMP watermark checks), verify that encoding asymmetries or generic status matches cannot silently mask real failures.

---

## 3. Civic Stewardship & PII Redaction

- **Transparent Bot Identity & Polite Pacing**: Send `User-Agent: GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)` on every portal request, run single-flight (`maxConcurrency: 1`, `>= 1,500ms` inter-request delay), and enforce the `<= 100` records/run circuit breaker.
- **Deterministic PII Sanitization**: Redact personal phone numbers, personal email addresses, and residential street addresses before persisting `Project` or `Observation` records or hydrating `WorkspaceLayout` props; retain only corporate entity names (`OwnerName`, `FacilityName`, `DesignFirmName`) and municipal/county fields.
- **Epistemic Labeling on Scenario Branches**: Watermark and label all speculative user-branched `GeneratedIllustration` records (`POST /api/illustrations/branch`) as `"Scenario Branch / Unverified Projection"`.

---

## 4. Bounded Gemini Interactions API (`ADR-0003`)

- **SDK & Models**: Use `@google/genai` (`>= 3.2.0`, v1 GA Interactions API) `client.interactions.create` with `gemini-3.8-flash` (Out-of-Band Repair Agent and UI Orchestration Agent) and `gemini-3-pro-image` (Stateful Painter Agent with `store: true` and `previous_interaction_id`). Legacy SDKs, `models.generateContent`, and older Gemini model IDs are blocked by `npm run lint`. On live `v1`, wrap multimodal `input` arrays in `[{ type: "user_input", content }]`, and note that `gemini-3-pro-image` requires a billed GCP project and only accepts `"image/jpeg"` (or omitted `mime_type`) in `response_format`.
- **Lightest Working Transport & Real Media Codecs**: Prefer plain `fetch` loaders (`defaultPageLoader`, `defaultSearchLoader`) for server-rendered HTML/JSON portals and only pull in Playwright/Chromium if live requests are blocked. Wire `sharp` behind `PainterImageEncoder` to decode JPEG/PNG/WebP into `.webp`, attach XMP via `.withXmp(xmp)` (`sharp >= 0.34`), and composite speculative branch banners from font-independent raw RGBA buffers (`{ raw: { width, height, channels: 4 } }`) so `node:24-slim` containers never render tofu.
- **Context Pointer**: Consult the `gemini-api-dev` skill before writing or reviewing any `@google/genai` code.

---

## 5. React 19 & Atlas Dossier Widget Standards (`packages/widgets`)

- **Component Budgets & Composition**: Keep interactive `.tsx` files `<= 280` lines (`npm run lint`). Prefer compound components and explicit variants over boolean prop proliferation, and pass `ref` as a standard React 19 prop (`vercel-composition-patterns`).
- **Browser-Safe Boundaries & CSF3 Exports**: Import runtime schemas from `"@samasastudio/gridlock-core/schemas"` (or `import type`), keep `packages/core/src/interfaces/` free of Node globals, and export CSF3 `Meta` objects strictly as `export default` (`npm run lint`).
- **Multi-Mode Prop Parity & Async Cleanup**: When supporting static props, `snapshotPromise`, and live `apiBaseUrl` fetches (including `apiBaseUrl=""` via `apiBaseUrl !== undefined`), derive secondary actions from the *resolved* snapshot and abort/clear retry state whenever query props change.
- **Synchronous State Reset**: Scope transient client state (local branches, alerts, internal selection, compare mode) to a composite `queryKey` (`` `${apiBaseUrl ?? "::static"}::${id}` ``) while preserving unsent draft text across transient errors. Derive tab/milestone feedback from active values (`copiedValue === value`) and key stateful `<details key={entry.id}>` disclosures.
- **Browser Subscriptions & Static JSX**: Use `useSyncExternalStore` for `matchMedia`/`localStorage` subscriptions instead of `useEffect([])` + `useState`, hoist static SVG/JSX constants to module scope (`vercel-react-best-practices`), and wrap animated widget roots in `<MotionConfig reducedMotion="user">` (`npm run lint` blocks legacy `"framer-motion"` and `useReducedMotion`).
- **Headless DOM Harness**: In [`withWidgetDom`](./packages/widgets/test/helpers/dom-harness.ts), defer `await import("react-dom/client")` until after `happy-dom` globals are bound so React 19 `ChangeEventPlugin` registers native `onChange` listeners; pair same-file `withWidgetDom` SSR checks with `renderToStaticMarkup` (`npm run lint`).
- **Theme Tokens & Shared Base CSS**: Bind surfaces and SVG illustrations to Atlas Dossier CSS custom properties (`--paper`, `--ink`, `--relief-*`, `color-scheme: only light` / `only dark`), keep shared `:where(...)` base rules byte-identical in [`dossier-styles.ts`](./packages/widgets/src/dossier-styles.ts), and use high-contrast `--gridlock-ink` (`>= 3:1` WCAG 1.4.11) for `:focus-visible` outlines.
- **Open Editorial Sheet & Progressive Disclosure (`DESIGN.md`)**: Compose widgets as open paper sheets rather than nested card grids: 2–3 unboxed `Geomanist` headline figures on `--paper` separated by `1px` hairlines, one primary visual or chart focal point, `Tinos` prose with a single-line inline metadata strip, and raw machine internals collapsed inside `<details>` (`+` / `−` `::before` cue). Enforce `--gridlock-radius: 0rem`, `font-size: max(0.75rem, 0.875em)` on `<code>`, and mineral `--gridlock-card` fills with `1px` `--gridlock-accent` alert borders.
- **Cumulative Run Charts & Visual Screenshot Gate**: Plot sparse run history as cumulative value over time against actual spend with keyboard-focusable event markers (`role="button"`, `tabIndex={0}`), animating dashed SVG strokes via `opacity` instead of `pathLength`. Before stopping for human review on UI changes, capture `1280px` diurnal, `nocturnal`, and `320px` PNG screenshots from `localhost:6006` and inspect them via `read_file` for single-row alignment, breathing room, and zero horizontal overflow.
- **Design Plates & Skill Pointers**:
  - [`../profile-site/design-systems/`](../profile-site/design-systems/) — canonical `Atlas-Dossier-Design-System` and `HEX-Bento` visual reference plates.
  - Skills (`motion`, `impeccable`, `atlas-repo-architecture`, `atlas-svg-artwork`, `vercel-composition-patterns`, `vercel-react-best-practices`).

---

## 6. Verification, Workbench & VM `ext4` Hygiene

- **Single-Pass Verification**: Run `npm run verify` for dependency mount, `tsc -b`, architecture/unused-export/type-hygiene lint, unit/widget tests, and headless workbench `--smoke-check`. Run `PR_BASE_REF=<base> npm run check:pr-size -- --working-tree` during phase work and `PR_BASE_REF=<base> npm run check:pr-size` before opening a PR.
- **Widget Workbench & MotionScore**: In `npm run preview:widgets` (`http://localhost:6006`), keep harness controls inside the single slim `#18181b` `<select>` header bar with generous `<main>` canvas margin. Restart any running `:6006` server after editing [`scripts/widget-workbench.mjs`](./scripts/widget-workbench.mjs) or story exports (`/bundle.js` rebuilds `packages/widgets/**` per request, whereas `INDEX_HTML`, `buildVirtualClientEntry()`, and `/api/*` seed fixtures load once at startup). Run local MotionScore checks with `npx motionscore http://127.0.0.1:6006 --no-upload` (text mode; `--json` and `--threshold` require a paid plan).
- **VM `ext4` `node_modules` Bind-Mount (`virtiofs` / Android FUSE)**: `/storage/emulated/10/saj-repositories/gridlock` sits on `virtiofs`, where extracting `node_modules` exhausts host file descriptors (`EMFILE`) and POSIX symlinks fail (`EPERM`). All `npm run` lifecycle `pre*` hooks invoke [`scripts/ensure-ext4-deps.sh`](./scripts/ensure-ext4-deps.sh) to install merged dependencies onto local `ext4` (`$HOME/.cache/projects/gridlock-10494555/deps/node_modules`) and bind-mount `./node_modules` (or fast-exit via manifest SHA on CI/cloud VMs). After changing `package.json`, run `bash ./scripts/ensure-ext4-deps.sh` (or `npm run verify`) rather than bare `npm install`.
- **Kernel VFS Cache Flush on `EMFILE`**: If `virtiofs` reports `too many open files`, flush the guest kernel VFS dentry cache:
  ```bash
  echo 3 | sudo tee /proc/sys/vm/drop_caches
  ```

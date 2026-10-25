# Gridlock — Execution Roadmap (`ROADMAP.md`)

> **Parent Specification**: [`samasastudio/gridlock#1`](https://github.com/samasastudio/gridlock/issues/1)  
> **Architecture & Domain**: [`GLOSSARY.md`](./GLOSSARY.md) · [`ADR-0001`](./docs/adr/0001-two-repo-google-cloud-topology.md) · [`ADR-0002`](./docs/adr/0002-firestore-and-cloud-storage-spine.md) · [`ADR-0003`](./docs/adr/0003-deterministic-first-bounded-ai.md) · [`TDLR Site Access & Cadence`](./docs/connectors/tdlr-site-access-and-cadence.md)

---

## Quick Session Pickup (Find Unblocked Frontier)

At the start of any coding session, run this command to query GitHub's native dependency graph and list every open ticket whose `blocked_by` count is `0`:

```bash
gh api --paginate 'repos/samasastudio/gridlock/issues?state=open&labels=ready-for-agent' \
  --jq '.[] | select(.issue_dependencies_summary.blocked_by == 0) | "#\(.number): \(.title) (\(.html_url))"'
```

When a ticket's PR is merged and the issue is closed, update its checkbox below (`- [x]`) so both local docs and GitHub Issues stay in sync.

---

## Dependency Graph

```mermaid
flowchart TD
  subgraph Wave1["Wave 1 — Deterministic TDLR Spine (Seam 1)"]
    T2["#2 Monorepo & Single-Filing TDLR Tracer (~350 LOC)"] --> T3["#3 Site Access Guard, PII Redactor & --backfill (~350 LOC)"]
  end

  subgraph Wave2["Wave 2 — Parallel Telemetry & Agent Cores (Seam 2 & 3 Core)"]
    T3 --> T4["#4 Efficiency Ledger & Telemetry API (~300 LOC)"]
    T3 --> T5["#5 Out-of-Band Repair Agent & Replay Gate (~350 LOC)"]
    T3 --> T7["#7 Stateful Painter Agent (gemini-3-pro-image) (~350 LOC)"]
  end

  subgraph Wave3["Wave 3 — Parallel Storybook Widgets (Seam 2 & 3 UI)"]
    T4 --> T6["#6 Repair Changelog API & <GridlockRepairLogWidget /> (~350 LOC)"]
    T5 --> T6
    T7 --> T8["#8 Plate Lineage API & <GridlockPlateWidget /> (~400 LOC)"]
  end

  subgraph Wave4["Wave 4 — Generative UI Workspace (Seam 4 Core & UI)"]
    T6 --> T9["#9 Investigation Planner & POST /api/investigate/plan (~350 LOC)"]
    T8 --> T9
    T9 --> T10["#10 <GridlockConsoleWidget /> & 5 AST Cards (~350 LOC)"]
  end

  subgraph Wave5["Wave 5 — Production Cloud Run & Host Integration"]
    T10 --> T11["#11 [gridlock] Cloud Run, Firestore TTL & GCS Lifecycle (~250 LOC)"]
    T11 --> P1["profile-site#1 Embed Live Gridlock Widgets (~300 LOC)"]
  end
```

---

## Wave-by-Wave Ticket Order

### Wave 1 — Foundation & Deterministic Scraper (Seam 1)

- [ ] **[`gridlock#2`](https://github.com/samasastudio/gridlock/issues/2) — Monorepo & Single-Filing TDLR TABS Tracer Bullet** (`~350 LOC`)
  - **Blocked by**: *None — **Ready to start immediately***
  - **Unlocks**: `#3`
  - **Delivers**: Bootstraps `packages/core` and `packages/widgets`, core `Project` / `Observation` / `SourceArtifact` / `ConnectorConfig` Zod schemas, and a Playwright + `<dl class="dl-horizontal">` parser extracting 1 frozen TDLR filing (`TABS2027003697`), storing a `.gz` SHA-256 **Source Artifact**, and short-circuiting on duplicate hash.

- [ ] **[`gridlock#3`](https://github.com/samasastudio/gridlock/issues/3) — Site Access Guard, Ethical/PII Sanitizers & `--backfill` Discovery (Seam 1)** (`~350 LOC`)
  - **Blocked by**: [`#2`](https://github.com/samasastudio/gridlock/issues/2)
  - **Unlocks**: `#4`, `#5`, `#7` *(3 parallel tracks)*
  - **Delivers**: Adds `POST /TABS/Search/SearchProjects` discovery (`--backfill` + daily weekday mode), `verifySiteAccess` (`blocked_by_waf` vs. `selector_anomaly`, `robots.txt` / `429`), polite single-flight pacing (`GridlockCivicResearchBot/1.0`, `>= 1,500ms`), deterministic PII redaction, and opt-in `LIVE_ACCESS_TEST=1` smoke check.

---

### Wave 2 — Parallel Telemetry & Agentic Cores (Seam 2 & Seam 3 Backend)

*(Once [`#3`](https://github.com/samasastudio/gridlock/issues/3) completes, `#4`, `#5`, and `#7` are all unblocked and can be tackled in any order or in parallel.)*

- [ ] **[`gridlock#4`](https://github.com/samasastudio/gridlock/issues/4) — Efficiency Ledger, Cloud Trace Spans & `GET /api/telemetry/efficiency`** (`~300 LOC`)
  - **Blocked by**: [`#3`](https://github.com/samasastudio/gridlock/issues/3)
  - **Unlocks**: `#6` (alongside `#5`)
  - **Delivers**: Records permanent per-run `telemetry_runs` (`~156 KB/year`) and cumulative `telemetry_summary` (`naiveTokensAvoided`, `execution_mode: "deterministic" | "agentic"` spans) and boots the HTTP service with `GET /api/telemetry/efficiency`.

- [ ] **[`gridlock#5`](https://github.com/samasastudio/gridlock/issues/5) — Out-of-Band Repair Agent & Sandbox Replay Gate (Seam 2 Core)** (`~350 LOC`)
  - **Blocked by**: [`#3`](https://github.com/samasastudio/gridlock/issues/3)
  - **Unlocks**: `#6` (alongside `#4`)
  - **Delivers**: On `selector_anomaly`, invokes `gemini-3.8-flash` (`interactions.create`) to synthesize a candidate `ConnectorConfig` patch, verifies 100% pass rate against historical fixtures + the quarantined artifact in the **Sandbox Replay Gate** (fail-closed), and records `RepairChangelogEntry` (`mttrMs`, `subsequentDeterministicRunsServed`).

- [ ] **[`gridlock#7`](https://github.com/samasastudio/gridlock/issues/7) — Stateful Painter Agent (`gemini-3-pro-image`) & Lineage Chaining (Seam 3 Core)** (`~350 LOC`)
  - **Blocked by**: [`#3`](https://github.com/samasastudio/gridlock/issues/3)
  - **Unlocks**: `#8`
  - **Delivers**: Deterministic milestone gate (`imageGenerationsAvoided`), `bootstrapCanvas`, `paintMilestoneDelta` (`previous_interaction_id` chaining), `.webp` encoding, expired `interaction_id` fallback from cached `.webp` parent buffers, and `branchLineage` watermarked as `"Scenario Branch / Unverified Projection"`.

---

### Wave 3 — Parallel Embeddable Widgets in Storybook (Seam 2 & Seam 3 UI)

- [ ] **[`gridlock#6`](https://github.com/samasastudio/gridlock/issues/6) — `GET /api/repairs/changelog` & `<GridlockRepairLogWidget />` (Seam 2 UI)** (`~350 LOC`)
  - **Blocked by**: [`#4`](https://github.com/samasastudio/gridlock/issues/4), [`#5`](https://github.com/samasastudio/gridlock/issues/5)
  - **Unlocks**: `#9` (alongside `#8`)
  - **Delivers**: Exposes `GET /api/repairs/changelog` (JSON + Markdown) and ships `<GridlockRepairLogWidget />` in `@samasastudio/gridlock-widgets` with Storybook stories displaying selector diffs, MTTR, heal amortization, and the Efficiency Ledger scorecard.

- [ ] **[`gridlock#8`](https://github.com/samasastudio/gridlock/issues/8) — Plate Lineage API & `<GridlockPlateWidget />` Scrubber (Seam 3 UI)** (`~400 LOC`)
  - **Blocked by**: [`#7`](https://github.com/samasastudio/gridlock/issues/7)
  - **Unlocks**: `#9` (alongside `#6`)
  - **Delivers**: Exposes `GET /api/plates/lineage` and `POST /api/plates/branch`, and ships `<GridlockPlateWidget />` in `@samasastudio/gridlock-widgets` with temporal scrubbing across `interaction_id` frames and scenario branch comparison in Storybook.

---

### Wave 4 — Generative UI Workspace (Seam 4 Core & UI)

- [ ] **[`gridlock#9`](https://github.com/samasastudio/gridlock/issues/9) — Investigation Planner (`gemini-3.8-flash`) & `POST /api/investigate/plan` (Seam 4 Core)** (`~350 LOC`)
  - **Blocked by**: [`#6`](https://github.com/samasastudio/gridlock/issues/6), [`#8`](https://github.com/samasastudio/gridlock/issues/8)
  - **Unlocks**: `#10`
  - **Delivers**: Translates natural-language investigative queries and in-place workspace mutations into a Zod-validated `UI AST` restricted to the 5 curated Atlas Dossier components and hydrated strictly with real Firestore records and SHA-256 **Source Artifact** citations.

- [ ] **[`gridlock#10`](https://github.com/samasastudio/gridlock/issues/10) — `<GridlockConsoleWidget />` & 5 Atlas Dossier AST Cards (Seam 4 UI)** (`~350 LOC`)
  - **Blocked by**: [`#9`](https://github.com/samasastudio/gridlock/issues/9)
  - **Unlocks**: `#11`
  - **Delivers**: Ships `<GridlockConsoleWidget />` and its 5 bounded AST components (`ProjectDossierCard`, `VisualPlateScrubber`, `ObservationTimeline`, `MetricComparisonTable`, `ConnectorHealthCard`) in `@samasastudio/gridlock-widgets` with Storybook interaction tests.

---

### Wave 5 — Production Google Cloud Spine & `profile-site` Integration

- [ ] **[`gridlock#11`](https://github.com/samasastudio/gridlock/issues/11) — Cloud Run Job/Service, Firestore TTL & GCS Lifecycle Spine** (`~250 LOC`)
  - **Blocked by**: [`#10`](https://github.com/samasastudio/gridlock/issues/10)
  - **Unlocks**: [`samasastudio/profile-site#1`](https://github.com/samasastudio/profile-site/issues/1)
  - **Delivers**: Containerizes `packages/core` for Cloud Run Job (`0 14 * * 1-5` UTC + `--backfill`) and Cloud Run Service, and codifies the 90-day Firestore TTL on unreferenced `source_artifacts` and GCS lifecycle rules on `/quarantine/` and `/branches/ephemeral/`.

- [ ] **[`profile-site#1`](https://github.com/samasastudio/profile-site/issues/1) — Embed Live Gridlock Widgets in Atlas Dossier & Field Notes** (`~300 LOC`, in `samasastudio/profile-site`)
  - **Blocked by**: [`samasastudio/gridlock#11`](https://github.com/samasastudio/gridlock/issues/11)
  - **Delivers**: Consumes `@samasastudio/gridlock-widgets` in `profile-site`, configures Firebase Hosting `/api/**` rewrites, and replaces static mock data in `/work/gridlock` and Field Notes with the 3 live widgets.

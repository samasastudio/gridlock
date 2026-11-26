# Domain Docs

Single-context layout across all workspaces (`packages/*` share the root `GLOSSARY.md` and `docs/adr/`).

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root.
- **[`docs/adr/`](../adr/)**: read the ADRs (`ADR-0001`–`ADR-0004`) that touch the area you are working in (`0001` topology, `0002` Firestore/GCS spine, `0003` bounded Gemini Interactions API, `0004` Clean Architecture `packages/core` layout).

If an expected file doesn't exist yet, proceed silently rather than flagging its absence upfront; `/domain-modeling` creates or extends domain docs lazily as terms and decisions settle.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, PR body, identifier, comment, or test name), use the canonical term in `GLOSSARY.md` (`npm run lint` blocks `_Avoid_` terms). If a needed concept isn't in `GLOSSARY.md` yet, reconsider inventing a new term or note the gap for `/domain-modeling`.

## Flag ADR conflicts

When a proposed change contradicts `ADR-0001`–`ADR-0004`, surface it explicitly:

> _Contradicts ADR-0002 (Cloud Firestore and Cloud Storage Spine), but worth reopening because…_

## Codebase Module Map

Consult this map before exploring so research and reviews open only the files for the active seam.

- **Public entrypoints**: [`packages/core/src/index.ts`](../../packages/core/src/index.ts) (Composition Root), [`packages/core/src/interfaces/index.ts`](../../packages/core/src/interfaces/index.ts) (`@samasastudio/gridlock-core/schemas`, browser-safe), [`packages/widgets/src/index.ts`](../../packages/widgets/src/index.ts)
- **Shared core contracts & adapters**:
  - Schemas & ports: `packages/core/src/interfaces/` (`primitives.ts`, `constants.ts`, `adapter-contracts.ts`, `filing-models.ts`, `run-record-models.ts`, `repair-models.ts`, `painter-models.ts`, `investigate-ast-models.ts`, `investigate-planner-models.ts`)
  - Adapters: `packages/core/src/adapters/` (`in-memory-repository.ts`, `http-loaders.ts`, `gemini-interactions-client.ts`, `sharp-image-encoder.ts`, `cloud-logging-sink.ts`)
  - HTTP server: `packages/core/src/controllers/` (`http-server.ts`, `http-utils.ts`, plus per-seam route controllers)
- **Seam 1 (TDLR Ingestion, Discovery & Efficiency Scorecard)**:
  - Core: `use-cases/ingest-tdlr-filing.ts`, `run-tdlr-discovery.ts`, `preflight-site-access.ts`, `record-run.ts`, `get-efficiency-scorecard.ts`; `helpers/tdlr-parser.ts`, `tdlr-discovery-filter.ts`, `site-access.ts`, `pii-sanitizer.ts`, `scorecard-math.ts`; `controllers/telemetry-controller.ts`
- **Seam 2 (Out-of-Band Repair Agent & Repair Changelog Widget)**:
  - Core: `use-cases/run-repair-agent.ts`, `get-repair-changelog.ts`; `helpers/sandbox-replay.ts`, `repair-changelog-markdown.ts`; `controllers/repairs-controller.ts`
  - Widgets: `GridlockRepairLogWidget.tsx`, `RepairLogSections.tsx`, `RepairLogTimeline.tsx`, `EfficiencyLineChart.tsx`, `efficiency-chart-series.ts`, `repair-log-client.ts`, `repair-log-styles.ts`
- **Seam 3 (Stateful Painter Agent, Frame Timelines & Scenario Branching)**:
  - Core: `use-cases/run-painter-agent.ts`, `painter-turn-runner.ts`, `get-plate-lineage.ts`, `branch-plate.ts`, `lineage-branch-slots.ts`; `helpers/painter-helpers.ts`, `webp-codec.ts`; `controllers/plates-controller.ts`
  - Widgets: `GridlockPlateWidget.tsx`, `PlateFrameStage.tsx`, `PlateComparisonStage.tsx`, `PlateSummarySection.tsx`, `PlateProvenanceSection.tsx`, `PlateScenarioBranchSection.tsx`, `usePlateBranching.ts`, `plate-lineage-client.ts`, `plate-lineage-model.ts`, `plate-widget-styles.ts`
- **Seam 4 (UI Orchestration Agent & Workspace Layout Cards)**:
  - Core: `use-cases/run-investigation-planner.ts`, `load-investigation-catalog.ts`, `hydrate-investigation-workspace.ts`; `helpers/investigate-planner-catalog.ts`, `investigate-planner-seam-catalog.ts`, `investigate-planner-prompt.ts`, `investigate-hydrator.ts`, `investigate-seam-hydrator.ts`, `investigate-provenance.ts`; `controllers/investigate-controller.ts`
  - Widgets: `ProjectDossierCard.tsx`, `ObservationTimeline.tsx`, `MetricComparisonTable.tsx`, `ast-card-model.ts`, `ast-card-styles.ts`
- **Shared widget primitives & tooling**: `DossierPrimitives.tsx`, `dossier-styles.ts`; `scripts/lint-checks.mjs`, `scripts/type-hygiene.mjs`, `scripts/widget-workbench.mjs`, `scripts/ensure-ext4-deps.sh`

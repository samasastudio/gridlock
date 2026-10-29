# Gridlock

An investigative telemetry and visualization system tracking the physical buildout of compute and electric grid infrastructure across Texas public filings, built on the principle that deterministic code handles routine execution while AI agents operate strictly at uncertainty and synthesis seams.

## Language

### Core Domain & Ingestion

**Gridlock**:
The system as a whole, tracking Texas compute infrastructure, power interconnection bottlenecks, and municipal/state filings across time.
_Avoid_: Compute Atlas

**Project**:
A distinct physical compute or grid infrastructure initiative (such as a hyperscale data center campus, substation upgrade, or generation interconnect) tracked across one or more regulatory filings.
_Avoid_: Site, record, item

**Connector**:
A deterministic ingestion module targeting a specific public regulatory portal (such as TDLR TABS or ERCOT/Austin filings) that captures raw filings and extracts structured records without routine LLM involvement.
_Avoid_: Spider, crawler, LLM scraper

**Source Artifact**:
An immutable, content-addressed (SHA-256) raw file (HTML, PDF, JSON, or spreadsheet) captured from a public agency portal and stored permanently in Cloud Storage as cryptographic proof of what the agency published at that moment.
_Avoid_: Raw payload, cached page, scrape dump

**Observation**:
An append-only, timestamped fact recorded in Firestore from a Source Artifact about a Project at a point in time, preserving full historical state rather than overwriting prior records.
_Avoid_: Record update, mutable row

**Repair Agent**:
An out-of-band agent invoked only when a Connector fails an extraction or schema invariant; it inspects the quarantined Source Artifact, proposes a deterministic selector or parser patch, and verifies it against historical fixtures before promotion.
_Avoid_: Live LLM parser, auto-committer

**Repair Changelog**:
An append-only chronological log of verified self-healing events recording the broken invariant, the before/after selector diff, the agent's root-cause summary, and fixture replay verification results for display in project logs and Field Notes.
_Avoid_: Error log, stack trace dump

### Stateful Visual Synthesis

**Stateful Painter Agent**:
A deep agentic module using the Gemini Interactions API (`previous_interaction_id`) to evolve a Visual Plate across time by painting only incremental deltas triggered by new Observations rather than regenerating images from scratch.
_Avoid_: Stateless image generator, tile server

**Visual Plate**:
A cached `.webp` archival technical illustration stored in Cloud Storage representing the state of the regional corridor or a Project at a specific point in a Lineage, linked to the exact `interaction_id` that produced it.
_Avoid_: Slippy map tile, raw render

**Lineage**:
A directed chain (or branched tree) of Visual Plates connected via `previous_interaction_id`, allowing temporal scrubbing across historical milestones or branching into "what-if" scenarios from any prior frame.
_Avoid_: Image gallery, chat history

### Generative UI Workspace

**UI AST**:
A strongly-typed, Zod-validated JSON tree emitted by the Investigation Planner that specifies which curated Atlas Dossier React components to render and what Firestore data props hydrate them.
_Avoid_: Generated JSX, raw HTML response, chat transcript

### Observability & Efficiency Telemetry

**Efficiency Ledger**:
A cumulative telemetry record tracking deterministic execution rates, counterfactual LLM tokens avoided (`naiveTokensAvoided`), autonomous repair MTTR (`mttrMs`), and heal amortization (`subsequentDeterministicRunsServed`) to empirically quantify how deterministic gates reduce AI token consumption.
_Avoid_: Raw log dump, vanity metrics

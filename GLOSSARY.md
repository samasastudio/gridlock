# Gridlock

An investigative publishing and visualization system tracking the physical buildout of compute and electric grid infrastructure across Texas public filings, built on the principle that deterministic code handles routine execution while AI agents operate strictly at uncertainty and synthesis seams.

## Language

### Core Domain & Ingestion

**Gridlock**:
The system as a whole, tracking Texas compute infrastructure, power interconnection bottlenecks, and municipal or state filings across time.
_Avoid_: Compute Atlas

**Project**:
A distinct physical compute or grid infrastructure initiative (such as a data center campus, substation upgrade, or generation interconnect) tracked across one or more public filings.
_Avoid_: Site, record, item

**Connector**:
A deterministic ingestion module targeting a specific public agency portal that captures raw files and extracts structured records.
_Avoid_: Spider, crawler, LLM scraper

**Raw Capture**:
An immutable, untouched file (HTML, PDF, JSON, or spreadsheet) saved directly from a public agency portal as proof of what the agency published at that moment.
_Avoid_: Source Artifact, raw payload, cached page, scrape dump

**Observation**:
An append-only, timestamped fact extracted from a Raw Capture about a Project at a point in time, preserving full historical state rather than overwriting prior records.
_Avoid_: Record update, mutable row

**Repair Agent**:
An out-of-band agent invoked only when a Connector fails an extraction or schema check; it inspects the quarantined Raw Capture, proposes a deterministic parser patch, and verifies it against historical fixtures before promotion.
_Avoid_: Live LLM parser, auto-committer

**Repair Changelog**:
An append-only chronological log of verified self-healing events recording what broke, the before-and-after parser diff, the agent's root-cause summary, and replay verification results.
_Avoid_: Error log, stack trace dump

### Visual Synthesis

**Stateful Painter Agent**:
An agent that evolves a Generated Illustration across time by painting only incremental changes triggered by new Observations rather than regenerating images from scratch.
_Avoid_: Stateless image generator, tile server

**Generated Illustration**:
An archival illustration representing the state of a regional corridor or a Project at a specific point in a Frame Timeline.
_Avoid_: Visual Plate, slippy map tile, raw render

**Frame Timeline**:
An ordered timeline of Generated Illustrations showing how a corridor or Project changes across historical milestones, plus optional Scenario Branches forked from any prior frame.
_Avoid_: Lineage, image gallery, chat history

**Scenario Branch**:
A speculative, watermarked Generated Illustration forked from an existing frame on a Frame Timeline to explore a reader's what-if prompt, clearly labeled as unverified and kept separate from verified historical frames.
_Avoid_: Canonical frame, verified projection

### Investigation Workspace

**UI Orchestration Agent**:
An agent that turns a reader's natural-language question into a validated Workspace Layout grounded strictly in verified records.
_Avoid_: Investigation Planner, chatbot, freeform LLM writer

**Workspace Layout**:
A structured specification emitted by the UI Orchestration Agent that defines which curated dossier cards to display for an investigation and which verified records populate them.
_Avoid_: UI AST, generated JSX, raw HTML response, chat transcript

### Run History & Savings

**Run Record**:
An immutable record of a single pipeline execution capturing whether deterministic code or an AI agent handled it, how long it took, and how many tokens were used or avoided.
_Avoid_: Telemetry run, telemetry

**Efficiency Scorecard**:
A cumulative summary tracking how often deterministic code handled runs versus AI agents, how many tokens and costs were avoided, and how quickly repairs paid for themselves.
_Avoid_: Efficiency Ledger, telemetry summary, raw log dump, vanity metrics

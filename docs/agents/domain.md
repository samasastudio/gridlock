# Domain Docs

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root.
- **[`docs/adr/`](../adr/)**: read the ADRs (`ADR-0001`–`ADR-0004`) that touch the area you are working in (`0001` topology, `0002` Firestore/GCS spine, `0003` bounded Gemini Interactions API, `0004` Clean Architecture `packages/core` layout).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, PR body, identifier, comment, or test name), use the canonical term in `GLOSSARY.md` (`npm run lint` blocks `_Avoid_` terms).

## Flag ADR conflicts

When a proposed change contradicts `ADR-0001`–`ADR-0004`, surface it explicitly:

> _Contradicts ADR-0002 (Cloud Firestore and Cloud Storage Spine), but worth reopening because…_

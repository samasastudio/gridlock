# Domain Docs

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root.
- **[`docs/adr/`](../adr/)**: read the ADRs that touch the area you are working in (`0001` topology, `0002` Firestore/GCS spine, `0003` bounded Gemini Interactions API).

## File structure

```text
/
├── GLOSSARY.md
├── CODING_STANDARDS.md
├── ROADMAP.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── connectors/
└── packages/
    ├── core/
    └── widgets/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, PR body, identifier, comment, or test name), use the canonical term in `GLOSSARY.md`. Never use phrases listed under `_Avoid_` (enforced mechanically by `npm run lint`).

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, surface it explicitly:

> _Contradicts ADR-0002 (Cloud Firestore and Cloud Storage Spine), but worth reopening because…_

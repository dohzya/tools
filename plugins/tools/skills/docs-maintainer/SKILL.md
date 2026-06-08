---
name: docs-maintainer
description: Maintain and review project documentation under docs/. Use when creating, updating, organizing, or reviewing project docs, documentation taxonomy, AGENTS.md docs recaps, runbooks, technical docs, functional docs, postmortems, references, or durable review reports. Generated documentation is English by default unless the user explicitly requests another language.
---

# Docs Maintainer

Maintain project documentation as durable, source-verified knowledge.

## Core Rules

- Write generated documentation in English by default. Use another language only when the user explicitly asks.
- Keep identifiers, file names, environment variables, API paths, class names, command names, enum values, and flags exactly as they appear in the source material.
- Treat source material as authoritative. Verify behavior against code, tests, configuration, manifests, tickets, transcripts, logs, or other primary evidence before documenting it.
- Do not include secrets, tokens, raw PII, sensitive result excerpts, or private operational details in examples.
- Durable knowledge belongs in a maintained documentation file. Temporary investigation notes should be deleted or promoted before the task is closed.
- Existing projects may contain older files that do not follow this method. Do not churn them only for style; apply this method when creating new documentation or substantially updating existing documentation.

## Docs Recap In AGENTS.md

For documentation work in a project, inspect `AGENTS.md` when it exists.

- If `AGENTS.md` already contains a short recap of the `docs/*` directory taxonomy, leave it alone unless the taxonomy changed.
- If the recap is missing or stale, tell the user and propose adding or updating it.
- Do not list every documentation file in `AGENTS.md`; keep only the directory-level purpose recap.

Use [references/docs-taxonomy.md](references/docs-taxonomy.md) for the canonical directory taxonomy and recap text.

## Choose The Task

- For creating or updating documentation, read [references/writing.md](references/writing.md).
- For reviewing existing documentation, read [references/review.md](references/review.md).
- For directory placement, metadata, naming, and AGENTS recap wording, read [references/docs-taxonomy.md](references/docs-taxonomy.md).

## Common Metadata

Maintained Markdown files should start with YAML metadata:

```yaml
---
category: technical
themes:
  - architecture
  - api
verified_at: 2026-06-08
source_ref: 3a36d9cb
language: en-US
---
```

Use:

- `category`: logical category, usually matching the directory.
- `themes`: short, stable tags in English.
- `verified_at`: ISO 8601 date when the document was last checked against its sources.
- `source_ref`: commit, ticket, release, transcript, log bundle, or other source reference used for verification.
- `language`: `en-US` by default; use another language tag only when explicitly requested.
- `directives`: optional style or form instructions. Do not store domain data in directives; fetch values from source material.

## Format Rules

- Use one `#` heading per file.
- Use short descriptive headings.
- Use tables for mappings, matrices, variables, endpoints, states, and option sets.
- Use numbered lists for procedures.
- Use code blocks only for commands, verified source excerpts, or explicitly illustrative examples.
- Prefer relative links when the target will travel with the documentation set.
- Keep long documents navigable. Above roughly 500 lines, consider splitting by theme, audience, or workflow.

When an example is simplified, label it as illustrative. When an example is copied from source material, state that it is verbatim and include the source reference.

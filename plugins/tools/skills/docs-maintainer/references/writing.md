# Documentation Writing

## Maintenance Workflow

1. Identify the theme, audience, and target directory.
2. Read the existing documentation for that theme.
3. Verify the current source material.
4. Update the closest existing document, or create a new one if the topic is not covered.
5. Avoid duplicating content that already has a clear home.
6. Update metadata: `verified_at`, `themes`, `language`, and `directives` when needed.
7. Validate links, examples, commands, and terminology touched by the change.
8. Check whether the `docs/*` recap in `AGENTS.md` is present and current. Propose adding or updating it if it is missing or stale.

When existing metadata is stale, do not rewrite the document mechanically. First verify whether the source material it documents has actually changed.

## What To Include

Each maintained page should make clear:

- the question or context it addresses;
- the rules, behavior, decisions, or steps;
- known limits and edge cases;
- primary evidence or source references;
- validation commands or verification signals when relevant.

For environment variables, document:

- exact name;
- purpose;
- default value, if any;
- required or optional status;
- affected environments;
- secret or sensitivity constraints.

For APIs, state keys, schemas, enum values, modes, providers, options, or command flags, list all known values or clearly state that the document covers a subset.

## What Not To Include

Do not document:

- obvious implementation details that code expresses clearly;
- internal helpers whose name and type are enough;
- unstable experimental code unless explicitly requested;
- comments that merely restate code;
- sensitive raw data, secrets, tokens, or private identifiers.

## Maintenance Checklist

Before considering a documentation change complete, verify:

- language metadata is present and correct;
- non-English language checks were run when the project requires them;
- the directory and `category` agree;
- exploration notes that became stable decisions or behavior were promoted into functional, technical, or operations docs;
- terminology matches the source material;
- option sets, enums, modes, providers, and state keys are exhaustive or explicitly partial;
- examples are marked as verbatim or illustrative;
- relative links and source references resolve;
- procedures include verification signals;
- compliance and privacy constraints are respected.

Do not add `source_ref` metadata to versioned documentation. Use body text for source references when the evidence matters.

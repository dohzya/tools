---
category: technical
themes:
  - architecture
  - parsing
  - cli
  - extension
  - data-model
verified_at: 2026-07-03
source_ref: "packages/tools/dz-review/*.ts; imported dz-md-review-syntax source snapshot on 2026-06-18"
language: en-US
---

# DZ Review Architecture

`dz-review` is being migrated into `dz-tools` from the previous standalone `dz-md-review-syntax` workspace. The target split is:

| Area              | Target path                                      | Responsibility                                                                                                |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Deno engine       | `packages/tools/dz-review/review-core.ts`        | Parse review conversations and annotations, compute statuses, apply text edits, and map Git diff added lines. |
| Timestamp codec   | `packages/tools/dz-review/timestamp.ts`          | Encode and decode ISO and compact review timestamps.                                                          |
| Deno CLI          | `packages/tools/dz-review/cli.ts`                | Expose `dz-review` commands, compatibility aliases, completions, and shared agent instructions.               |
| Agent skill       | `plugins/tools/skills/markdown-review-workflow/` | Tell agents how to write, answer, preserve, and clean Markdown review threads.                                |
| VS Code extension | `packages/vscode/dz-review/`                     | Provide TextMate injections, commands, keybindings, decorations, and a review panel.                          |

## Deno Port

The source CLI was written for Node and compiled from `src/dz-review.ts`. The integrated `dz-tools` CLI must follow the repository conventions instead:

- Deno modules with explicit `.ts` imports.
- Shared shell conventions such as `-C/--cwd`, completions, and `agent-instructions`.
- Shared `agent-instructions` integration.
- Tests under `packages/tools/dz-review/*.test.ts`.
- Exports through `packages/tools/deno.json`.

The current CLI uses Cliffy for command dispatch, aliases, structured help, and generated completions. It still rebuilds a legacy-style argv and delegates to the standalone parser internally so the port can keep behavior parity while the engine and compatibility tests stabilize.

The migrated engine is deliberately independent from VS Code. It uses a small review-markup parser rather than a Markdown AST because review annotations are non-nested, local text markers.

## Parser Model

`collectConversations()` discovers active conversations in HTML comments and compact `{?? ??}` blocks when they contain role markers. `collectReviewAnnotations()` discovers conversations plus CriticMarkup-style additions, deletions, substitutions, highlights, comments, and discussions.

Every item records raw text, character offsets, and line numbers. Text edits use offsets; display and Git diff filtering use line numbers.

## CLI State

The integrated CLI now covers the legacy command surface plus the standard dz-tools shell surface:

- `dz-review review` / `dz-review r`
- `dz-review review --git`, `--diff`, `--list`, `--context`, `--context-before`, and `--context-after`
- `dz-review status` / `dz-review st`
- `dz-review status --oneline`, `--short`, and `--recap`
- `dz-review list` / `dz-review l` / `dz-review ls`
- `dz-review me review`, `dz-review me list`, `dz-review me diff`, and `dz-review me status`
- `dz-review diff` / `dz-review d`
- `dz-review ref check`, `dz-review ref list`, `dz-review ref show`, and `dz-review ref snapshots`, including snapshot line limits and `ref snapshots --ref`
- conversation filters such as `--conversation`, `--conversations`, `--pending`, `--pending-conversations`, and `--ignore-closed-conversations`
- `dz-review timestamp` / `dz-review ts` / `dz-review timestamps`, including `--stdin`, `--stdout`, `--inline`, `--output`, `--compact`, and `--iso`
- `dz-review now`, including `--compact`, `--iso`, and `--date`
- `dz-review session start`, `dz-review session status`, `dz-review session active`, `dz-review session add-file`, `dz-review session done`, and `dz-review session rollback`, including `--json`
- `dz-review agent status`, `dz-review agent list`, `dz-review agent inbox`, `dz-review agent show`, `dz-review agent respond`, `dz-review agent apply`, `dz-review agent clean`, and `dz-review agent diff`
- `dz-review -C <dir>` / `dz-review --cwd <dir>`
- `dz-review --state-dir <dir>` / `DZ_REVIEW_STATE_DIR`
- `dz-review --ignore-file <file>` / `DZ_REVIEW_IGNORE_FILE`
- `dz-review agent-instructions`
- `dz-review completions`
- `dz-review stats` as a migration error

The port includes Git diff filtering, configurable review ignore files, color handling, `--since`, timestamp conversion, interactive edit actions, passage-reference inspection, and the session start/status/done workflow. `session start`, `agent status`, `me status`, and `session done` reuse the same review item parser and timestamp conversion logic as status/list/review, then persist or read `agent-session.json` under the configured state directory with stable item IDs and per-file timestamp formats. Passage references use the shared ref parser for CLI validation, `ref list` pager-aware display, `ref show` snapshot expansion, and VS Code hover/definition support. The functional target is to align `dz-review` passage and review references with the shared Markdown Fragment Reference contract in [`../../../../docs/functional/markdown-fragment-references.md`](../../../../docs/functional/markdown-fragment-references.md): `^<anchor>` keeps the same Markdown anchor semantics as `md`, and `~<mrfi>` should become an opaque MRFI locator rather than a separate review-only ID format. By default, that state directory is `.dz-review` at the Git root when a worktree exists; explicit `--state-dir` / `DZ_REVIEW_STATE_DIR` values remain cwd-relative unless absolute. Human `status` output reports whether that snapshot exists; `session active` exposes only the compact active-session marker for integrations. Commands with no file arguments resolve files from the active agent session first, then from `git status` when running inside a Git worktree. Runtime path configuration is shared through `dz-review/runtime-config.ts`; CLI options take precedence over environment variables and are resolved after `-C` changes the working directory.

The V1 agent session model deliberately assumes one active agent session per configured state directory. A job-based model could support concurrent agents with separate job ids and transaction-like reconciliation, but it would require agents to route edits through `dz-review` instead of editing Markdown directly. Keep that as a future design study rather than part of this initial CLI workflow.

Reference snapshots of the standalone source live in [`../refs/dz-review-migration/README.md`](../refs/dz-review-migration/README.md) so the previous standalone workspace can be deleted without losing provenance.

## Reference Locator Port

`dz-review` depends on markdown-surgeon's MRFI (Markdown Fragment Reference) use-cases as a library rather than by shelling out to the `md` CLI, through its first `domain/`+`adapters/` layering:

- `packages/tools/dz-review/domain/ports/reference-locator.ts` defines the `ReferenceLocatorService` port: `generateReference(doc, range, options)`, `resolveReference(doc, ref, witness?)`, and `refreshReference(doc, ref, format, profile)`. It re-exports the `Document`, `SourceRange`, `MrfiFormat`, `MrfiProfile`, `ResolveResult`, and `RefreshReferenceOutput` types from markdown-surgeon's domain entities rather than importing anything from a use-case file, keeping the ports-import-entities-only rule intact.
- `packages/tools/dz-review/adapters/markdown/mrfi-adapter.ts` (`MrfiAdapter`) implements the port by calling markdown-surgeon's `GenerateReferenceUseCase`, `ResolveReferenceUseCase`, and `RefreshReferenceUseCase` directly. Unlike worklog's `MarkdownSurgeonAdapter` (which needs `HashService`/`YamlService` injected), `MrfiAdapter` takes no constructor dependencies: MRFI's own hashing (`smh64` / SHA-256 fragment signals) runs directly through `crypto.subtle`, not an injected port.

The port is deliberately narrower than markdown-surgeon's own `GenerateReferenceUseCase`, which also supports generating a reference for a whole _section_. Adding that variant here would require importing `Section` from markdown-surgeon's use-case layer into a port, which is a real ports-import-entities-only violation, not just a style preference. `dz-review`'s own annotations always locate a concrete text range, never "the whole section", so `generateReference` only accepts a `SourceRange`; the adapter wraps it as `{ kind: "range", range }` before calling the underlying use case. This is also unrelated to `ReferenceTarget` in `ref-core.ts`, which is `dz-review`'s own parsed representation of the review-comment reference syntax (`ref:`, `<!-- ref ... -->`); the port only wraps markdown-surgeon's lower-level MRFI locator engine.

`packages/tools/dz-review/reference-map.ts` is the only current consumer of this port (see below).

## Persistent Review Item Ids

Review item ids (the `rvw_...` ids used in `agent respond <id>`, `agent show <id>`, etc.) used to be a pure hash of `(file, kind, anchor)`, recomputed from scratch on every command (`stable-review-id.ts`, still in place and used as described below). That scheme meant any edit to an untimestamped annotation's own text — or any edit at all before its first timestamp — silently produced a different id, breaking anything that referenced the id across time.

`packages/tools/dz-review/reference-map.ts` fixes this by minting an id once and persisting it durably in `<state-dir>/reference-map.json` (the same directory as `agent-session.json`; `.dz-review/` at the Git root by default), mapping `id -> { file, range, mrfi }`.

### On-disk schema

```json
{
  "version": 1,
  "entries": {
    "rvw_AbC123": {
      "file": "docs/example.md",
      "range": { "startLine": 12, "endLine": 14 },
      "mrfi": "~{v0;...}"
    }
  }
}
```

- `version` is `1` today (`REFERENCE_MAP_VERSION`).
- `entries` maps a full id to a `ReferenceMapEntry`: the normalized file path (`\` converted to `/`), the last-known `{startLine, endLine}`, and the MRFI reference (default `debug` format, `default` profile) generated for that range at the time it was last confirmed.
- Entries do **not** store the annotation's raw text. That is a deliberate consequence of the algorithm below, not an oversight: the fast path only ever needs range equality, and the fallback path resolves the stored MRFI, not a text hash.

### Id assignment: three passes

`assignPersistentReviewItemIds(file, content, items, options?)` looks up or mints an id for every item, cheapest path first:

1. **Fast path — exact range match.** For each item, look for an existing entry (scoped to this file) whose `{startLine, endLine}` equals the item's current range. If found, adopt its id without resolving anything — no document parsing, no port calls. This is a plain dictionary lookup, not a content-hash comparison: persisted entries carry no raw anchor text to rehash and compare, and range equality is the cheapest signal that is still sound (lines above the item did not shift). If _every_ item fast-matches, the function returns immediately without parsing the document, calling the locator, or rewriting the (unchanged) map file.
2. **Fallback — resolve remaining stored entries against the current document.** For items that did not fast-match, take the remaining unconsumed entries for this file, rank their stored MRFIs by `RankReferenceCandidatesUseCase` (a deliberate seam: today it is a no-op identity function that returns candidates unchanged; ranking by textual/structural proximity is explicit future work, not implemented), then resolve each ranked candidate's MRFI against the current document in order. Adopt the first resolution whose status is `exact` or `confident` and whose resolved range overlaps the item's current lines. On adoption, regenerate the entry's `{range, mrfi}` directly from the range already resolved in this step — deliberately not via `refreshReference`, which would resolve the same reference a second time internally.
3. **Mint — nothing matched.** Any item still unresolved after passes 1–2 gets a fresh id, minted in one batch via `stable-review-id.ts`'s `assignStableReviewItemIds` (its hash+encode pipeline is reused only as a one-time seed value for the new id, and its same-key occurrence disambiguation still applies across items minted together in the same call). A new entry (`{file, range, mrfi}`) is recorded for it.

The map is read once and written once per call (skipped entirely when every item fast-matches). All async work — parsing the document, resolving candidate MRFIs — happens only for items that miss the fast path, which is why `assignPersistentReviewItemIds` and its callers are `async`.

### Wiring

`agent-core.ts` and `cli.ts` call `assignPersistentReviewItemIds` at four id-assignment sites: `collectAgentReviewState`, `collectLocatedReviewItems`, `collectAgentGuardrailFailures`, and `targetReviewIdExists`. Making id assignment asynchronous (document parse + awaited MRFI resolution on the fallback path) required those functions and their callers to become `async` up to the CLI action boundary — `agent start`/`add-file`/`status`/`done`/`list`/`show`/`respond`/`apply`/`clean`/`diff`, `me status`, and `ref check` are all `async` as a result. `rollbackAgentSession` stayed synchronous because it restores files from the session snapshot and closes the session without assigning or looking up any id.

`stable-review-id.ts` was **not** deleted: it still supplies the seed hash for freshly minted ids (pass 3) and is still directly tested and used on its own terms.

### Design decisions

**Augmented the existing id instead of using the MRFI as the id.** The short id (`rvw_xxx`) stays the identity; the MRFI is stored as fallback re-location evidence, not as the id itself. Making the MRFI the id would have broken the human-typeable short id used in CLI prefix matching, the pinned id-shape regex tests, the on-disk session-snapshot join (`agent-session.json`), and the external VS Code extension's round-trip. Augmenting gets the same robustness against line moves and text edits with far smaller blast radius.

**Did not embed `_kind`/`_file` as MRFI extension fields.** Markdown-surgeon's MRFI codec supports round-tripping unrecognized private extension fields (e.g. a consumer-named `_kind` field) through its base62/Hangul compact form without `md` interpreting them (see [`architecture.md`](./architecture.md)). `dz-review` does not use this for review items: the review-item record already carries `file` and `kind` as plain first-class fields separately from the locator, so embedding them in the MRFI itself would be redundant here. That mechanism may still matter for a future _external/standalone_ reference use case; it was not needed for this internal id-comparison use case.

**No migration path for in-flight sessions.** `reference-map.json` starts empty on first use after upgrading, so every review item gets a freshly minted id on first contact post-upgrade. This is a one-time accepted cost, not a bug: there is no reliable way to reconstruct a `stable-review-id.ts`-era id's original range from the id alone.

### Known limits

- The fallback path (pass 2) only recovers an existing id when the stored MRFI resolves to `exact` or `confident` with an overlapping range; a `fuzzy`/`ambiguous`/`not-found` resolution falls through to minting a new id, same as if nothing had been stored.
- `RankReferenceCandidatesUseCase` does not yet rank by proximity; with more than one plausible candidate entry for a file, the fallback tries them in whatever order they come back from the map, not closest-match-first.
- The VS Code extension (`packages/vscode/dz-review/src/extension.ts`) still imports `stable-review-id.ts` directly and has not been migrated to `reference-map.ts`; that migration is a separate, not-yet-landed piece of work.

## VS Code Extension Packaging

The VS Code extension should stay separate from `packages/tools/` because it is a Node/VSC package with `package.json`, `tsconfig.json`, TextMate grammars, VS Code activation events, and VSIX packaging. A monorepo path such as `packages/vscode/dz-review/` keeps it installable without mixing Node extension build output into the Deno JSR package.

The source extension already has useful behavior to preserve:

- Markdown grammar injections instead of a custom language mode.
- Runtime decorations for `@agent`, `@me`, bare `@`, timestamps, and `ok`.
- Review commands and modal review mode.
- A review panel with status filters.
- Tests around extension command behavior.

The repo tasks are:

```bash
task vscode:dz-review:test
task vscode:dz-review:vsix
task vscode:dz-review:install
```

`task vscode:dz-review:install` builds the VSIX and installs it with `code --install-extension`.

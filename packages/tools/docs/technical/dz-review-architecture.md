---
category: technical
themes:
  - architecture
  - parsing
  - cli
  - extension
verified_at: 2026-06-18
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

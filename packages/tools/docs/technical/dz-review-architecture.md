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

The current CLI keeps the standalone parser for behavior parity with the old tool. Cliffy is already used by the repo and supports `.alias(...)`; a future cleanup can migrate the dispatch layer to Cliffy for more standard help and generated completions once compatibility tests are broad enough.

The migrated engine is deliberately independent from VS Code. It uses a small review-markup parser rather than a Markdown AST because review annotations are non-nested, local text markers.

## Parser Model

`collectConversations()` discovers active conversations in HTML comments and compact `{?? ??}` blocks when they contain role markers. `collectReviewAnnotations()` discovers conversations plus CriticMarkup-style additions, deletions, substitutions, highlights, comments, and discussions.

Every item records raw text, character offsets, and line numbers. Text edits use offsets; display and Git diff filtering use line numbers.

## CLI State

The integrated CLI now covers the legacy command surface plus the standard dz-tools shell surface:

- `dz-review review` / `dz-review r`
- `dz-review status` / `dz-review st`
- `dz-review status --oneline`, `--short`, and `--recap`
- `dz-review list` / `dz-review l` / `dz-review ls`
- `dz-review diff` / `dz-review d`
- `dz-review timestamp` / `dz-review ts` / `dz-review timestamps`
- `dz-review now`
- `dz-review -C <dir>` / `dz-review --cwd <dir>`
- `dz-review agent-instructions`
- `dz-review completions`
- `dz-review stats` as a migration error

The port includes Git diff filtering, `.dz-review-ignore`, color handling, `--since`, timestamp conversion, and interactive edit actions. Reference snapshots of the standalone source live in [`../refs/dz-review-migration/README.md`](../refs/dz-review-migration/README.md) so the previous standalone workspace can be deleted without losing provenance.

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

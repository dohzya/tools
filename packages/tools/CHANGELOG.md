# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [wl-v0.12.0] — 2026-02-27

### Added

- **worklog:** `wl checkpoint --claude [<id>]` — delegates checkpoint synthesis to Claude via `claude -p`; injects the task context prompt automatically and supports `WORKLOG_TASK_ID` env fallback
- **worklog:** `-q` / `--quiet` flag on `wl checkpoint` and `wl show` — silently exits (no error) when no task ID is provided or set via env; designed for Claude Code hooks where no active task should not be an error
- **worklog:** `wl checkpoint` arguments are now optional when `--claude` is used; `changes` and `learnings` are still required for the standard (non-Claude) path

### Claude Code Hooks (recommended config)

```json
"PreCompact":  [{"type": "command", "command": "wl checkpoint --claude -q"}],
"PostCompact": [{"type": "command", "command": "wl show -q"}]
```

## [wl-v0.11.0] — 2026-02-26

### Added

- **worklog:** `--claude` flag on `wl create` — launches Claude immediately after task creation with `WORKLOG_TASK_ID` set; supports passthrough args via `--` (e.g. `wl create --claude "task" -- --model opus`)
- **worklog:** `wl start` now reopens `cancelled` tasks (in addition to `done`), returning a "task reopened" status; tracing on closed tasks suggests `wl start <id>` before `--force`

## [wl-v0.10.0] — 2026-02-25

### Added

- **worklog:** `assign-by-tag` command — assign all tasks with a given tag to a scope

## [wl-v0.9.2] — 2026-02-24

### Fixed

- **worklog:** `wl scopes add` / `add-parent` are now idempotent when re-run with identical config

## [wl-v0.9.1] — 2026-02-23

### Added

- **worklog:** `--allow-missing` flag on `wl import` — skip missing worktrees instead of erroring

## [wl-v0.9.0] — 2026-02-20

### Added

- **worklog:** Parent/child subtask support via `--parent <id>` on `wl create`
  - `wl list` hides subtasks by default; `--subtasks` shows them indented; `--parent <id>` shows only children flat
  - `wl show` displays parent link and subtask section
- **worklog:** `wl tags add`, `tags remove`, `tags rename` subcommands for tag management
- **worklog:** `--name` and `--desc` options on `wl start`
- **both:** Shell completions for `wl` and `md` (bash, zsh, fish)

## [wl-v0.8.1] — 2026-02-19

### Changed

- **worklog:** Binary-only release — add `--allow-run=claude` permission to compiled binary

## [wl-v0.8.0 / md-v0.7.0] — 2026-02-18

### Added

- **worklog:** `WORKLOG_TASK_ID` env var — set automatically by `wl run` and `wl claude` commands for context propagation to child processes
- **worklog:** Cross-scope task resolution — action commands resolve tasks across all scopes

### Fixed

- **worklog:** Handle markdown headers in checkpoint content
- **worklog:** Handle external worktrees in `import --scope-to-tag`

### Changed

- **both:** Migrated to hexagonal architecture (domain / ports / adapters layers)

## [wl-v0.7.0 / md-v0.6.0] — 2026-02-10

### Added

- **worklog:** Hierarchical tag system for flexible task organization
- **worklog:** `-C` / `--worklog-dir` global options for remote operation on a worklog directory
- **worklog:** Task lifecycle states: `created` → `ready` → `started` → `done` / `cancelled`
  - New `wl cancel` command to abandon tasks
- **worklog:** `-t` / `--timestamp` option on `wl add`
- **worklog:** Display help when invoked with no arguments
- **markdown-surgeon:** Occurrence counts alongside aggregated values; new `--count` option for `md meta`

### Changed

- **worklog:** Restructured CLI commands; `wl show` now displays TODOs; improved help text

## [wl-v0.6.0 / md-v0.5.0] — 2026-02-04

### Added

- **worklog:** UUID base36 ID system with git-style prefix resolution
  - Replaces date-based IDs with UUID base36 (25 chars, case-insensitive)
  - Displays short IDs (5+ chars minimum)
  - Resolves any unambiguous prefix (e.g., `acjold`, `acjo`, `ac`)
  - Backward compatible with existing date-based IDs
- **worklog:** Task metadata management via `wl meta` command
  - View: `wl meta <id>` / Set: `wl meta <id> <key> <value>` / Delete: `wl meta <id> --delete <key>`
  - Stored in task frontmatter for traceability (commit SHA, PR, etc.)
- **worklog:** TODO management system for tracking action items within tasks
  - Commands: `wl todo list`, `wl todo add`, `wl todo set`, `wl todo next`
  - 5 statuses: todo, wip, blocked, cancelled, done
  - Create tasks with initial TODOs via `wl add --todo "text"`
  - Unique 7-char base62 IDs with Obsidian-compatible block references
  - `wl done` blocks if pending TODOs exist (`--force` to override)
- **worklog:** Git worktree support for scopes
- **markdown-surgeon:** Multi-file metadata aggregation via `md meta` command
  - `--list` (with duplicates) or `--aggregate` (unique values)
  - Multi-field, glob pattern, and JSON output support
  - Nested field access: `md meta --aggregate meta.tags file1.md`

### Changed

- **both:** Migrated CLI argument parsing to Cliffy (`@cliffy/command`) — auto-generated help, type-safe options, better error messages
- **BREAKING (markdown-surgeon):** `md concat --shift` now requires an explicit value
  - Before: `md concat --shift file1.md file2.md` (implicit 1)
  - After: `md concat --shift 1 file1.md file2.md`

## [md-v0.5.1] — 2026-02-04

### Changed

- Configure deno formatter; apply formatting fixes (no functional changes)

## [wl-v0.5.0] — 2026-01-30

### Added

- **worklog:** `wl scopes add` and `wl scopes add-parent` subcommands for scope management
- GitHub Actions workflow for bundle releases

## [wl-v0.4.4] — 2026-01-30

### Changed

- Move mise backend to dedicated repository (`dohzya/mise-tools`)

### Fixed

- **worklog:** Add `--allow-env` permission to compiled binaries

## [wl-v0.4.3] — 2026-01-28

### Added

- **worklog:** Scope subcommands — refactored CLI for scope management (`wl scope <sub>`)

### Fixed

- **worklog:** Resolve permission regression introduced in v0.4.2

## [wl-v0.4.2] — 2026-01-23

### Fixed

- **worklog:** Support `-p PATH` option in `wl list` command

## [wl-v0.4.1] — 2026-01-23

### Added

- **both:** `-v` / `--version` flag for `wl` and `md`

### Fixed

- **worklog:** Preserve timezone offset in custom timestamps

## [wl-v0.4.0 / md-v0.4.0] — 2026-01-22

### Added

- **worklog:** Import functionality for cross-worktree task consolidation (`wl import`)
- **worklog:** Flexible timestamp support for `wl trace` via `--timestamp` / `-t`
  - Format: `[YYYY-MM-DD]THH:mm[:SS][<tz>]`
  - Auto-fills missing components (date → today, seconds → :00, timezone → local)
  - Enables preservation of original timestamps when importing historical entries
- CI: GitHub Actions workflow for automated testing
- Distribution infrastructure: Homebrew formulas, compiled binaries for macOS/Linux

## [0.3.0] — 2026-01-20

### Changed

- **BREAKING:** Renamed `worktrack` module to `worklog` to avoid CLI name collision with worktrunk
  - Module exports: `worktrack/*` → `worklog/*`
  - CLI executable: `wt` → `wl`
  - Working directory: `.worktrack/` → `.worklog/`

## [0.2.0] — 2026-01-20

### Added

- **worktrack** module for append-only work logging with checkpoint snapshots
  - `worktrack/mod.ts` — Core functionality for tracking work progress
  - `worktrack/types.ts` — Type definitions
  - `worktrack/cli.ts` — CLI interface (`wt` command)

## [0.1.0] — 2026-01-20

### Added

- Initial release
- **markdown-surgeon** module for surgical manipulation of Markdown files
  - `markdown-surgeon/parser.ts` — Parse and serialize Markdown documents with section IDs
  - `markdown-surgeon/hash.ts` — Generate stable section identifiers
  - `markdown-surgeon/yaml.ts` — Handle YAML frontmatter
  - `markdown-surgeon/magic.ts` — Expand magic expressions (datetime, metadata)
  - `markdown-surgeon/types.ts` — TypeScript type definitions
  - `markdown-surgeon/cli.ts` — CLI interface (`md` command)

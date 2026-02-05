# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **markdown-surgeon:** Multi-file metadata aggregation via `md meta` command
  - Aggregate metadata from multiple files with `--list` (with duplicates) or
    `--aggregate` (unique values)
  - Multi-field support: `md meta --aggregate tags,categories file1.md file2.md`
  - Glob pattern support: `md meta --aggregate tags vault/**/*.md`
  - JSON output: `md meta --aggregate tags *.md --json`
  - Nested field access: `md meta --aggregate meta.tags file1.md file2.md`
  - Primary use case: list all unique tags from an Obsidian vault
- **both:** Migrated CLI argument parsing to Cliffy (@cliffy/command)
  - Auto-generated help for all commands
  - Type-safe option parsing
  - Shell completions support (bash, zsh, fish)
  - Better error messages for invalid arguments
- **worklog:** UUID base36 ID system with git-style prefix resolution
  - Replace date-based IDs with UUID base36 (25 chars, case-insensitive)
  - Display short IDs (5+ chars minimum)
  - Resolve any unambiguous prefix (e.g., "acjold", "acjo", "ac")
  - Backward compatible with existing date-based IDs
  - Enhanced error messages for ambiguous prefixes with contextual information
- **worklog:** Task metadata management via `wl meta` command
  - View metadata: `wl meta <task-id>`
  - Set metadata: `wl meta <task-id> <key> <value>`
  - Delete metadata: `wl meta <task-id> --delete <key>`
  - Metadata stored in task frontmatter for traceability (commit SHA, PR, etc.)
- **worklog:** TODO management system for tracking action items within tasks
  - Commands: `wl todo list`, `wl todo add`, `wl todo set`, `wl todo next`
  - 5 statuses: todo, wip, blocked, cancelled, done
  - Create tasks with initial TODOs via `wl add --todo "text"`
  - Custom metadata support (dependsOn, due, priority, etc.)
  - Unique 7-char base62 IDs for TODOs
  - Obsidian-compatible block references for cross-referencing
  - `wl done` blocks if pending TODOs exist (--force to override)
- **worklog:** Flexible timestamp support for `wl trace` command via
  `--timestamp` / `-t` flag
  - Format: `[YYYY-MM-DD]THH:mm[:SS][<tz>]`
  - Automatically fills missing components: date (today), seconds (:00),
    timezone (local)
  - Examples: `T11:15`, `2024-12-15T11:15`, `2024-12-15T11:15:30+01:00`
  - Enables preservation of original timestamps when importing historical
    entries
  - Comprehensive test coverage (12 integration tests for timestamp handling)

### Changed

- **worklog:** Updated `deno.json` test task to include `--allow-env` permission
- **BREAKING (markdown-surgeon):** `md concat --shift` now requires an explicit
  value
  - Before: `md concat --shift file1.md file2.md` (implicit value 1)
  - After: `md concat --shift 1 file1.md file2.md` (explicit value required)

## [0.3.0] - 2026-01-20

### Changed

- **BREAKING:** Renamed `worktrack` module to `worklog` to avoid CLI name
  collision with worktrunk
  - Module exports: `worktrack/*` → `worklog/*`
  - CLI executable: `wt` → `wl`
  - Working directory: `.worktrack/` → `.worklog/`

## [0.2.0] - 2026-01-20

### Added

- **worktrack** module for append-only work logging with checkpoint snapshots
  - `worktrack/mod.ts` - Core functionality for tracking work progress
  - `worktrack/types.ts` - Type definitions
  - `worktrack/cli.ts` - CLI interface (`wt` command)

## [0.1.0] - 2026-01-20

### Added

- Initial release
- **markdown-surgeon** module for surgical manipulation of Markdown files
  - `markdown-surgeon/parser.ts` - Parse and serialize Markdown documents with
    section IDs
  - `markdown-surgeon/hash.ts` - Generate stable section identifiers
  - `markdown-surgeon/yaml.ts` - Handle YAML frontmatter
  - `markdown-surgeon/magic.ts` - Expand magic expressions (datetime, metadata)
  - `markdown-surgeon/types.ts` - TypeScript type definitions
  - `markdown-surgeon/cli.ts` - CLI interface (`md` command)

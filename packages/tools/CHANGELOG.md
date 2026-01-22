# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **recap:** `recap show <section...>` runs one or more resolved sections by id without executing the other configured sections.
- **recap:** `status_enrichers` can append built-in or TSV-produced per-file text to the `status` section.

## [dz-review-v0.2.1] — 2026-06-22

### Changed

- **dz-review:** Timestamped human review messages must now use `@me%...`; bare `@` remains a workshop shorthand only before timestamp normalization.

### Fixed

- **dz-review:** `agent start` and `agent done` now normalize bare human `@` replies to `@me` with timestamps before handoff guardrails run.

## [dz-review-v0.2.0] — 2026-06-22

### Added

- **dz-review:** Review items now have stable base62 IDs with shortest unique display prefixes across CLI outputs and the VS Code review panel.
- **dz-review:** `dz-review agent start`, `agent status`, and `agent done` provide an agent-oriented workflow with local session snapshots, inbox/handoff summaries, timestamp restoration, and guardrail checks.
- **dz-review:** Status output reports each annotated file's detected timestamp format, and timestamp normalization now supports the Hangul-style review timestamp format.

### Changed

- **dz-review:** `list` and `diff` can include review context with `-c/--context`, keeping source timestamps in the raw context while showing ISO timestamps in the clarified view.
- **dz-review:** Agent instructions and the Markdown review workflow skill now point agents at the new `agent` workflow instead of direct timestamp-conversion commands.
- **vscode:** DZ Review extension packaging now bundles the shared review-id logic and keeps the local VSIX install task incremental.

### Fixed

- **dz-review:** File discovery now honors negated ignore rules, so explicitly unignored Markdown files are scanned correctly.
- **dz-review:** Clarified context rendering no longer rewrites the source timestamp format inside the raw context shown for an item.

## [dz-review-v0.1.0] — 2026-06-18

### Added

- **dz-review:** Initial CLI release with Markdown review conversation parsing, CriticMarkup-style annotations, per-file and aggregate status views, list/diff inspection, timestamp normalization, shell completions, `-C/--cwd`, and agent instructions.
- **dz-review:** Markdown review workflow skill and documentation for agents working with inline `{?? ??}` or HTML comment review threads.
- **vscode:** DZ Review VS Code extension package with grammar injections, decorations, review commands, a review panel, tests, and VSIX/install tasks.

## [wl-v0.18.5] — 2026-06-15

### Fixed

- **release:** GitHub release binaries now compile from direct versioned JSR URLs, avoiding stale package index metadata when the version-specific JSR files are already published.

## [wl-v0.18.4] — 2026-06-15

### Fixed

- **worklog:** GitHub release and Homebrew binaries are rebuilt from a new JSR package version that includes interactive task selection, instead of reusing the older `@dohzya/tools@0.9.12` package published before that feature.

## [wl-v0.18.3] — 2026-06-15

### Added

- **worklog:** Interactive terminal sessions can now select an active task when eligible commands run without an explicit task id or `WORKLOG_TASK_ID`, while non-interactive and agent environments keep the existing explicit-id behavior.

### Fixed

- **worklog:** Published binaries now pin Cliffy to the lockfile-tested version, so `wl run <taskId> <cmd>` keeps working when release assets are compiled from JSR.

## [wl-v0.18.2] — 2026-06-10

### Added

- **worklog:** `wl agent-instructions` now mentions subtask creation with `--parent`, and `wl agent-instructions --mandatory` prints stricter AGENTS.md wording.

### Changed

- **worklog:** Checkpoint and done synthesis prompts now ask agents for cumulative, self-contained summaries.
- **release:** The binary-only release instructions now warn that `wl` binaries are compiled from the published JSR package.

### Fixed

- **worklog:** Release binaries are now compiled with unrestricted `--allow-run`, so `wl codex` can launch Codex and `wl run` can execute arbitrary commands.
- **worklog:** Concurrent todo status updates now serialize writes through the repository lock.

## [recap-v0.3.2] — 2026-06-03

### Fixed

- **recap:** `git-status-local` now displays non-ASCII paths directly instead of octal-escaped Git paths, and colorizes status columns when color output is enabled.

## [recap-v0.3.1] — 2026-06-03

### Fixed

- **recap:** `git-status-local` now correctly summarizes files outside the current directory when Git quotes paths containing spaces or non-ASCII characters.

## [wl-v0.18.0 / md-v0.8.0 / recap-v0.3.0] — 2026-06-03

### Added

- **markdown-surgeon:** `md` commands now accept `#`-prefixed heading selectors, resolving by heading level and title while reporting ambiguous matches explicitly.
- **worklog:** `wl agent`/`wl codex` now inject worklog context through Codex `developer_instructions`, preserving existing Codex config and CLI overrides.
- **worklog:** `wl list` shows child worklog context in a concise header, with `--no-header` for stable script output.
- **worklog:** `wl dashboard` provides an overview of active work, grouped status counts, started tasks, and recent activity.
- **recap:** `git-status-local` built-in scopes status output to the current directory, adds colorized compact per-file diff stats, and summarizes changes outside it by kind.
- **recap:** `git-stash` built-in shows stash entry counts in the default recap.
- **tools:** `wl agent-instructions`, `md agent-instructions`, and `recap agent-instructions` print short AGENTS.md snippets for lightweight agent onboarding.

### Fixed

- **worklog:** Cross-scope subtasks keep their target scope at creation time, `wl list` can reveal child-scope subtasks for started parent tasks, and parent-scope tasks render with `[^]`.

## [wl-v0.17.0] — 2026-05-29

### Added

- **worklog:** `wl list --subtasks-of-started` shows subtasks whose parent task is started without showing every subtask globally.

### Changed

- **worklog:** Checkpoint terminology is now `learnings` instead of `insights`, with legacy `### Insights` headings still readable from existing task files.
- **release:** `task validate` now checks Claude/Codex plugin metadata versions stay in sync, and `bump-finalize` updates all plugin metadata version fields together.

### Fixed

- **worklog:** `wl create --scope <scope>` now fails when the requested scope is missing instead of silently creating the task in the current worklog.
- **worklog:** Codex-backed checkpoint and done synthesis can run unattended through `codex exec`, and compiled `wl run` can execute arbitrary commands.
- **worklog:** Tracing a done task now requires `--force`, warns agents to checkpoint post-completion traces, and allows checkpointing done tasks when uncheckpointed traces exist.

## [recap-v0.2.1] — 2026-05-27

### Added

- **recap:** `recap config show` prints the fully resolved effective configuration as YAML.
- **recap:** `recap config files` lists the config files loaded by recap, from local to global.
- **recap:** `recap config files -v` prints each loaded config from local to global and includes the built-in default config at the bottom.
- **recap:** Config discovery now accepts `.config/recap.yml` alongside `.config/recap.yaml`.

## [wl-v0.16.0] — 2026-05-26

### Added

- **worklog:** Codex agent support via `wl codex`, `--codex`, and `wl agent` auto-detection, including environment-backed task resolution for agent sessions.
- **worklog:** `wl claude` now supports the `agents` subcommand shape, alongside existing Claude command forms.
- **plugins:** Codex plugin metadata and validation, with `task validate:plugin:codex` included in the standard plugin validation flow.
- **docs:** Codex setup documentation and agent-neutral worklog guidance across repo and skill docs.

### Changed

- **worklog:** Checkpoint terminology is now `insights` instead of `learnings`, with legacy `### Learnings` headings still readable from existing task files.
- **worklog:** Agent prompts and skill docs now explicitly require tracing actions, problems, ideas, leads, findings, and insights so checkpoints have complete source material.

### Fixed

- **worklog:** Backdated traces are no longer skipped by checkpoint detection when their event timestamp predates an existing checkpoint but their add time is newer.
- **worklog:** `done --claude` falls through to normal completion when there are no uncheckpointed entries, instead of requiring unnecessary synthesis.
- **worklog:** Missing worklog initialization errors now correctly tell users to run `wl init`.

## [wl-v0.15.0] — 2026-05-13

### Added

- **worklog:** Colored output with the Catppuccin Latte palette by default. Statuses (`done`/`started`/`ready`/`created`/`cancelled`), short IDs, timestamps, tags (`#name`, `[scope]`), and field labels are now colorized in `list`, `show`, and `traces` output when stdout is a TTY. `FORCE_COLOR=1` forces colors when piped (e.g. inside `recap`); `NO_COLOR=1` disables.
- **worklog:** New `Theme` and `Palette` entities (semantic role → hex tokens) under `worklog/domain/entities/` — designed to be swappable so future config-driven theming is non-invasive.
- **worklog:** `wl codex` command and `--codex` flag mirroring the existing `wl claude` / `--claude` integration.
- **worklog:** `wl agent` / `--agent` auto-detects the running AI agent from environment (`CLAUDECODE` → claude, `AGENT=codex` → codex) and errors out from a plain terminal.

### Changed

- **worklog (internal):** `ClaudeCommandUseCase` refactored into `AgentCommandUseCase` parameterized by `AgentConfig` (strategy pattern); `buildClaudeCheckpointPrompt` renamed to `buildCheckpointPrompt`.

## [recap-v0.2.0] — 2026-05-13

### Added

- **recap:** Color forwarding to subcommands — when `recap` itself emits colors (TTY + `!NO_COLOR`), it injects `FORCE_COLOR=1`, `CLICOLOR_FORCE=1`, and `GIT_CONFIG_COUNT/KEY_0/VALUE_0` (forcing `color.ui=always`) into every shell section's env. Section-level `env:` still overrides. When recap suppresses colors, `NO_COLOR=1` is propagated instead.
- **recap:** `git-log` builtin now emits ANSI colors when the run is colored — prepends `-c color.ui=always` and uses `--pretty=format:%C(auto)%h%Creset %s` (a plain `%h %s` format ignores `color.ui`, so explicit `%C` tokens are required).
- **recap:** `git-subdir` builtin — shows `(in ./sub/path)` when invoked from a subdirectory of a git repo; silent at the repo root.
- **recap:** `ref: "*"` now excludes IDs that appear elsewhere in the same entries list as explicit `ref: <id>` — lets you reposition a single inherited section without duplicating it.

## [wl-v0.14.2] — 2026-05-11

### Fixed

- **worklog:** `wl claude` prompt no longer says trace/checkpoint/done "require taskId as first argument" — all commands now documented as working without taskId when `WORKLOG_TASK_ID` is set, explicit id is only for targeting a different task
- **worklog:** Skill reference.md aligned: mentions `wl claude` alongside `wl run`, explicitly bans `WORKLOG_TASK_ID=... wl ...` prefix antipattern

## [wl-v0.14.1] — 2026-05-05

### Added

- **worklog:** `--desc-src <source>` option on `create` and `update` — reads the task description from a file path or from stdin (`--desc-src -`). Errors on conflict with positional desc or `--desc`.

### Fixed

- **worklog:** YAML frontmatter now serialized via `@std/yaml` instead of manual template strings — descriptions with newlines, colons, quotes, or backslashes no longer break the task file. Multiline descriptions get proper YAML block scalar (`|`) treatment.

## [wl-v0.14.0] — 2026-05-05

### Added

- **worklog:** `checkpoint --claude` now injects all traces since last checkpoint into the prompt (not just the 5-trace cap), with quality guidelines, good/bad examples, previous checkpoint as style reference, and an empty-entries guard
- **worklog:** `done --claude` mirrors the same behavior for the final checkpoint that closes the task
- **worklog:** `wl claude` system prompt now recommends `checkpoint --claude` to spawned agents

### Fixed

- **test:** Disable GPG signing in compat test git repos (avoids 1Password prompts)

## [recap-v0.1.0] — 2026-03-05

### Added

- **recap:** Initial release — configurable project status dashboard for AI assistants
- **recap:** Three-level cascading config: hardcoded defaults → `~/.config/recap.yaml` (global) → `.config/recap.yaml` (local)
- **recap:** `ref: "*"` includes all parent sections; `ref: "id"` picks one with optional field overrides
- **recap:** Section types: `sh:` (shell via dax, cross-platform), `builtin:` (`git-ops`, `git-log`), `value:` (static with `${VAR}` interpolation)
- **recap:** `git-ops` built-in: detects in-progress git operations (rebase, merge, cherry-pick, revert) by reading `.git/` sentinel files
- **recap:** `git-log` built-in: smart upstream detection (`@{u}` → `origin/HEAD` → recent commits fallback)
- **recap:** `recap init [--global]` generates a starter config using `ref:` syntax
- **recap:** `recap -C <dir>` changes working directory (like `git -C`)
- **recap:** `recap completions` for shell autocompletion
- **recap:** `recap --json`, `--no-color`, `--config <path>` flags
- **recap:** `MAX_COMMITS` / `MAX_WORKTASKS` / `NO_COLOR` environment variable overrides

## [wl-v0.13.0] — 2026-03-03

### Added

- **worklog:** `wl trace` and `wl checkpoint` now adapt their `--help` output when `WORKLOG_TASK_ID` is set — task ID shown as `[taskId]` (optional) instead of `<taskId>` (required); smart arg resolution lets both commands be called without an explicit ID when the env var is active

### Changed

- **worklog:** Removed legacy `wl task` command group (`wl task create`); use `wl create` (or `wl create --started`) instead

### Fixed

- **worklog:** `wl init` now writes `index.json` with `version: 2` directly, preventing a spurious V1→V2 migration warning on the very first command after init

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

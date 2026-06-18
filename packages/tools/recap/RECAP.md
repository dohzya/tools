# recap — Technical Reference

## Commands

```bash
recap                         # Run all resolved sections
recap show git-status         # Run one section by resolved section id
recap show git-status git-log # Run several sections in the requested order
recap --json show git-status  # Emit selected sections as JSON
```

## Config resolution

`recap` merges three levels of configuration, each building on the previous:

```
Hardcoded defaults
  ↓ (ref: resolves against hardcoded)
~/.config/recap.yaml          (global)
  ↓ (ref: resolves against global)
.config/recap.yaml            (local, searched from cwd)
```

If no config files exist, the hardcoded defaults are used directly. If only a global config exists, it resolves against the hardcoded defaults. If both exist, the local config resolves against the (already-resolved) global config.

A `-C <dir>` flag overrides where the local config is searched. `--config <path>` skips auto-discovery entirely and loads that file as local config.

## Config file format

```yaml
# Optional: load .env files before running sections
dotenv:
  - .env.local
  - .env

sections:
  - ref: "*" # Include all sections from the parent level
  - ref: git-log # Include a specific section from parent
    max_lines: 10 # Override any field(s) from the parent

  - id: my-section # Define a new section
    sh: echo hello # Shell command (cross-platform via dax)
    title: My Section # Optional header line
    max_lines: 5 # Truncate output to N lines
    separator: blank_line # blank_line (default) | none | line
    env: # Extra env vars for this command
      FOO: bar
    cwd: /some/path # Working directory override

status_enrichers:
  - id: git-stats # Built-in default: appends "(N+ M-)"
    builtin: git-stats
    format: tsv
  - id: annotations # Stable id for merge/override
    sh: annotations status --recap # Emits path<TAB>text lines
    format: tsv # Currently only tsv is supported
```

### Section types

| Type      | Fields    | Description                                     |
| --------- | --------- | ----------------------------------------------- |
| Shell     | `sh`      | Run a shell command. Output is split by lines.  |
| Built-in  | `builtin` | Run a built-in provider (see below).            |
| Static    | `value`   | Static text. `${VAR}` is interpolated from env. |
| Reference | `ref`     | Include a section from the parent level.        |

### Built-in providers

**`git-ops`** — Detects in-progress git operations by reading `.git/` sentinel files: `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`, `rebase-apply/`. Produces no output when the repo is clean. Silently skipped outside a git repo.

**`git-log`** — Shows recent commits with smart upstream detection:

1. Tries `@{u}` to find the tracking branch
2. Falls back to `refs/remotes/origin/HEAD`
3. Falls back to the last N commits with no range filter

**`status`** — Shows local working-tree status lines, enriched with configured `status_enrichers`. The built-in default `git-stats` enricher appends compact Git diff stats like `(12+ 3-)`, with additions in green and deletions in red when color output is enabled.

**`git-status`** — Deprecated alias for `status`; use `status` instead.

**`git-stash`** — Shows `(N stashed entries)` when the repo has stash entries.

**`git-status-local`** — Legacy built-in provider kept for compatibility. It uses the same local status source as `status`.

### `ref:` resolution

`ref: "*"` expands to **all** sections from the parent level, at this position. `ref: "some-id"` includes one specific section. Any additional fields override the parent's values.

This enables multiple merge strategies:

| Strategy                    | Pattern                                 |
| --------------------------- | --------------------------------------- |
| Append local after parent   | `[ref: "*", ...local]`                  |
| Prepend local before parent | `[...local, ref: "*"]`                  |
| Replace entirely            | No `ref:` at all                        |
| Wrap parent                 | `[local-before, ref: "*", local-after]` |

A `ref:` to a non-existent id is an error (not silently skipped).

### `status_enrichers:`

Status enrichers append per-file text to `status` lines.

```yaml
status_enrichers:
  - id: git-stats
    builtin: git-stats
    format: tsv
  - id: annotations
    sh: annotations status --recap
    format: tsv
```

`git-stats` is the built-in default enricher that appends Git additions and deletions, for example `(3+ 4-)`.

For `format: tsv`, the command emits one line per file:

```text
src/a.ts	[ann 3/11 +3~2]
```

`recap` matches the path against visible Git status entries and appends the text verbatim:

```text
M src/a.ts (3+ 4-) [ann 3/11 +3~2]
```

Global and local configs merge enrichers by `id`; local entries override global entries with the same `id` and append entries with new ids.

See [Status Enrichers](../docs/functional/status-enrichers.md) for the producer contract intended for external tools.

### `dotenv:` + interpolation

Files are loaded in order: first file wins for each variable. System env vars always take priority.

`${VAR}` placeholders in `value:` strings are interpolated from the merged env (system env > first dotenv file > second dotenv file).

### Environment variable overrides

| Var             | Effect                                                 |
| --------------- | ------------------------------------------------------ |
| `MAX_COMMITS`   | Override `max_lines` for the `git-log` section         |
| `MAX_WORKTASKS` | Override `max_lines` for any section named `worktasks` |
| `NO_COLOR`      | Disable ANSI color output                              |

---
category: functional
themes:
  - configuration
  - status
verified_at: 2026-06-18
source_ref: packages/tools/recap
language: en-US
---

# Status Enrichers

Status enrichers let another tool add short per-file details to the `recap` `status` section.

They are intended for tools that already know how to inspect the current workspace, such as an annotation tracker. `recap` keeps ownership of the Git status line, and the enricher owns the extra text appended to that line.

## Configuration

Add a `status_enrichers` block to a recap config file:

```yaml
status_enrichers:
  - id: git-stats
    builtin: git-stats
    format: tsv
  - id: annotations
    sh: annotations status --recap
    format: tsv
```

Each enricher has:

| Field     | Required | Description                                      |
| --------- | -------- | ------------------------------------------------ |
| `id`      | Yes      | Stable identifier used for config merging.       |
| `sh`      | One of   | Command executed by `recap`.                     |
| `builtin` | One of   | Built-in provider name, currently `git-stats`.   |
| `format`  | Yes      | Output format. Currently only `tsv` is accepted. |
| `env`     | No       | Extra environment variables for shell commands.  |
| `cwd`     | No       | Working directory override for shell commands.   |

Use either `sh` or `builtin`, not both.

`git-stats` is configured by default. It appends Git additions and deletions, for example `(3+ 4-)`.

Global and local configs merge enrichers by `id`. A local enricher with the same `id` replaces the global one. A local enricher with a new `id` is appended.

## TSV Output Contract

For `format: tsv`, the command writes one line per file:

```text
<path><TAB><text>
```

Example:

```text
src/a.ts	[ann 3/11 +3~2]
src/b.ts	[ann 1/4]
```

`recap` appends `<text>` verbatim to the matching Git status line:

```text
 M src/a.ts (3+ 4-) [ann 3/11 +3~2]
?? src/b.ts (1+ 0-) [ann 1/4]
```

The enricher is responsible for display choices such as brackets, labels, symbols, colors, and spacing inside `<text>`.

## Path Matching

The `<path>` value must match the path displayed by the `status` section.

Rules:

1. Use a path relative to the `recap` status section working directory.
2. Use the exact spelling shown by `recap`, including spaces and Unicode.
3. Do not include tab characters in paths.
4. Emit only one line per file and keep `<text>` on one line.

Lines whose path does not match a visible Git status file are ignored.

## Execution

`recap` runs each configured enricher once for each `status` section.

The command receives the same color environment style as shell sections:

| Color mode | Environment behavior                                  |
| ---------- | ----------------------------------------------------- |
| Enabled    | `FORCE_COLOR=1`, `CLICOLOR_FORCE=1`, Git color config |
| Disabled   | `NO_COLOR=1`                                          |

If an enricher exits with a non-zero status and no stdout, the status section reports the command error.

## Minimal Producer Example

This illustrative shell command adds annotation counts to two files:

```bash
printf 'src/a.ts\t[ann 3/11 +3~2]\n'
printf 'src/b.ts\t[ann 1/4]\n'
```

For a real tool, prefer a dedicated command such as:

```bash
annotations status --recap
```

That command should inspect the workspace itself and emit only entries that are useful to append to `recap` status lines.

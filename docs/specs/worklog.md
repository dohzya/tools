# worklog: the Rust port

Status: accepted 2026-11-10 (decisions recorded during the Deno to Rust migration, see [`docs/plans/2026-10-28-runtime-migration.md`](../plans/2026-10-28-runtime-migration.md)).

The Rust `worklog` (alias `wl`) reads and writes the same `.worklog/` directories as the TypeScript `wl` and prints the same output. It is pinned by the black-box suite `tests/blackbox/cases/wl` (`parity` cases recorded from Deno, plus `new-spec` cases for the defects fixed below; `spec_row` is `worklog.md D<n>`). The `.worklog/` files of existing repositories must stay readable and be rewritten byte for byte as before.

## Crates

| Crate          | Content                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worklog-core` | Pure model, no I/O, builds for `wasm32-unknown-unknown`: YAML emitter and parser of the frontmatter, task file splicing, index and ordered JSON, dates, text and JSON results, agent prompts and command lines |
| `worklog-cli`  | Bin `worklog` (clap): ports (`Fs`, `Git`, `Proc`, `Env`, `Clock`) and their adapters on the real system, scope discovery, id resolution, command handlers                                                      |

The VS Code extension will import `worklog-core` through a `wasm-bindgen` facade, like `critique-core`.

## File formats (unchanged)

- `index.json`: `JSON.stringify(index, null, 2)`, no final newline, `{ "version": 2, "tasks": { <id>: entry } }`. Keys keep their order on rewrite (`worklog-core::json::J` is an ordered JSON value). An entry holds `name`, `desc` (array of parts), `status`, `created`, `status_updated_at`, `done_at`, optionally `cancelled_at`, `tags`, `parent`, `links`.
- `tasks/<id>.md`: YAML frontmatter, then `# Entries` (`## YYYY-MM-DD HH:mm  [kind:: k]`, an optional `[added:: ..]` line, the message), `# Checkpoints` (`## ts`, `### Changes`, `### Learnings`), optional `# TODO` (`- [ ] text  [k:: v] ^id`, status chars `/> -x`).
- The frontmatter is written by a port of the `@std/yaml` 1.1.0 dumper (`yaml::dump`): plain scalars only when no other YAML type could read them back (strings with `:` or `#` are single-quoted, empty strings are `''`, code points above U+FFFF and U+00A0 force double quotes because the JS code looked at UTF-16 units, multi-line strings are literal blocks). `tests/yaml_golden.json` holds 130 awkward strings dumped by the Deno implementation. The parser is `serde_yaml_ng`; corrupted YAML reads as an empty frontmatter, as before.
- Ids: tasks are a UUID v4 in base36 (25 chars), a trace id is the first 8 hex of the SHA-256 of `2:<ts>:<occurrence>` (the section id of `md`), a todo id is 7 base62 chars.
- `scope.json` is either `{ "children": [{ "path", "id", "type"?, "gitRef"?, "tags"? }] }` (parent) or `{ "parent": "../" }` (child). `config.json` may hold `purgeTtlDays`.
- Task files are read with CRLF and lone CR treated as LF; a file that was CRLF or CR is written back with the same line ending.
- The section scanner is the one of the TS tool (a line regex and a fence toggle), not CommonMark: files are machine written and entries are inserted by line arithmetic.

## Environment

`WORKLOG_TASK_ID` makes the task id optional (and shifts the positional arguments of `trace`, `checkpoint`, `done`, `cancel`, `meta`); `WORKLOG_DEPTH_LIMIT` (default 5) bounds the scan for child worklogs; `WORKLOG_PURGE_TTL_DAYS`, `--purge-ttl`, `config.json` and `~/.config/wl/config.json` set the retention of done tasks (30 days); `NO_COLOR`, `FORCE_COLOR`, `NO_PAGER`, `FORCE_PAGER` and `PAGER` as in the TS tool; `CLAUDECODE` and `AGENT=codex` select the agent of `wl agent`.

Cliffy's argument rules are kept where they change the exit status: a required argument that is missing is a usage error (status 2) unless `WORKLOG_TASK_ID` is set; a missing id that the handler checks is `error: invalid_args` (status 1).

## Changes

| #  | Topic                         | Before (TS)                                                                                                                                                                                  | Now                                                                                                                                                                                                                              |
| -- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | Index of a new scope          | `scopes add`, `scopes sync-worktrees` and `scopes export` wrote `{ "tasks": {} }` without `version`                                                                                          | They write `{ "version": 2, "tasks": {} }`, so the first read of the scope does not run the v1 migration                                                                                                                         |
| D2 | v1 to v2 migration            | Rewrote every task: `name` := first line of the description, `ready_at` and `started_at` := null. On an index that merely lacked `version` this destroyed task names and clears `started_at` | Only entries without a `name` (real v1 data) are migrated; an index that only lacks `version` is stamped and the tasks are left alone                                                                                            |
| D3 | `run` exit status             | Exit 0 whatever the child's status; the status was only printed                                                                                                                              | The line `Ran task <id> (exit code: N)` is printed as before, then `wl` exits with N. `--json` must precede the command (options after it belong to the child, as before)                                                        |
| D4 | `run --create <name> <cmd>`   | Always failed with `Create task function not available`                                                                                                                                      | Creates the task (status `created`), runs the command with `WORKLOG_TASK_ID` set, prints `Created and ran task <id> (exit code: N)`                                                                                              |
| D5 | `claude`/`codex`/`agent` args | `wl claude <id> -- -c` dropped everything after `--`                                                                                                                                         | The arguments after `--` are passed to the agent (the `--` itself is not); `wl create --claude "x" -- -c` already worked                                                                                                         |
| D6 | `traces update`               | Re-serialized the whole task file: lost `cancelled_at` and any unknown frontmatter key, squeezed the blank lines between entries                                                             | Rewrites only the heading of the trace (`## ts  [kind:: k]`)                                                                                                                                                                     |
| D8 | Order of scopes               | Directory order of the file system (`Deno.readDir`): differs between machines                                                                                                                | Scopes are scanned in name order, so `scopes list`, `scoped` listings and `scope.json` refreshes are the same everywhere                                                                                                         |
| D7 | Invalid directory options     | `--purge-ttl 0` (or a bad value in the env var or `config.json`) and a `--worklog-dir` whose parent directory does not exist ended in an uncaught exception with a stack trace               | `--purge-ttl 0` is `error: invalid_args` (status 1). A missing parent of `--worklog-dir` is not an error by itself: `init` creates it, other commands report `not_initialized`. `-C` of a missing directory is `error: io_error` |

Concurrency: the TS tool took a `<task>.md.lock` file around `todo set`. The Rust port has no lock: every write is a temporary file renamed over the target, so a reader never sees a torn file, but two concurrent writers of the same task can still lose one update. Locking is in the backlog.

## Behaviour kept from the TS tool, although odd

They are `parity` cases and are listed here so that they are changed on purpose, not by accident.

- Any command purges expired done tasks (index entries and files), even read-only ones; tasks with uncheckpointed entries are kept with a warning.
- `meta <id>` (read only) rewrites the file and adds `metadata: {}`. `cancel` does not bump `status_updated_at`; `done` sets `done_at` in the index but not `status_updated_at`.
- `todo set <id> text=..` stores a `[text:: ..]` field instead of renaming the todo; `status=<unknown>` answers `todo updated` and changes nothing; the todo is found by prefix and the line by the substring `^<id>`.
- `import` and `scopes assign` write index entries without `tags`, `links` and `parent` (the task file is complete), so an imported subtask lists as a top-level task until the index is rebuilt.
- `create` works in a directory without `.worklog` (it initializes it, writing `tasks` before `version`), every other command fails with `not_initialized`.
- Outside git, `--scope`, `--all-scopes` and the `list <pattern>` argument are ignored. `summary --since garbage` succeeds with no entry. `scopes rename a b` accepts an id already in use.
- `scopes list` writes the `scope.json` files when the root has none (or with `--refresh`).
- `show` prints the tags of the task plus the tags its scope entry gives to the scope; the TS use case looked the parent config up with a wrong path and never found it, this port applies the documented rule (visible only with `tags` in a scope entry).
- `wl` with no argument prints the help (status 0); an unknown command is a usage error (status 2). Help and completions are produced by clap, not cliffy: their text differs.

## Not ported

Nothing of the command set. The interactive task picker is a plain numbered prompt on stderr (no arrow keys), shown only when no task id is given, `WORKLOG_TASK_ID` and agent variables are unset and both ends are terminals.

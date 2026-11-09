# recap: behaviour changes of the Rust port

Status: accepted 2026-11-06 (decisions recorded during the Deno to Rust migration, see [`docs/plans/2026-10-28-runtime-migration.md`](../plans/2026-10-28-runtime-migration.md)).

The Rust `recap` matches the TypeScript one (black-box `parity` cases) except for the points below. Each of 1 to 3 is pinned by `new-spec` cases in `tests/blackbox/cases/recap` (`spec_row` is the number used here, prefixed `recap:`).

## Changes

| #  | Topic                  | Before (TS)                                                                                                                       | Now                                                                                                                                                                                                                                                                                                                                                       |
| -- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Section `cwd:`         | Relative path resolved against the process cwd; a missing directory crashes the tool                                              | Relative path resolved against the run directory (`-C`, like `git -C`); a missing directory is a section error (`[id] error: Failed to launch command because the cwd does not exist (...)`)                                                                                                                                                              |
| 2  | `dotenv:`              | Parsed, never loaded: `${VAR}` in `value:` only saw the section `env:`                                                            | As documented: files loaded in order, the first file wins per variable, the system env wins over files. `${VAR}` is looked up in the section `env:`, then the system env, then the files. File variables are also exported to every command. Relative paths are resolved against the run directory (`-C`), not the config file. A missing file is ignored |
| 3a | `ref:` scope           | A level could only `ref:` sections its direct parent level ended up with                                                          | Sections of all ancestor levels (including the built-in defaults) can be referenced, nearest level first. `ref: "*"` still expands the direct parent list only                                                                                                                                                                                            |
| 3b | Alias-only `sections:` | A `sections:` list replaced the parent's sections even when it held only aliases (or was empty): the result had no section at all | A list replaces the parent's sections only if it defines at least one non-alias entry. Aliases are registered in any case                                                                                                                                                                                                                                 |

Dotenv notes: layers are combined most local first (local personal, local, global personal, global). The format is `KEY=value` lines, `#` comments, one pair of quotes stripped, no escapes. `default-json` and `default-text-env` were `parity` cases that froze the uninterpolated `${NAME}`; they are `new-spec` now.

## Other differences, accepted

- Shell sections run through `sh -c` (the TS used the cross-platform shell of dax); stdin is closed.
- `max_lines` must be an integer (the TS tolerated floats).
- Config errors of `config show` and `config files` print `recap error: <message>` and exit 1 (the TS crashed with a stack trace).
- `--json` is accepted and ignored by `config` and `init`, as in the TS.

# Coverage inventory

Counts come from `--help` of the Deno reference (rough: option lines include inherited globals such as `-h`, `--json`; aliases are counted separately).

| Tool        | Commands (incl. subcommands)                                            | Option lines | Cases in this pass | Status                                                                       |
| ----------- | ----------------------------------------------------------------------- | ------------ | ------------------ | ---------------------------------------------------------------------------- |
| `md`        | 13                                                                      | ~60          | 249                | done except MRFI (`ref`, `resolve`, `--mrfi`, `-x/--strict/--force` on refs) |
| `recap`     | 5 (`show`, `config show/files`, `init`, `agent-instructions`)           | ~10          | 51                 | done (builtins `status`, `git-log`, `git-ops`, `git-stash`, config layers)   |
| `wl`        | ~45                                                                     | ~350         | 524                | done (Rust port, see [`docs/specs/worklog.md`](../../docs/specs/worklog.md)) |
| `dz-review` | ~28 (+ `review/status/list/diff/timestamp` aliases under root and `me`) | ~170         | 0                  | backlog                                                                      |

## wl backlog (~45 commands)

Top-level: `init`, `create`, `ready`, `start`, `run`, `claude`, `codex`, `agent`, `agent-instructions`, `update`, `trace`, `traces` (+ `traces update`), `show`, `checkpoint`, `done`, `cancel`, `meta`, `link`, `tags` (`add`, `remove`, `rename`), `list` (25 option lines), `status`, `dash`/`dashboard`, `summary`, `import`, `todo` (`list`, `add`, `set`, `next`), `add-parent`, `scopes` (`list`, `add`, `add-parent`, `rename`, `delete`, `assign`, `export`, `sync-worktrees`). Heaviest: `create` (22 options), `list` (25), `update` (13), `checkpoint`/`done` (12 each), `import` (11).

Needs before starting: normalizers `wl-id`, `short-ts`, `iso-ts` (exist); `claude`/`codex`/`agent`/`run` spawn external processes (stub them via PATH in `setup.sh`); `checkpoint --agent` / `done --agent` delegate to an agent CLI (stub); pager and interactive selects need a TTY (not testable, assert the non-TTY path); `scopes`/git cases need `setup.sh` git repos with fixed dates. Existing sources to mine: `packages/tools/compat-tests/cli-wl.test.ts` and `docs/explorations/runtime-migration/{fixtures,cases.json}` (39 `wl list`/`wl show` cases over a tracked `.worklog` fixture; `.gitignore` already negates `tests/blackbox/fixtures/**/.worklog/`).

## dz-review backlog (~28 commands)

`now`, `ref` (`check`, `list`, `show`, `snapshots`), `session` (`start`, `add-file`, `status`, `active`, `done`, `rollback`), `agent` (`list`, `inbox`, `show`, `respond`, `apply`, `clean`, `diff`, `status`), `me` (`review|status|list|diff`), root aliases (`review`, `status`, `list`, `diff`, `timestamp`), `agent-instructions`. Heaviest: `me status` (28 option lines), `now` (10). Depends on the same section parser as `md` (spec rows 1-8). Timestamps and session snapshots need `iso-ts` normalization; state lives in a configured state dir (set it inside `work/` through `env`).

## dz-review

568 `parity` cases under `cases/dz-review/<group>/` recorded from the Deno reference, plus 70 `md ref`/`md resolve` MRFI cases under `cases/md/ref|resolve/` (these use the `dz-review-refs` fixture). Run: `tests/blackbox/run.sh --ref deno --tool dz-review`.

| Group        | Cases | What it pins                                                                                                                                                                                                        |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syntax`     | 14    | Text output of `list` over a corpus (states open/wip/handled/resolved, `{?? ??}` and `<!-- -->` conversations, all `{++ -- ~~ == >>}` annotations, duplicates, code fences, unicode, CRLF, whitespace, long bodies) |
| `ids`        | 32    | `list --json` ids for the same corpus; ISO / compact / hangul / UTC timestamps for the same instant (`same-name-*` must equal `formats-iso`); duplicate items; emoji                                                |
| `list`       | 61    | Every filter flag, `--since` (iso, compact, hangul), context, color, pager, aliases, error paths                                                                                                                    |
| `status`     | 36    | text, `--short`, `--oneline`, `--recap`, `--template`, `--quiet`, session-aware output, `me status`                                                                                                                 |
| `now`        | 33    | `--date` in every format and offset (compact encodes the offset), error paths; current-time variants through sed                                                                                                    |
| `timestamp`  | 40    | `-i/-o/-s/--stdin`, `--format-info`, all target formats, untimestamped input, CRLF, fences                                                                                                                          |
| `session`    | 59    | `start` (dry-run, force, json, state dir), `status`, `active`, `add-file`, `done` (guardrails, `--acknowledge`, format restore), `rollback`                                                                         |
| `agent`      | 99    | `list/inbox`, `show`, `respond`, `apply` (each annotation kind, `--replace`), `clean`, `diff`, `status`, error paths                                                                                                |
| `ref`        | 82    | `ref check/list/show/snapshots` over ok/bad/stale/nested snapshot fixtures, `--json`, `--snapshot-lines`, `--ref`, target drift                                                                                     |
| `review`     | 31    | Interactive `review`/`me review` driven through stdin (reply, ok, delete, apply, cancel, next, quit, help), `--list`                                                                                                |
| `git`        | 40    | `diff`, `--git/--diff`, `--diff-conversations`, implicit file discovery in a git worktree, ignore files, state dir at the git root (repos built in `setup.sh` with fixed dates)                                     |
| `drift`      | 31    | `reference-map.json` persistence: id adoption after edits (typo, insert above, delete, swap, rename, duplicate), corrupt / foreign map, stamping, state-dir isolation                                               |
| `global`     | 10    | `-C`, `--state-dir`, `DZ_REVIEW_STATE_DIR`, `DZ_REVIEW_IGNORE_FILE`, unknown command                                                                                                                                |
| `md ref`     | 36    | MRFI generation (hangul/debug/base62, profiles, `--quote`), conversion between encodings, scalar-value columns, CRLF normalisation, errors                                                                          |
| `md resolve` | 34    | Resolution status/confidence of refs after edits: pristine, insert above, typo, rewrite, delete, duplicate, moved, anchor removed/duplicated, heading renamed, CRLF conversion                                      |

Conventions: state lives in `.dz-review/` of the work dir (no git there), declared in `files` (`reference-map.json` is written by almost every command, including `list`, `status` and `session start --dry-run`). Cases that stamp "now" use `norm: iso-ts` plus `sed` expressions (`contentHash`, compact timestamps); no change to `lib/normalize.sh` was needed. Fixtures: `dz-review-{plain,stamped,syntax,formats,session,refs}`.

Known Deno defects recorded as parity (grep `DEFECT` or `note` in `case.json`): `ref check` rejects the documented `~<item id>` form (any `~xxx` is parsed as MRFI, `missing-review-id` is unreachable); emoji on an item line fails the whole command; persisted ids are adopted by line range only (swapped / duplicated ids after inserting lines above or applying a sibling annotation on the same line); identical items share one id once a map exists. Not recorded: `delete a line holding an item, then list` with an existing map hangs the reference (60 s timeout).

Not covered: `--help`/`--version`/`completions`; error message text beyond the first `error` line (always `error: invalid_args`, so the exit code carries the contract); `--pager` against a real TTY pager; real-time `now` values (shape only); `agent-instructions` (static text is covered by one case); permission errors (root-dependent); `md outline --mrfi`.

## Additions of 2026-11-09 (all `new-spec`, expected output hand-written from the specs)

- `md compare` (14 cases) and `md rank` (9, including `--stdin`): `cases/md/compare|rank/`, spec row 24 of `docs/specs/markdown-sections.md` and `docs/specs/mrfi.md`. No TS command exists, so there is no Deno counterpart.
- `dz-review`: `drift/pass-two-closest-stored-reference` (reference-map pass 2 ranked by MRFI `rank`), `syntax/cr-only`, `syntax/cr-only-context`, `ids/cr-only-json` (a lone CR ends a line), `agent/apply-remove-*` (7, `agent apply --remove`), `eol/*` (11: replies, remove, clean and review replies on CRLF and CR files, `rawHash` independent of the EOL). `md misc/agent-instructions` became `new-spec` (it describes `compare`/`rank`). See `docs/specs/critique.md`.

## wl

514 cases under `cases/wl/<group>/` plus the 5 historical `smoke-*` (519 in total), all `behavior: parity`, recorded from the Deno reference. Supersedes the "wl backlog" paragraph above and the `5 smoke` row of the table. Run: `tests/blackbox/run.sh --ref deno --tool wl` (about 15 min sequentially because every case boots Deno; the groups are independent, so `--only 'wl/<group>/*'` can be run in parallel).

| Group (dir)                                   | Cases         | What is covered                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                                        | 6             | text/JSON, already initialized, `-C`, `--worklog-dir`, `--purge-ttl`                                                                                                                                                               |
| `create`                                      | 30            | every option except clipboard/agent (`--ready --started --tag --todo --meta --parent --depends-on --blocks --related --desc --desc-src (file, stdin) -t --json`), errors                                                           |
| `ready`, `start`, `update`                    | 10, 14, 16    | transitions (incl. reopen done/cancelled), `--name --desc --append-desc --*-src`, `WORKLOG_TASK_ID`, errors                                                                                                                        |
| `trace`, `traces`, `traces-update`            | 24, 18, 8     | all 6 kinds, `-t` forms, multiline/unicode, `-f` on done, `--kind/--exclude-kind`, `--json`, trace-id updates                                                                                                                      |
| `show`, `list`, `status` (+`dash`), `summary` | 27, 53, 16, 8 | read paths over 5 fixtures: every `list` filter (status flags, subtasks, link filters, `--parent`, `--include-blocked`, `-p`, `--no-header`, pager), `--json`, `--limit`, `--since`, purge TTL (flag, env, expiry deleting files)  |
| `checkpoint`, `done`, `cancel`                | 17, 15, 10    | manual synthesis, `--force`, `--meta`, pending-todo refusal, `-q`, errors. Agent-delegated forms are in `agent`                                                                                                                    |
| `meta`, `link`, `tags`                        | 31, 13, 32    | get/set/delete, `status`, `--parent/--detach/-f` re-parenting, link types and reciprocals, tag add/remove/rename in both syntaxes                                                                                                  |
| `todo`                                        | 33            | list/add/set/next, text/JSON, id-prefix lookup, error paths                                                                                                                                                                        |
| `run`                                         | 13            | env injection, stdin/stdout passthrough, exit-code reporting, errors                                                                                                                                                               |
| `import`                                      | 13            | `-p`, `--rm`, `--scope-to-tag/--tag-name`, `--allow-missing`, idempotence, errors (`-b` only its non-git error)                                                                                                                    |
| `scopes` (+ top-level `add-parent`)           | 62            | git repos built in `setup.sh`: list/add/add-parent/rename/delete/assign/export/sync-worktrees (incl. a real `git worktree`), JSON, errors                                                                                          |
| `scoped`                                      | 25            | regular commands in a multi-scope git repo (`--scope`, `--all-scopes`, tag/scope patterns, `-C` into a child scope, cross-scope ids/links/parents)                                                                                 |
| `agent`                                       | 13            | `claude`, `codex`, `agent`, `create --claude/--codex`, `checkpoint/done --claude` against a stub binary on a relative `PATH=./bin:/usr/bin:/bin` (first 100 chars of each argv + `WORKLOG_TASK_ID` asserted, not the whole prompt) |
| `misc`                                        | 7             | `agent-instructions [--mandatory]`, `-C`/`--worklog-dir` combinations, usage error                                                                                                                                                 |

### Fixtures and normalizers

- `fixtures/wl-project` (7 tasks: started/ready/created/done/cancelled, subtask, traces, checkpoint, todos, metadata, unicode; fixed 25-char ids so prefixes like `9n3ksy` can be used in `args`), `wl-links` (dependencies, blocks, related, parent/subtasks, todos), `wl-scoped` (root + `services/api` + `services/web` scopes), `wl-import` (`src/` and `dst/` worklogs), `wl-purge` (done tasks past the 30-day TTL). Fixture dates are 2020 (and 2099 for `done_at` that must never be purged) so that "today" can never collide with fixture data.
- Fixed ids make read-only cases need **no normalizer at all**. Mutating cases use `now-iso,now-short,wl-newid` (`today` when `-t T10:00` produces today's date, `uuid` unused so far). New in `lib/normalize.sh` (added, nothing existing touched): `now-iso`, `now-short`, `today` (only the current UTC date, or yesterday's across midnight, becomes `<NOW>`/`<TODAY>`) and `wl-newid`.
- `wl-newid` only masks ids that are **absent** from the post-setup snapshot (task ids from every `index.json`, todo ids from task files), as `<NEWID>` (25 chars), `<NEWID6>` (alone on a line or `"id":"xxxxxx"`), `<NEWTODO>`. Use it instead of `wl-id` whenever fixture ids are in play.

### Caveats of the normalizers (what they could hide)

- `wl-newid` cannot see the _content_ of a new task: the file name `.worklog/tasks/<random>.md` cannot be declared in `files` (no globs), so `create`-like cases use `ignore_changes: [".worklog/tasks/*"]` and assert `index.json`, the other touched files, stdout and the exit code, **not the new task's markdown** (frontmatter, `uid`, `# TODO` block, entries). Its serialisation is only exercised indirectly (`show`/`traces` on fixtures written by the same code). A runner extension to allow `files` globs would close this.
- A bare 6-char or 7-char alphanumeric word alone on a stdout line is masked as an id by `wl-newid`, and a 24-26 char `[0-9a-z]` token is always masked.
- `now-iso`/`now-short` accept any time of day, so they hide a wrong clock but not a wrong date/format; a wrong timezone offset is not caught for `+00:00` (the runner forces `TZ=UTC`). Midnight UTC straddling is tolerated by accepting yesterday.
- Cases with `check_stdout: false`/`check_stderr: false` (usage errors from the CLI library, `--purge-ttl 0`) only assert the exit code.
- Only the first stderr line containing `error` is compared, so error _messages_ (second line) are not part of the contract; JSON error payloads are, because they are printed on one line.

### Not covered

- `-P/--desc-from-clipboard`, `--append-desc-from-clipboard` (needs a system clipboard), `completions`, `--help`, `--version` (formatting/version are not contract).
- Interactive prompts and the pager on a TTY (none in the runner); `--pager` is only checked for its non-TTY fallback.
- `import -b <branch>` happy path (needs a second git worktree with a `.worklog`; only the not-a-repo error is covered) and `scopes add --worktree/--ref`.
- Real `claude`/`codex` processes (stubbed); the full synthesis prompts are not compared.
- Concurrency/locking, big worklogs, `WORKLOG_DEPTH_LIMIT`, purge TTL boundary (exact day arithmetic).

### Deno behaviours recorded as parity that look like bugs (cases carry a `note`)

- `scopes assign` into a scope created by `scopes add` leaves an `index.json` without `version`; the next read triggers "Migrating worklog to v2" which **overwrites the task name with its description and clears `started_at`** (`scoped/fresh-scope-first-read-migrates-and-corrupts`, `scopes/add-then-assign-index-without-version`).
- `import` writes index entries without `tags`, `links` and `parent` (task files are complete), so imported subtasks appear top-level in `list`.
- `meta <id>` (read-only) rewrites the task file adding `metadata: {}`.
- `todo set <task> <todo> text=...` stores a `[text:: ..]` field instead of renaming; `status=<invalid>` prints "todo updated" and changes nothing; the task-id argument of `todo set` is not validated.
- `wl run` exits 0 whatever the child's exit code and ignores `--json`; `run --create` always fails ("Create task function not available").
- `wl claude <id> -- <args>` does not forward the args; `--purge-ttl 0` and a `--worklog-dir` with a missing parent dir end in an uncaught exception with a stack trace (exit 1).
- `list <pattern>` and `--scope/--all-scopes` are silently ignored outside git; `summary --since garbage` and `meta --delete`/`meta <key>` for a missing key succeed silently; `scopes rename a b` accepts an id already in use; `cancel` ignores the reason and does not bump `status_updated_at`; `create` works without prior `init` while every other command fails with `not_initialized`.

## Additions of 2026-11-10 (wl in Rust)

- The Rust `worklog` passes the 524 `wl` cases (488 parity, 36 new-spec). 15 former `parity` cases are `new-spec` now, one per Deno defect fixed (`spec_row` = `worklog.md D<n>`, see [`docs/specs/worklog.md`](../../docs/specs/worklog.md)): `scopes/add-*` (6) and `scoped/fresh-scope-first-read-migrates-and-corrupts` (D1, D2), `run/exit-code-not-propagated` and `run/json-flag-ignored` (D3), `run/create-unavailable` (D4), `agent/claude-passthrough-args` (D5), `traces-update/kind`, `kind-json`, `untyped-trace` (D6), `list/err-purge-ttl-zero` (D7). Two cases are new (D7): `init/worklog-dir-no-parent`, `misc/worklog-dir-no-parent-read`.
- `.gitignore` ignored every `.worklog/` directory, including the `expected/files/.worklog/**` of the `wl` cases (372 files were never committed). `!/tests/blackbox/cases/**/.worklog/` fixes it.
- Scope scanning is sorted by name (D8): the Deno order depended on the file system. `scopes/list`, `list-json`, `list-sub`, `list-sub-json` and `list-refresh` are `new-spec`.
- Second round (same day): D9 to D14 (see the spec). `meta/list-empty*` (D9), `import/*` (7) with `scopes/add-assign` and the fresh-scope case (D10), `todo/set-text` (D11), `todo/set-status-invalid` (D12) became `new-spec`; `scoped/list-tag-and-scope-named-alike`, `scoped/list-tag-on-scope-entry` (D13) and `scoped/show-does-not-add-scope-tags` (D14) are new. The expected files of these cases were written by hand from the spec (index entries rebuilt from the fixture's source index, hand-edited task files, hand-typed outputs); the D1 to D8 cases of the first round were recorded from the Rust binary and then checked against independent computations (fixture diffs, `jq` assertions on the new indexes).

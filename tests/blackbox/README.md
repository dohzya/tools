# Black-box CLI test suite

Runtime-agnostic characterization suite for the CLIs of this repo (`md`, `wl`, `recap`, `dz-review`). It only needs `bash`, `jq`, and the binary under test, so it outlives the TypeScript code and runs unchanged against a Deno, Bun or Rust build.

```bash
# Reference = current Deno code of this checkout (not the JSR-installed md/wl)
tests/blackbox/run.sh --ref deno --parity-only      # must be 100 %
tests/blackbox/run.sh --ref deno                    # also lists the new-spec cases the TS still fails

# Any other implementation
CMD_MD=/path/to/md CMD_RECAP=/path/to/recap tests/blackbox/run.sh
```

| Option                              | Effect                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ref deno`                        | Source `refs/deno.sh`: sets `CMD_*` to the wrappers running `packages/tools/*/cli.ts`                                                                                             |
| `--tool md\|wl\|recap\|dz-review`   | Only that tool (tools without a `CMD_*` are skipped)                                                                                                                              |
| `--only GLOB`                       | Case id glob, e.g. `'md/write/*'` (exact or glob, not substring)                                                                                                                  |
| `--parity-only` / `--new-spec-only` | Select one behaviour class                                                                                                                                                        |
| `--record`                          | Regenerate `expected/` from the given binary (use `--ref deno`). Never automatic: review with `git diff`. `new-spec` cases are skipped (hand-written) unless `--include-new-spec` |
| `-v`, `--keep`                      | Show stdout diffs; keep the temp dirs                                                                                                                                             |

`--ref rust` sources `refs/rust.sh` (cargo debug binaries; `BB_RUST_PROFILE=release` for the release ones). `refs/rust/dz-review` runs `critique` under the legacy identity (`CRITIQUE_COMPAT_DZ_REVIEW=1`, see [`critique.md`](../../docs/specs/critique.md)) unless a case sets that variable to an empty string. `promote-new-spec.sh "<note>" <case-id>...` turns reviewed parity cases into `new-spec` cases and re-records them from the implementation under test.

`CMD_*` values may contain spaces (`CMD_MD="bun run src/cli.ts"`). Exit status is non-zero if any selected case fails. Output: one `PASS|FAIL id [class]` line per case, then per-class totals and the list of failures.

## Layout

```
run.sh  lib/normalize.sh  refs/deno.sh refs/deno/{md,wl,recap,dz-review}
fixtures/<name>/...            input trees, never modified (copied per case)
cases/<tool>/<group>/<name>/
    case.json                  the case (below)
    stdin                      optional, fed on stdin (default: /dev/null)
    setup.sh                   optional, run in the work dir before the command
    expected/stdout exit stderr1 files/<path>
```

## case.json

| Field                           | Meaning                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tool`                          | `md`, `wl`, `recap`, `dz-review`                                                                                      |
| `args`                          | argv array (no shell involved)                                                                                        |
| `fixture`                       | dir under `fixtures/` copied to `work/`                                                                               |
| `cwd`                           | working dir relative to `work/` (default `.`)                                                                         |
| `env`                           | extra env vars (object)                                                                                               |
| `files`                         | files compared after the run; an absent `expected/files/<f>` means "must not exist"                                   |
| `ignore_changes`                | globs of paths allowed to change without being declared (e.g. `.worklog/*`)                                           |
| `normalize`                     | normalizers applied to stdout, stderr1 and `files` (below); `sed`: extra `s///` expressions (ERE)                     |
| `behavior`                      | `parity` (default) or `new-spec`                                                                                      |
| `spec_row`                      | for `new-spec`: row number(s) of `docs/specs/markdown-sections.md`                                                    |
| `check_stdout` / `check_stderr` | `false` to skip: no-op writes (message unspecified), usage errors (only exit code 2 is portable across CLI libraries) |
| `note`                          | free text                                                                                                             |

What is asserted for every case: stdout bytes, exit code, first stderr line containing `error` (case-insensitive; banners, hints and stack traces are not part of the contract), the declared `files`, and that **nothing else** changed in the work dir (compared with a snapshot taken after `setup.sh`). Read-only commands therefore also prove they do not write.

## Environment given to the command

Fresh temp dir per case: `work/` (fixture copy, cwd) and `home/` (`HOME`). `TZ=UTC`, `LC_ALL=C.UTF-8`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CEILING_DIRECTORIES` set (no git discovery above the run dir). Unset: `NO_COLOR`, `FORCE_COLOR`, `WORKLOG_TASK_ID`, `XDG_CONFIG_HOME`, `CLAUDECODE`, `AGENT`, `CODEX_HOME`. stdin is `/dev/null` or the `stdin` file; stdout/stderr are pipes (no TTY, so no pager, no prompt, no colors). 60 s timeout. `setup.sh` sees `CMD_*`, so it can prepare state with the tools themselves (see `wl/smoke-*`).

## Normalizers

`tmpdir` is always on: `<WORK>`, `<HOME>`, `<TMP>`. Others are opt-in via `normalize`: `ansi`, `iso-ts` (`2026-10-29T14:43:00Z`), `short-ts` (`2026-10-29 14:43`, used by `wl`), `date`, `git-hash` (7-40 hex), `wl-id` (24-26 char ids anywhere, 6-char short ids only at line start). `wl` has **no** env var to fix the clock or the id generator (checked in `packages/tools/worklog`: only `WORKLOG_TASK_ID`, `WORKLOG_DEPTH_LIMIT`, `WORKLOG_PURGE_TTL_DAYS`), so normalizers are needed; `wl trace --timestamp` can fix a trace time but not ids. Git cases fix author, committer and dates in `setup.sh` (hashes are then stable, normalized anyway).

## Behaviour classes

- `parity`: expected output recorded from the Deno reference. Any implementation must match; the Deno reference must pass 100 %.
- `new-spec`: touches a decision of [`docs/specs/markdown-sections.md`](../../docs/specs/markdown-sections.md) where the TS differs. Expected output is NOT the TS output. Sources: the Bun spike (`experiment/md-ast-js`, used as second oracle then reviewed) for `outline|read|write|append|remove`, hand-written for the rest (`write` no-op, frontmatter edit/refusal). The Deno reference fails these on purpose; `--parity-only` ignores them. Fixing the TS is not required.

## Coverage (Deno reference, all green)

| Tool        | Cases                    | Notes                                                                                                         |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `md`        | 264 parity + 78 new-spec | includes `ref` / `resolve` / `compare` / `rank` (MRFI; the last two are new-spec only, hand-written)          |
| `recap`     | 43 parity + 8 new-spec   | new-spec: dotenv, relative section cwd, ref scope, alias-only lists ([`recap.md`](../../docs/specs/recap.md)) |
| `dz-review` | 553 parity + 48 new-spec | ids, reference map, drift, sessions, git state dir, CR/CRLF edits, `agent apply --remove`                     |
| `wl`        | 488 parity + 36 new-spec | every command; scopes use real `git init` / `git worktree`; `claude`/`codex` are stubbed                      |

Details and known Deno defects pinned as `parity` (grep `note` in `case.json`): [COVERAGE.md](COVERAGE.md). The full `wl` suite takes ~15 min sequentially (one Deno boot per case): run groups in parallel with `--only 'wl/<group>/*'`.

## Not covered yet (TODO)

- `md outline --mrfi`, and MRFI vectors generated from the TS for the Rust crates (to discuss when `mrfi` is ported).
- The markdown body of tasks created by `wl` (random file name, `files` has no globs): create-like cases assert `index.json`, stdout and exit code only.
- `--help`, `--version`, `completions`: formatting is CLI-library specific, not part of the contract.
- Clipboard options of `wl`, interactive paths (prompts, pager) need a TTY or a system clipboard; untestable here by design.

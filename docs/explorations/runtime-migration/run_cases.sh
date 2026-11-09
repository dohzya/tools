#!/usr/bin/env bash
# Replays cases.json against an implementation of `md read` / `wl list` / `wl show`.
#
# Usage:
#   ./run_cases.sh "<impl command>"            # compare against expected/
#   ./run_cases.sh --record "<impl command>"   # (re)generate expected/ + cases.json
#                                              # fields from the given implementation
#   ./run_cases.sh "<impl command>" id1 id2    # only run the listed case ids
#
# <impl command> is invoked as   <impl command> <tool> <args...>
# with <tool> in {md, wl}; e.g.
#   ./run_cases.sh "bun run /abs/path/cli.ts"      -> bun run /abs/path/cli.ts md read f.md 074ff574
#   ./run_cases.sh "$PWD/tools/ref-impl"           -> reference TS (Deno), must give 100 %
# The command string is split on spaces (no quoting): use paths without spaces.
#
# Each case runs in a FRESH copy of fixtures/ (the source is never modified),
# with cwd = <copy>/<case.cwd>, NO_COLOR=1, TZ=UTC, WORKLOG_TASK_ID/FORCE_COLOR unset,
# stdin closed (/dev/null), stdout/stderr piped (not a TTY).
# Checked per case: exact stdout bytes, exit code, and (when expected exit != 0)
# the first stderr line starting with `error:` or `{"error"`.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORD=0
if [ "${1:-}" = "--record" ]; then RECORD=1; shift; fi
IMPL="${1:?usage: run_cases.sh [--record] \"<impl command>\" [case ids...]}"; shift
ONLY=("$@")
read -ra IMPL_ARR <<<"$IMPL"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

CASES="$HERE/cases.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$HERE/expected"

want() { # is case id selected?
  [ "${#ONLY[@]}" -eq 0 ] && return 0
  local x; for x in "${ONLY[@]}"; do [ "$x" = "$1" ] && return 0; done
  return 1
}

pass=0; fail=0; total=0
n=$(jq length "$CASES")
NEWCASES="$WORK/cases.new.json"; cp "$CASES" "$NEWCASES"

for ((i = 0; i < n; i++)); do
  id=$(jq -r ".[$i].id" "$CASES")
  want "$id" || continue
  tool=$(jq -r ".[$i].tool" "$CASES")
  cwd=$(jq -r ".[$i].cwd" "$CASES")
  outfile=$(jq -r ".[$i].expected_stdout_file" "$CASES")
  exp_rc=$(jq -r ".[$i].expected_exit_code" "$CASES")
  exp_err=$(jq -r ".[$i].expected_stderr_first_line // \"\"" "$CASES")
  mapfile -t args < <(jq -r ".[$i].args[]" "$CASES")

  run="$WORK/run-$i"; mkdir -p "$run"
  cp -a "$HERE/fixtures" "$run/fixtures"
  (
    cd "$run/fixtures/$cwd" || exit 99
    unset WORKLOG_TASK_ID FORCE_COLOR
    export NO_COLOR=1 TZ=UTC GIT_CEILING_DIRECTORIES="$run"
    timeout 60 "${IMPL_ARR[@]}" "$tool" "${args[@]}" \
      >"$run/stdout" 2>"$run/stderr" </dev/null
    echo $? >"$run/rc"
  )
  rc=$(cat "$run/rc" 2>/dev/null || echo 99)
  err1=$(grep -m1 -E '^(error:|\{"error")' "$run/stderr" || true)
  total=$((total + 1))

  if [ "$RECORD" -eq 1 ]; then
    cp "$run/stdout" "$HERE/$outfile"
    jq --argjson i "$i" --argjson rc "$rc" --arg e "$err1" \
      '.[$i].expected_exit_code=$rc | .[$i].expected_stderr_first_line=$e' \
      "$NEWCASES" >"$NEWCASES.t" && mv "$NEWCASES.t" "$NEWCASES"
    echo "RECORDED $id (exit $rc)"
    pass=$((pass + 1))
    continue
  fi

  problems=()
  cmp -s "$run/stdout" "$HERE/$outfile" || problems+=("stdout differs")
  [ "$rc" = "$exp_rc" ] || problems+=("exit code $rc != expected $exp_rc")
  if [ "$exp_rc" != "0" ] && [ "$err1" != "$exp_err" ]; then
    problems+=("stderr line '$err1' != expected '$exp_err'")
  fi

  if [ "${#problems[@]}" -eq 0 ]; then
    echo "PASS $id"; pass=$((pass + 1))
  else
    echo "FAIL $id: ${problems[*]}"; fail=$((fail + 1))
    if cmp -s "$run/stdout" "$HERE/$outfile"; then :; else
      diff <(cat "$HERE/$outfile") "$run/stdout" | head -n 15 | sed 's/^/    /'
    fi
  fi
done

if [ "$RECORD" -eq 1 ]; then
  [ "${#ONLY[@]}" -eq 0 ] && cp "$NEWCASES" "$CASES"
  echo "recorded $total cases"
  exit 0
fi
echo "----"
echo "TOTAL: $pass/$total passed ($fail failed)"
[ "$fail" -eq 0 ]

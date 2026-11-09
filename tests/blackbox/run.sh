#!/usr/bin/env bash
# Runtime-agnostic black-box runner. See README.md.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/normalize.sh
source "$ROOT/lib/normalize.sh"

TOOL="" ONLY="" RECORD=0 RECORD_NEW=0 CLASS="" REF="" VERBOSE=0 KEEP=0
usage() { sed -n '2,/^$/p' "$ROOT/README.md" >/dev/null; cat <<U
usage: run.sh [--ref deno] [--tool md|wl|recap|dz-review] [--only GLOB]
              [--parity-only | --new-spec-only] [--record [--include-new-spec]]
              [-v] [--keep]
Binaries: CMD_MD CMD_WL CMD_RECAP CMD_DZ_REVIEW (or --ref deno).
U
}
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift ;;
    --tool) TOOL="$2"; shift ;;
    --only) ONLY="$2"; shift ;;
    --parity-only) CLASS=parity ;;
    --new-spec-only) CLASS=new-spec ;;
    --record) RECORD=1 ;;
    --include-new-spec) RECORD_NEW=1 ;;
    -v) VERBOSE=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
[ -n "$REF" ] && { source "$ROOT/refs/$REF.sh" || exit 2; }

export CMD_MD CMD_WL CMD_RECAP CMD_DZ_REVIEW # setup.sh scripts may call the tools
TMPROOT="$(mktemp -d)"; TMPROOT="$(cd "$TMPROOT" && pwd -P)"
[ "$KEEP" -eq 1 ] || trap 'rm -rf "$TMPROOT"' EXIT

tool_cmd() { # sets CMD_ARR for a tool, or returns 1
  local var
  case "$1" in
    md) var="${CMD_MD:-}" ;; wl) var="${CMD_WL:-}" ;;
    recap) var="${CMD_RECAP:-}" ;; dz-review) var="${CMD_DZ_REVIEW:-}" ;;
    *) return 1 ;;
  esac
  [ -n "$var" ] || return 1
  read -ra CMD_ARR <<<"$var"
}

# execute_case <case_dir> <run_dir>: runs the case, leaves actual/{stdout,exit,stderr1,files/*}
execute_case() {
  local cdir="$1" run="$2" tool fixture cwd
  tool=$(jq -r .tool "$cdir/case.json")
  fixture=$(jq -r '.fixture // ""' "$cdir/case.json")
  cwd=$(jq -r '.cwd // "."' "$cdir/case.json")
  mkdir -p "$run/work" "$run/home" "$run/actual/files"
  [ -n "$fixture" ] && cp -a "$ROOT/fixtures/$fixture/." "$run/work/"
  local envs=() line
  while IFS= read -r line; do envs+=("$line"); done < <(jq -r '.env // {} | to_entries[] | "\(.key)=\(.value)"' "$cdir/case.json")
  local base_env=(HOME="$run/home" TZ=UTC LC_ALL=C.UTF-8 GIT_CEILING_DIRECTORIES="$run"
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 BB_REAL_HOME="$HOME"
    # No background git maintenance: it races with the undeclared-change check.
    GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=gc.auto GIT_CONFIG_VALUE_0=0
    GIT_CONFIG_KEY_1=maintenance.auto GIT_CONFIG_VALUE_1=false)
  local unset_env=(-u NO_COLOR -u FORCE_COLOR -u WORKLOG_TASK_ID -u XDG_CONFIG_HOME -u CLAUDECODE -u AGENT -u CODEX_HOME)
  if [ -f "$cdir/setup.sh" ]; then
    (cd "$run/work" && env "${unset_env[@]}" "${base_env[@]}" bash "$cdir/setup.sh") >"$run/setup.log" 2>&1 \
      || { echo "setup failed" >>"$run/setup.log"; return 3; }
  fi
  cp -a "$run/work" "$run/snapshot"
  local args=()
  mapfile -d '' args < <(jq -j '.args[] | (., "\u0000")' "$cdir/case.json")
  local stdin=/dev/null; [ -f "$cdir/stdin" ] && stdin="$cdir/stdin"
  tool_cmd "$tool" || return 4
  (cd "$run/work/$cwd" && timeout 60 env "${unset_env[@]}" "${base_env[@]}" "${envs[@]}" \
      "${CMD_ARR[@]}" "${args[@]}" >"$run/raw.stdout" 2>"$run/raw.stderr" <"$stdin"; echo $? >"$run/actual/exit")
  local norm=() n
  while IFS= read -r n; do norm+=("$n"); done < <(jq -r '(.normalize // [])[], ((.sed // [])[] | "sed:" + .)' "$cdir/case.json")
  normalize "$run" "${norm[@]}" <"$run/raw.stdout" >"$run/actual/stdout"
  # Only the first "error" line of stderr is part of the contract (usage banners,
  # hints and stack traces are not). `"check_stderr": false` drops it for usage
  # errors, where only the exit code is stable across CLI libraries.
  if [ "$(jq -r 'if has("check_stderr") then .check_stderr else true end' "$cdir/case.json")" = true ]; then
    { grep -m1 -iE 'error' "$run/raw.stderr" || true; } \
      | sed -E 's/^[[:space:]]+//' | normalize "$run" "${norm[@]}" >"$run/actual/stderr1"
  else : >"$run/actual/stderr1"; fi
  # Files: those declared, plus anything that changed vs the post-setup snapshot (undeclared => FAIL).
  local f
  while IFS= read -r f; do
    [ -f "$run/work/$f" ] && { mkdir -p "$run/actual/files/$(dirname "$f")"; normalize "$run" "${norm[@]}" <"$run/work/$f" >"$run/actual/files/$f"; }
  done < <(jq -r '(.files // [])[]' "$cdir/case.json")
  : >"$run/changed"
  while IFS= read -r f; do
    cmp -s "$run/work/$f" "$run/snapshot/$f" || echo "$f" >>"$run/changed"
  done < <(cd "$run/work" && find . -type f | sed 's#^\./##')
  while IFS= read -r f; do
    [ -e "$run/work/$f" ] || echo "$f" >>"$run/changed"
  done < <(cd "$run/snapshot" && find . -type f | sed 's#^\./##')
  return 0
}

pass=0 fail=0 skip=0; declare -A P F; P[parity]=0 P[new-spec]=0 F[parity]=0 F[new-spec]=0
failed=()
mapfile -t CASES < <(find "$ROOT/cases" -name case.json | sort)
for cj in "${CASES[@]}"; do
  cdir="$(dirname "$cj")"; id="${cdir#"$ROOT/cases/"}"
  tool=$(jq -r .tool "$cj"); class=$(jq -r '.behavior // "parity"' "$cj")
  [ -n "$TOOL" ] && [ "$tool" != "$TOOL" ] && continue
  [ -n "$ONLY" ] && [[ "$id" != $ONLY ]] && continue
  [ -n "$CLASS" ] && [ "$class" != "$CLASS" ] && continue
  if ! tool_cmd "$tool"; then echo "SKIP  $id (no CMD for $tool)"; skip=$((skip+1)); continue; fi
  run="$TMPROOT/$(echo "$id" | tr / _)"; mkdir -p "$run"
  execute_case "$cdir" "$run"; rc=$?
  if [ $rc -ne 0 ]; then
    echo "FAIL  $id [$class] (harness rc=$rc) $(cat "$run/setup.log" 2>/dev/null | head -3)"
    F[$class]=$((F[$class]+1)); failed+=("$id"); continue
  fi
  exp="$cdir/expected"
  if [ "$RECORD" -eq 1 ]; then
    if [ "$class" = new-spec ] && [ "$RECORD_NEW" -eq 0 ]; then echo "KEEP  $id [new-spec: hand-written, not recorded]"; continue; fi
    rm -rf "$exp"; mkdir -p "$exp"
    cp "$run/actual/stdout" "$run/actual/exit" "$run/actual/stderr1" "$exp/"
    [ -n "$(ls -A "$run/actual/files")" ] && cp -a "$run/actual/files" "$exp/files"
    echo "REC   $id (exit $(cat "$run/actual/exit"))"; P[$class]=$((P[$class]+1)); continue
  fi
  problems=()
  [ -d "$exp" ] || problems+=("no expected/ (run --record)")
  if [ "$(jq -r 'if has("check_stdout") then .check_stdout else true end' "$cj")" = true ]; then
    cmp -s "$run/actual/stdout" "$exp/stdout" || problems+=("stdout differs")
  fi
  [ "$(cat "$run/actual/exit")" = "$(cat "$exp/exit" 2>/dev/null)" ] || problems+=("exit $(cat "$run/actual/exit") != $(cat "$exp/exit" 2>/dev/null)")
  cmp -s "$run/actual/stderr1" "$exp/stderr1" || problems+=("stderr first line differs")
  declared=$(jq -r '(.files // [])[]' "$cj")
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ -f "$exp/files/$f" ]; then
      cmp -s "$run/actual/files/$f" "$exp/files/$f" || problems+=("file $f differs")
    else
      [ -e "$run/work/$f" ] && problems+=("file $f should not exist")
    fi
  done <<<"$declared"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    grep -qxF "$f" <<<"$declared" && continue
    ign=0; while IFS= read -r pat; do [ -n "$pat" ] && [[ "$f" == $pat ]] && ign=1; done < <(jq -r '(.ignore_changes // [])[]' "$cj")
    [ $ign -eq 1 ] || problems+=("undeclared change: $f")
  done <"$run/changed"
  if [ ${#problems[@]} -eq 0 ]; then
    echo "PASS  $id [$class]"; P[$class]=$((P[$class]+1))
  else
    echo "FAIL  $id [$class]: ${problems[*]}"; F[$class]=$((F[$class]+1)); failed+=("$id")
    if [ "$VERBOSE" -eq 1 ]; then
      diff <(cat "$exp/stdout" 2>/dev/null) "$run/actual/stdout" | head -15 | sed 's/^/      /'
      for f in "${problems[@]}"; do :; done
    fi
  fi
done

[ "$RECORD" -eq 1 ] && { echo "recorded: parity=${P[parity]} new-spec=${P[new-spec]} (review with git diff)"; exit 0; }
echo
for c in parity new-spec; do
  t=$((P[$c]+F[$c])); [ "$t" -gt 0 ] && echo "$c: ${P[$c]}/$t passed"
done
echo "TOTAL: $((P[parity]+P[new-spec])) passed, $((F[parity]+F[new-spec])) failed, $skip skipped"
[ ${#failed[@]} -gt 0 ] && { echo "failed:"; printf '  %s\n' "${failed[@]}"; }
[ $((F[parity]+F[new-spec])) -eq 0 ]

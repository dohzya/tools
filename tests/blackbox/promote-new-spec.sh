#!/usr/bin/env bash
# Turns parity cases into reviewed `new-spec` cases and re-records their
# expected/ from the implementation under test (any --ref, default rust).
# Usage: promote-new-spec.sh "<note>" <case-id>...   (ids as printed by run.sh)
# Review the result with `git diff` / `git status`: this is a deliberate act,
# never a way to hide a regression.
set -euo pipefail
cd "$(dirname "$0")"
note=$1; shift
for id in "$@"; do
  tool=${id%%/*}; rest=${id#*/}
  cj="cases/$tool/$rest/case.json"
  jq --arg n "$note" '.behavior="new-spec" | .note=$n' "$cj" > "$cj.tmp" && mv "$cj.tmp" "$cj"
  ./run.sh --ref "${BB_REF:-rust}" --tool "$tool" --only "$id" --record --include-new-spec | tail -1
done

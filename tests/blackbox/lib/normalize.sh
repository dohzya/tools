# Normalizers: stdin -> stdout. Usage: normalize <run-dir> <name>...
# `tmpdir` is always applied (the per-case temp dir is never part of the contract).
normalize() {
  local run="$1"; shift
  local data; data="$(mktemp)"; cat >"$data"; printf x >>"$data"
  local n
  # Always: temp paths. Longest first (work is inside run).
  sed -e "s#$run/work#<WORK>#g" -e "s#$run/home#<HOME>#g" -e "s#$run#<TMP>#g" "$data" >"$data.2"; mv "$data.2" "$data"
  for n in "$@"; do
    case "$n" in
      tmpdir) ;;
      ansi) sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]/<ANSI>/g' "$data" >"$data.2" ;;
      iso-ts) sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?/<TS>/g' "$data" >"$data.2" ;;
      short-ts) sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}/<TS>/g' "$data" >"$data.2" ;;
      date) sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/<DATE>/g' "$data" >"$data.2" ;;
      git-hash) sed -E 's/\b[0-9a-f]{7,40}\b/<HASH>/g' "$data" >"$data.2" ;;
      # wl ids: 26-char full ids anywhere; 6-char short ids only at line start or
      # in "id":"..." (a bare \b[0-9a-z]{6}\b would also eat 6-letter words)
      wl-id) sed -E 's/\b[0-9a-z]{24,26}\b/<LONGID>/g; s/^[0-9a-z]{6}( |$)/<ID>\1/' "$data" >"$data.2" ;;
      # --- wl (clock/random output); only match the *current* UTC date so that
      # fixture timestamps stay asserted byte-for-byte. Day before also accepted
      # (a case that straddles midnight UTC).
      now-iso) _d="$(date -u +%F)"; _y="$(date -u -d 'yesterday' +%F 2>/dev/null || echo none)"
        sed -E "s/($_d|$_y)T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|\+00:00)?/<NOW>/g" "$data" >"$data.2" ;;
      now-short) _d="$(date -u +%F)"; _y="$(date -u -d 'yesterday' +%F 2>/dev/null || echo none)"
        sed -E "s/($_d|$_y) [0-9]{2}:[0-9]{2}/<NOW>/g" "$data" >"$data.2" ;;
      today) _d="$(date -u +%F)"; _y="$(date -u -d 'yesterday' +%F 2>/dev/null || echo none)"
        sed -E "s/($_d|$_y)/<TODAY>/g" "$data" >"$data.2" ;;
      uuid) sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<UUID>/g' "$data" >"$data.2" ;;
      # wl-newid: like wl-id but only for ids NOT present in the post-setup
      # snapshot (task ids from every index.json, todo ids from task files), so
      # a mutation hitting the wrong pre-existing task stays visible. Covers
      # 25-char task ids, the 6-char short id printed alone on a line or as
      # "id":"xxxxxx", and 7-char todo ids ([id:: X] ^X, bare line, "id":"X").
      wl-newid) _wl_newid "$run" "$data" >"$data.2" ;;
      sed:*) sed -E "${n#sed:}" "$data" >"$data.2" ;;
      *) echo "unknown normalizer: $n" >&2; return 2 ;;
    esac
    mv "$data.2" "$data"
  done
  # strip the sentinel newline we appended to preserve trailing newlines
  head -c -1 "$data"; rm -f "$data" "$data.2"
}

# Helper for the wl-newid normalizer: <run-dir> <data-file> -> stdout
_wl_newid() {
  local run="$1" data="$2" id i=0 prot="" rest="" tid
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    prot+="s/$id/@@K${i}@@/g;s/^${id:0:6}\$/@@S${i}@@/;s/\"id\":\"${id:0:6}\"/\"id\":\"@@S${i}@@\"/g;"
    rest+="s/@@K${i}@@/$id/g;s/@@S${i}@@/${id:0:6}/g;"
    i=$((i+1))
  done < <(find "$run/snapshot" -name index.json -path '*.worklog*' -print0 | xargs -0 -r jq -r '(.tasks // empty) | keys[]' 2>/dev/null | sort -u)
  while IFS= read -r tid; do
    [ -z "$tid" ] && continue
    prot+="s/$tid/@@T${i}@@/g;"; rest+="s/@@T${i}@@/$tid/g;"; i=$((i+1))
  done < <(grep -rhoE '\^[A-Za-z0-9]{7}$' "$run/snapshot" 2>/dev/null | cut -c2- | sort -u)
  sed -E "${prot}
    s/\b[0-9a-z]{24,26}\b/<NEWID>/g
    s/^[0-9a-z]{6}\$/<NEWID6>/
    s/\"id\":\"[0-9a-z]{6}\"/\"id\":\"<NEWID6>\"/g
    s/\[id:: [A-Za-z0-9]{7}\] \^[A-Za-z0-9]{7}/[id:: <NEWTODO>] ^<NEWTODO>/g
    s/^[A-Za-z0-9]{7}\$/<NEWTODO>/
    s/\"id\":\"[A-Za-z0-9]{7}\"/\"id\":\"<NEWTODO>\"/g
    ${rest}" "$data"
}

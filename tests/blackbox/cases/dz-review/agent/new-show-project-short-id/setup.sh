$CMD_DZ_REVIEW session start doc.md >/dev/null
# Another file's id sharing its first 8 characters with the shown item
# (rvw_5SUMpHBf6V2).
jq -c '.entries["rvw_5SUMpHBfzzz"] = {"file":"gone.md","range":{"startLine":1,"endLine":1},"mrfi":"~{v0;r=1:1-1:3}"}' \
  .dz-review/reference-map.json > map.tmp && mv map.tmp .dz-review/reference-map.json

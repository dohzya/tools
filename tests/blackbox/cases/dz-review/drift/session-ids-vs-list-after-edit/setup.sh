$CMD_DZ_REVIEW session start doc.md >/dev/null; { printf "inserted\n\n"; cat doc.md; } > d.tmp && mv d.tmp doc.md

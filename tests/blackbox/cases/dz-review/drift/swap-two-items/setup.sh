$CMD_DZ_REVIEW list doc.md >/dev/null; awk 'NR==3{h=$0;next} NR==5{print;print h;next} {print}' doc.md > d.tmp && mv d.tmp doc.md

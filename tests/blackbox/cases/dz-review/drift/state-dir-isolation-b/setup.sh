$CMD_DZ_REVIEW --state-dir state-a list doc.md >/dev/null; sed "s/Title/Titre/" doc.md > d.tmp && mv d.tmp doc.md

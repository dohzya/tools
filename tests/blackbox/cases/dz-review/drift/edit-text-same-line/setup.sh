f(){ sed "$@" doc.md > d.tmp && mv d.tmp doc.md; }; $CMD_DZ_REVIEW list doc.md >/dev/null; f 's/Please say whether sources are stored too/Please state whether sources are stored, too/'

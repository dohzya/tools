f(){ sed "$@" doc.md > d.tmp && mv d.tmp doc.md; }; f 's/Please say whether sources are stored too/Please state whether sources are stored, too/'

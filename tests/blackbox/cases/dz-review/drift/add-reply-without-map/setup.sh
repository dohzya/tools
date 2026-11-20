f(){ sed "$@" doc.md > d.tmp && mv d.tmp doc.md; }; f 's/@me Please say whether sources are stored too. ??}/@me Please say whether sources are stored too. @agent Done. ??}/'

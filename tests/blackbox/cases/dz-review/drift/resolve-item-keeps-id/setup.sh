f(){ sed "$@" doc.md > d.tmp && mv d.tmp doc.md; }; $CMD_DZ_REVIEW list doc.md >/dev/null; f 's/@agent Fixed. @me ok ??}/@agent Fixed. @me OK thanks ??}/'

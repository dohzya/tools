f(){ sed "$@" doc.md > d.tmp && mv d.tmp doc.md; }; f '1a\
\
Inserted line above.'

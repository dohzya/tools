f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f '2a\
\
Inserted paragraph one.\
\
Inserted paragraph two.'

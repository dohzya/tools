f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f '$a\
\
<!-- ^stable-id -->\
Another passage.'

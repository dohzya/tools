f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f -e '5d' -e '7a\
<!-- ^stable-id -->'

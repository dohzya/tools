f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f -e '6{h;d}' -e '$G'

f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f 's/permet/permets/'

f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f '/stable-id/d'

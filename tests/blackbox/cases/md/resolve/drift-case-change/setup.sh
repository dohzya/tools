f(){ sed "$@" source.md > s.tmp && mv s.tmp source.md; }; f '6s/SAS/sas/'

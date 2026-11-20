# Two stored locators resolve over the item: a coarse one (lines 1-3) stored
# first, and the item's own (line 3). Both ranges are stale so only pass 2
# can adopt them.
printf '# T\n\nonly {>> b <<}\n' > doc.md
mkdir -p .dz-review
cat > .dz-review/reference-map.json <<'JSON'
{"version":1,"entries":{
"rvw_coarse":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=1:1-3:15;p=h1[1];fh=xxh64:AjAXQ728;hh=smh64:523f49688a480c0b;ctx=suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"},
"rvw_own":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=3:1-3:15;p=h1[1]/p[1];fh=xxh64:FhAKPVpE;hh=smh64:523f49688a480c0b;ctx=pre:XwovWhJk,suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"}}}
JSON

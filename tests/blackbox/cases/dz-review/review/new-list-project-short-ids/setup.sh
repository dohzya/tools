# The map holds an id of another file sharing its first 8 characters with
# the first item of doc.md (rvw_1PnqPcOg656).
printf '# T\n\nfirst {>> a <<}\n\nsecond {>> b <<}\n' > doc.md
mkdir -p .dz-review
cat > .dz-review/reference-map.json <<'JSON'
{"version":1,"entries":{
"rvw_1PnqPcOgzzz":{"file":"other.md","range":{"startLine":1,"endLine":1},"mrfi":"~{v0;r=1:1-1:3}"}}}
JSON

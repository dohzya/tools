mkdir -p bin
for n in claude codex; do cat > bin/$n <<EOS
#!/bin/sh
echo "stub-$n argc=\$#"
for a in "\$@"; do printf "ARG: %s\n" "\$(printf "%s" "\$a" | head -1 | cut -c1-80)"; done
echo "TASK=\$WORKLOG_TASK_ID"
exit 0
EOS
chmod +x bin/$n; done

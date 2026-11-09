git -c init.defaultBranch=main init -q .
mkdir -p lib && (cd lib && $CMD_WL init >/dev/null)

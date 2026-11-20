git -c init.defaultBranch=main init -q .
mkdir other && (cd other && $CMD_WL init >/dev/null)

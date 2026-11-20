# Eight writers on the same task at once; each waits for its own turn.
for i in 1 2 3 4 5 6 7 8; do
  $CMD_WL todo add cq3984 "item-$i" >/dev/null &
done
wait

git -c init.defaultBranch=main init -q .
jq '.children[0].tags=["team"]' .worklog/scope.json > .worklog/scope.tmp && mv .worklog/scope.tmp .worklog/scope.json
$CMD_WL tags add team 4q2r74 >/dev/null

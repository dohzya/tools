git -c init.defaultBranch=main init -q .
jq '.children[0].tags=["team"]' .worklog/scope.json > .worklog/scope.tmp && mv .worklog/scope.tmp .worklog/scope.json

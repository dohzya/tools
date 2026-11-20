git -c init.defaultBranch=main init -q .
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t GIT_AUTHOR_DATE=2020-01-01T00:00:00+00:00 GIT_COMMITTER_DATE=2020-01-01T00:00:00+00:00
git add -A -f >/dev/null; git commit -q -m init

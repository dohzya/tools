export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@e.x GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@e.x
D=2020-01-01T00:00:00Z
git init -q -b main . && git add a.txt
GIT_AUTHOR_DATE=$D GIT_COMMITTER_DATE=$D git commit -qm "first commit"
echo 2 >> a.txt
GIT_AUTHOR_DATE=$D GIT_COMMITTER_DATE=$D git commit -qam "second commit"
echo 3 >> a.txt; echo x > untracked.txt

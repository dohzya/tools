# Release Process

## Quick Reference

```bash
# 1. Bump version
task bump TOOL=wl VERSION=0.5.0

# 2. Commit (don't push yet)
git add -A && git commit -m "chore(wl): bump to v0.5.0"

# 3. Publish to JSR (interactive - requires manual auth)
cd packages/tools && deno publish && cd ../..

# 4. Push + tag (triggers GitHub Actions)
git push origin main
git tag wl-v0.5.0 && git push origin wl-v0.5.0

# 5. Wait for GitHub Actions (~2-3 min)
gh run watch

# 6. Update homebrew tap (downloads binaries, calculates checksums)
task update-tap TOOL=wl VERSION=0.5.0

# 7. Verify
brew update && brew upgrade wl && wl --version

# 8. (Optional) Bundle release for mise
git tag v0.6.0 && git push origin v0.6.0
# Then update dohzya/mise-tools with new tag
```

## Order of Operations (CRITICAL)

| Step      | Command                                          | Why                                                  |
| --------- | ------------------------------------------------ | ---------------------------------------------------- |
| 1. Bump   | `task bump TOOL=wl VERSION=X.Y.Z`                | Updates all version references                       |
| 2. Commit | `git commit`                                     | Don't push yet!                                      |
| 3. JSR    | `deno publish`                                   | **MUST be before push** - binaries download from JSR |
| 4. Push   | `git push`                                       | Push the version bump commit                         |
| 5. Tag    | `git tag wl-vX.Y.Z && git push origin wl-vX.Y.Z` | Triggers release workflow                            |
| 6. Wait   | `gh run watch`                                   | GitHub Actions builds binaries                       |
| 7. Tap    | `task update-tap TOOL=wl VERSION=X.Y.Z`          | Downloads from GH release, calculates checksums      |
| 8. Bundle | `git tag vX.Y.Z && git push origin vX.Y.Z`       | Optional: for mise users                             |

**Key rules:**

- JSR publish MUST happen before tag (binaries are built from JSR)
- Checksums are calculated from **downloaded GitHub release binaries**, never from local builds
- `task update-tap` handles everything: download, checksum, formula update, tap push

## Claude Code Integration

When assisting with releases, Claude should:

1. Create a task list with each step above
2. Mark steps as in_progress/completed as they execute
3. Remember that `deno publish` requires user interaction (can't be automated)
4. Always verify with `wl --version` after homebrew update

## Version Files

`task bump` updates these automatically:

**For wl:**

- `packages/tools/deno.json`
- `packages/tools/worklog/cli.ts` (VERSION constant)
- `plugins/tools/skills/worklog/wl` (import path)
- `homebrew/Formula/wl.rb` (version + URLs, not checksums)
- `plugins/tools/.claude-plugin/plugin.json`

**For md:**

- Same pattern with `markdown-surgeon` paths

## Bundle Releases (mise)

Bundle releases combine wl + md for the mise backend (`dohzya/mise-tools`).

```bash
# 1. Verify latest tool releases
gh release list | head -5

# 2. Create bundle tag
git tag v0.6.0 && git push origin v0.6.0

# 3. Update mise-tools repo
cd ~/bin/share/mise-tools
# Update version references, commit, push, tag
```

Bundle tags: `vX.Y.Z` (no tool prefix) Tool tags: `wl-vX.Y.Z` or `md-vX.Y.Z`

## Common Pitfalls

| Problem                          | Cause                           | Fix                                          |
| -------------------------------- | ------------------------------- | -------------------------------------------- |
| Binary shows wrong version       | Published to JSR after building | Bump version, republish to JSR first         |
| Homebrew checksum mismatch       | Checksums from local build      | Re-run `task update-tap` (downloads from GH) |
| "Package not found" during build | JSR publish missing             | Run `deno publish` first                     |
| Can't republish to JSR           | Same version exists             | Bump to new version number                   |
| brew upgrade shows old version   | Tap not updated                 | Run `task update-tap`                        |

## Troubleshooting

**GitHub Actions failed?**

```bash
gh run view --log-failed
```

**Need to redo a release?**

```bash
# Delete release and tag
gh release delete wl-v0.5.0
git tag -d wl-v0.5.0
git push origin :refs/tags/wl-v0.5.0

# Fix issue, then re-tag
git tag wl-v0.5.0 && git push origin wl-v0.5.0
```

**Rollback completely?**

```bash
git revert HEAD  # Revert version bump
git push
# Note: JSR versions cannot be deleted
```

## Local Testing (Optional)

Test CI before pushing:

```bash
mise exec -- act push --container-architecture linux/amd64
```

Test binary locally (after JSR publish):

```bash
task build VERSION=0.5.0
./dist/wl-darwin-arm64 --version
```

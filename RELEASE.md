# Release Process

This document describes how to create new releases for `md` and `wl` CLI tools.

## Prerequisites

1. Code is tested and ready for release
2. All checks pass: `task validate` (format, lint, type check, tests)
3. You have JSR publish access
4. `act` is installed for local CI testing: `mise use act` (project-local
   installation)

## Local CI Testing with act

Before pushing changes, test the CI locally to catch issues early:

```bash
# Install act (if not already installed)
mise use act
mise install

# Test CI locally (first run will prompt for Docker image size - choose Medium)
mise exec -- act push --container-architecture linux/amd64
```

**Note:** On first run, `act` will ask you to choose a Docker image size. Choose
"Medium" (~500MB) for best compatibility.

## Quick Release (Using Scripts)

The fastest way to create a release is using the provided automation scripts:

```bash
# 0. Validate code (format, lint, type check, tests)
task validate

# 1. Bump version in all files
task bump TOOL=wl VERSION=0.4.3

# 2. Review changes
git diff

# 3. Commit
git add -A
git commit -m "chore(wl): bump to v0.4.3"

# 4. Test CI locally (IMPORTANT: validate before pushing!)
mise exec -- act push --container-architecture linux/amd64
# If CI passes locally, proceed. If it fails, fix issues and amend commit.

# 5. Publish to JSR (CRITICAL: do this BEFORE building binaries!)
# NOTE: This requires interactive authentication - Claude Code cannot do this
cd packages/tools
deno publish
cd ../..

# 6. Build binaries (will download from JSR)
task build VERSION=0.4.3

# 7. Test binary version
./dist/wl-darwin-arm64 --version  # Should output: 0.4.3

# 8. Push commit and tag
git push origin main
git tag wl-v0.4.3
git push origin wl-v0.4.3

# 9. Wait for GitHub Actions to create release (~2-3 minutes)
#    Watch: https://github.com/dohzya/tools/actions

# 10. Update homebrew tap (downloads binaries and calculates checksums)
task update-tap TOOL=wl VERSION=0.4.3
```

Done! Users can now `brew update && brew upgrade wl`.

## Manual Release Process

If you need to do it manually, follow these steps carefully.

### Step 1: Version Bump

Update version in ALL of these files (or use `./scripts/bump-version.sh`):

For `wl`:

- [ ] `packages/tools/deno.json` - version field
- [ ] `packages/tools/worklog/cli.ts` - VERSION constant (line ~34)
- [ ] `plugins/tools/skills/worklog/wl` - import path with version
- [ ] `homebrew/Formula/wl.rb` - version + all release URLs
- [ ] `CLI_SETUP.md` - mise examples
- [ ] `MISE_SETUP.md` - mise examples
- [ ] `plugins/tools/.claude-plugin/plugin.json` - version field

For `md`:

- [ ] `packages/tools/deno.json` - version field
- [ ] `packages/tools/markdown-surgeon/cli.ts` - VERSION constant (line ~34)
- [ ] `plugins/tools/skills/markdown-surgeon/md` - import path with version
- [ ] `homebrew/Formula/md.rb` - version + all release URLs
- [ ] `CLI_SETUP.md` - mise examples
- [ ] `MISE_SETUP.md` - mise examples
- [ ] `plugins/tools/.claude-plugin/plugin.json` - version field

**Critical Notes:**

- The VERSION constant in cli.ts MUST match deno.json version
- JSR does NOT allow republishing the same version - if you mess up, bump
  version again

### Step 2: Commit Changes

```bash
git add -A
git commit -m "chore(wl): bump to v0.4.3"
```

**DO NOT push yet!** Test CI locally first, then publish to JSR.

### Step 3: Test CI Locally

**IMPORTANT: Always test CI locally before pushing to catch issues early.**

```bash
mise exec -- act push --container-architecture linux/amd64
```

If CI fails locally:

- Fix the issues
- Stage changes: `git add -A`
- Amend commit: `git commit --amend --no-edit`
- Test again with `act`

### Step 4: Publish to JSR

**CRITICAL: You MUST publish to JSR BEFORE building binaries!**

The build process downloads code from JSR, so the version must exist there
first.

**NOTE:** This requires interactive authentication. Claude Code cannot execute
`deno publish` - you must run it manually in your terminal.

```bash
cd packages/tools
deno publish
cd ../..
```

If this fails:

- Check you have JSR access
- Verify deno.json version is correct
- Remember: you cannot republish the same version

### Step 5: Build Binaries

Now that JSR has the new version, build binaries:

```bash
task build VERSION=0.4.3
```

This will:

1. Download the code from `jsr:@dohzya/tools@0.4.3`
2. Compile for all platforms (macOS, Linux, Windows)
3. Place binaries in `dist/`

### Step 6: Verify Binary Version

**Critical check before releasing:**

```bash
./dist/wl-darwin-arm64 --version
```

Should output: `0.4.3`

If it shows the wrong version, you published to JSR without updating the VERSION
constant. You'll need to bump version and republish.

### Step 7: Calculate Checksums

```bash
shasum -a 256 dist/wl-darwin-arm64 dist/wl-darwin-x86_64 dist/wl-linux-arm64 dist/wl-linux-x86_64
```

Update `homebrew/Formula/wl.rb` with the new SHA256 checksums.

### Step 8: Amend Commit

```bash
git add homebrew/Formula/wl.rb
git commit --amend --no-edit
```

### Step 9: Push and Tag

```bash
git push origin main
git tag wl-v0.4.3
git push origin wl-v0.4.3
```

### Step 10: GitHub Actions

The release workflow (`.github/workflows/release.yml`) will automatically:

1. Detect the tag `wl-v0.4.3`
2. Extract tool name (`wl`) and version (`0.4.3`)
3. Compile binaries for all platforms from JSR
4. Create a GitHub Release with binaries as assets

Monitor: https://github.com/dohzya/tools/actions

### Step 11: Update Homebrew Tap

After GitHub Actions completes:

```bash
task update-tap TOOL=wl VERSION=0.4.3
```

Or manually:

```bash
# 1. Clone tap if not done
cd ~/bin/share
git clone https://github.com/dohzya/homebrew-tools.git  # if not done

# 2. Copy updated formula
cp tools/homebrew/Formula/wl.rb homebrew-tools/Formula/wl.rb

# 3. Commit and push
cd homebrew-tools
git add Formula/wl.rb
git commit -m "chore(wl): bump to v0.4.3"
git push origin main
```

### Step 12: Verify Installation

```bash
brew update
brew upgrade wl
wl --version  # Should output: 0.4.3
```

## Order of Operations (CRITICAL!)

This is the EXACT order you must follow:

1. ✅ Update all version files
2. ✅ Commit (but don't push yet)
3. ✅ **Test CI locally with act** ← Catch issues before pushing!
4. ✅ **Publish to JSR** ← MUST be before build!
5. ✅ Build binaries (downloads from JSR)
6. ✅ Verify binary version output
7. ✅ Calculate checksums
8. ✅ Update homebrew formula checksums
9. ✅ Amend commit with updated checksums
10. ✅ Push commit
11. ✅ Create and push tag
12. ✅ Wait for GitHub Actions
13. ✅ Update homebrew tap

**Critical notes:**

- If you skip step 3, you may push broken code to remote
- If you skip step 4 or do it after step 5, the binaries will have the wrong
  version!

## Common Pitfalls

### ❌ Not testing CI locally before pushing

You push changes and discover CI failures on GitHub, wasting time and creating
failed builds in history.

**Fix:** Always run `mise exec -- act push` before pushing. Fix issues and amend
the commit.

### ❌ Publishing to JSR after building binaries

The binaries will download the old version from JSR and have the wrong version
number.

**Fix:** Bump version again (e.g., 0.4.3 → 0.4.4), publish to JSR first, then
rebuild.

### ❌ Forgetting to update VERSION constant in cli.ts

The binary will run but `--version` will show the wrong version.

**Fix:** Same as above - bump version, update ALL files, republish.

### ❌ Trying to republish the same version to JSR

JSR will reject it with an error.

**Fix:** Bump version number and try again. You cannot reuse version numbers.

### ❌ Not updating homebrew formula checksums

Users will get a checksum mismatch error when installing.

**Fix:** Download the binaries from GitHub release and recalculate checksums,
then update the tap.

### ❌ Forgetting to update the homebrew tap

Users won't see the new version when running `brew upgrade`.

**Fix:** Run `./scripts/update-homebrew-tap.sh` or manually copy the formula and
push.

## Troubleshooting

### Build fails with "package not found"

The version doesn't exist on JSR yet. Publish to JSR first.

### Binary shows wrong version

You built before publishing to JSR, or you forgot to update the VERSION
constant. Bump version and start over.

### Homebrew install fails with checksum error

Checksums in `homebrew/Formula/*.rb` don't match the actual binaries.
Recalculate and update.

### GitHub Actions fails

Check the workflow logs. Usually it's because:

- Tag format is wrong (must be `<tool>-v<version>`)
- JSR version doesn't exist
- Permissions issue

## Testing Before Release

Always test locally before creating a release:

```bash
# 1. Build locally
task build VERSION=0.4.3

# 2. Test the binary
./dist/wl-darwin-arm64 --version
./dist/wl-darwin-arm64 list

# 3. Test homebrew formula
brew install --build-from-source homebrew/Formula/wl.rb
brew audit --strict homebrew/Formula/wl.rb
```

## Bundle Releases

Bundle releases combine all tools (wl + md) into a single release for the mise
backend. They use tags like `v0.5.0` (without tool prefix).

### Creating a Bundle Release

```bash
# 1. CRITICAL: Verify which versions will be included BEFORE pushing the tag
# Note: gh release list is tab-separated, use -F'\t' to parse correctly
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^wl-v/ {print $3; exit}'
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^md-v/ {print $3; exit}'

# 2. If correct, create and push the tag
git tag v0.5.0
git push origin v0.5.0

# 3. Monitor: https://github.com/dohzya/tools/actions
```

### How Bundle Workflow Works

The workflow (`.github/workflows/release-bundle.yml`):

1. Triggered by `v*` tags (excludes `wl-v*`, `md-v*`)
2. Finds latest `wl-v*` and `md-v*` releases via `gh release list`
3. Downloads all binaries from those releases
4. Creates a new release with all binaries combined

### Common Pitfalls for Bundle Releases

#### ❌ Pushing bundle tag before tool release is ready

The bundle will pick up the previous version of the tool.

**Fix:** Always verify with `gh release list` before pushing the bundle tag.

#### ❌ Pushing bundle tag right after tool release

GitHub Actions might not have finished creating the tool release yet.

**Fix:** Wait for the tool release workflow to complete before creating bundle.

### Recreating a Bundle Release

If a bundle was created with wrong versions:

```bash
# 1. Delete the release and tag
gh release delete v0.5.0 -R dohzya/tools
git tag -d v0.5.0
git push origin :refs/tags/v0.5.0

# 2. Verify correct versions are available
gh release list -R dohzya/tools | head -5

# 3. Recreate the tag
git tag v0.5.0
git push origin v0.5.0
```

## Version Strategy

- **Patch version (0.4.X)**: Bug fixes, documentation updates
- **Minor version (0.X.0)**: New features, non-breaking changes
- **Major version (X.0.0)**: Breaking changes (not yet used)

## Rollback

If you need to rollback a release:

```bash
# Delete the tag
git tag -d wl-v0.4.3
git push origin :refs/tags/wl-v0.4.3

# Delete the GitHub release
gh release delete wl-v0.4.3

# Revert the version bump
git revert HEAD
git push origin main
```

Note: You cannot unpublish from JSR. The version will remain there.

# Bump Infrastructure Testing Checklist

**Before using the new bump process in a real release, validate it works correctly.**

## Pre-Testing Setup

```bash
# Create a test branch
git checkout -b test-new-bump-process

# Ensure clean state
git status
task validate
```

## Test 1: bump-prepare Validation

### Test normal execution
```bash
# Run bump-prepare with test values
task bump-prepare TOOL=wl TOOL_VERSION=0.6.0 JSR_VERSION=0.6.1

# Verify ONLY these files changed:
git status
# Expected:
#   modified: packages/tools/deno.json
#   modified: packages/tools/worklog/cli.ts
#   modified: plugins/tools/skills/worklog/wl

# Verify NOT modified:
#   homebrew/Formula/wl.rb
#   CLI_SETUP.md
#   MISE_SETUP.md
#   plugins/tools/.claude-plugin/plugin.json
```

### Verify file contents
```bash
# Check deno.json has JSR version
grep '"version": "0.6.1"' packages/tools/deno.json

# Check cli.ts has tool version
grep 'const VERSION = "0.6.0"' packages/tools/worklog/cli.ts

# Check skill import has JSR version
grep '@dohzya/tools@0.6.1/worklog' plugins/tools/skills/worklog/wl

# All should return matches
```

### Test error handling
```bash
# Reset first
git reset --hard origin/main

# Test missing arguments
./scripts/bump-prepare.sh
# Expected: Usage message

# Test invalid tool
./scripts/bump-prepare.sh invalid 0.1.0 0.1.0
# Expected: "Error: tool must be 'wl' or 'md'"

# Test invalid version format
./scripts/bump-prepare.sh wl 0.1 0.1.0
# Expected: "Error: tool-version must be in format X.Y.Z"

./scripts/bump-prepare.sh wl 0.1.0 0.1
# Expected: "Error: jsr-version must be in format X.Y.Z"
```

## Test 2: bump-finalize Validation

### Test error handling (no release)
```bash
# This should fail gracefully
./scripts/bump-finalize.sh wl 99.99.99
# Expected: "Error: GitHub release wl-v99.99.99 not found"
```

### Test with existing release (if available)
```bash
# Find a recent release
gh release list | head -3

# Try with a real release (e.g., wl-v0.6.0)
./scripts/bump-finalize.sh wl 0.6.0

# Verify it downloaded binaries
# Should show checksums being calculated

# Verify ONLY these files changed:
git status
# Expected:
#   modified: homebrew/Formula/wl.rb
#   modified: CLI_SETUP.md
#   modified: MISE_SETUP.md
#   modified: plugins/tools/.claude-plugin/plugin.json

# Verify checksums updated
grep 'sha256' homebrew/Formula/wl.rb | head -4
# Should show 4 different SHA256 hashes
```

### Verify file contents
```bash
# Check homebrew version
grep 'version "0.6.0"' homebrew/Formula/wl.rb

# Check homebrew URLs
grep 'wl-v0.6.0' homebrew/Formula/wl.rb | wc -l
# Should be 4 (one for each platform)

# Check docs updated
grep 'wl-v0.6.0' CLI_SETUP.md
grep 'wl-v0.6.0' MISE_SETUP.md

# Check plugin version
grep '"version": "0.6.0"' plugins/tools/.claude-plugin/plugin.json
```

## Test 3: Task Commands

```bash
# Reset to clean state
git reset --hard origin/main

# Test task commands exist
task --list | grep bump
# Expected to see:
#   bump (deprecated)
#   bump-prepare
#   bump-finalize

# Test bump-prepare via task
task bump-prepare TOOL=md TOOL_VERSION=0.5.2 JSR_VERSION=0.6.2

# Verify md files changed
git status
# Expected:
#   modified: packages/tools/deno.json
#   modified: packages/tools/markdown-surgeon/cli.ts
#   modified: plugins/tools/skills/markdown-surgeon/md
```

## Test 4: Validation Still Works

```bash
# Reset
git reset --hard origin/main

# Run prepare
task bump-prepare TOOL=wl TOOL_VERSION=0.6.0 JSR_VERSION=0.6.1

# Validate should still pass (versions are valid)
task validate
# Expected: All checks pass
```

## Test 5: Old Script Still Works (Backward Compatibility)

```bash
# Reset
git reset --hard origin/main

# Old command should work but show deprecation
task bump TOOL=wl VERSION=0.6.0
# Expected: Deprecation warning + normal execution
```

## Test 6: Documentation Consistency

```bash
# Check RELEASE.md has new commands
grep 'bump-prepare' RELEASE.md
grep 'bump-finalize' RELEASE.md

# Check it mentions JSR_VERSION
grep 'JSR_VERSION' RELEASE.md

# Check order of operations table updated
grep 'bump-prepare' RELEASE.md -A 2 | grep 'Phase 1'
```

## Clean Up

```bash
# After all tests pass
git checkout main
git branch -D test-new-bump-process
```

## Production Use Checklist

Before using in actual release:

- [ ] All Test 1 scenarios pass (bump-prepare)
- [ ] All Test 2 scenarios pass (bump-finalize)
- [ ] All Test 3 scenarios pass (task commands)
- [ ] Test 4 passes (validation works)
- [ ] Test 5 passes (backward compatibility)
- [ ] Test 6 passes (documentation consistency)
- [ ] Reviewed BUMP_IMPROVEMENTS.md
- [ ] Reviewed updated RELEASE.md
- [ ] Understanding of JSR version vs tool version clear
- [ ] Team/user informed of new process

## First Production Release

When doing the first release with new scripts:

1. **Do a dry run first** on the test branch
2. **Have rollback plan ready** (old script still works)
3. **Monitor each step carefully**
4. **Document any issues** for future improvements
5. **Update REX-04vcuw.md** if issues found

## Success Criteria

The new process is successful if:

1. ✅ Pre-release files updated correctly (deno.json, cli.ts, skills)
2. ✅ JSR publish happens with correct code
3. ✅ Post-release files updated only after release exists
4. ✅ Checksums automatically calculated and correct
5. ✅ No manual checksum updates needed
6. ✅ Homebrew installation works
7. ✅ Tool --version shows correct version
8. ✅ Less confusion about JSR vs tool versions

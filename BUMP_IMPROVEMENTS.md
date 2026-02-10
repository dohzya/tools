# Bump Infrastructure Improvements

**Task:** 3fn03v
**Date:** 2026-02-10
**Context:** Addressing issues documented in REX-04vcuw.md

## Problems Identified

### 1. Original bump-version.sh Modified Too Many Files Too Early

**Issue:** The monolithic `bump-version.sh` script modified all files at once, including:
- Homebrew formulas (with URLs pointing to non-existent releases)
- Documentation (*_SETUP.md with non-existent version references)
- Plugin configuration

**Impact:** Files referenced GitHub releases that didn't exist yet, creating a window where the repository state was inconsistent.

### 2. No Separation Between JSR Version and Tool Version

**Issue:** The original script only took one version parameter, leading to confusion about:
- JSR package version (@dohzya/tools)
- Individual tool versions (wl and md)

**Impact:** Led to publishing wrong JSR versions when only one tool was being released.

### 3. Checksum Calculation Timing

**Issue:** Homebrew formulas were updated with URLs before the GitHub release existed, requiring manual checksum updates later.

**Impact:** Error-prone manual process, risk of incorrect checksums.

## Solution: Two-Phase Release Process

### Phase 1: Prepare (`bump-prepare.sh`)

**When:** BEFORE JSR publish and GitHub release

**What it updates:**
- `packages/tools/deno.json` - JSR package version
- `packages/tools/{tool}/cli.ts` - Tool VERSION constant
- `plugins/tools/skills/{tool}/{tool}` - JSR import paths

**Why separate:** These files must be correct BEFORE:
1. Publishing to JSR (deno publish reads deno.json)
2. Creating the git tag (GitHub Actions builds from JSR)
3. The skill imports must reference the JSR version that will exist

**Command:**
```bash
task bump-prepare TOOL=wl TOOL_VERSION=0.6.1 JSR_VERSION=0.6.2
```

### Phase 2: Finalize (`bump-finalize.sh`)

**When:** AFTER GitHub release workflow completes

**What it updates:**
- `homebrew/Formula/{tool}.rb` - Version, URLs, and checksums
- `CLI_SETUP.md` - Version references
- `MISE_SETUP.md` - Version references
- `plugins/tools/.claude-plugin/plugin.json` - Plugin version

**Why separate:** These files require:
1. The GitHub release to exist (for URLs to be valid)
2. Release binaries to be available (for checksum calculation)
3. Download verification (ensures binaries are accessible)

**Command:**
```bash
task bump-finalize TOOL=wl VERSION=0.6.1
```

## Key Improvements

### 1. Clear Parameter Separation

The new scripts make the JSR vs tool version distinction explicit:

```bash
# Old (ambiguous)
task bump TOOL=md VERSION=0.5.2

# New (explicit)
task bump-prepare TOOL=md TOOL_VERSION=0.5.2 JSR_VERSION=0.6.2
```

### 2. Automatic Checksum Calculation

`bump-finalize.sh` automatically:
1. Downloads binaries from GitHub release
2. Calculates SHA256 checksums
3. Updates homebrew formula with correct checksums
4. Verifies the release exists before attempting download

### 3. Built-in Safety Checks

**bump-prepare.sh:**
- Shows current vs new versions
- Lists what WILL and WON'T be updated
- Validates version format
- Requires confirmation before proceeding

**bump-finalize.sh:**
- Verifies GitHub release exists before starting
- Downloads all platform binaries to verify availability
- Fails fast if any binary is missing
- Shows checksums for manual verification

### 4. Better Documentation Flow

The scripts guide users through the correct process:

**bump-prepare.sh** output includes:
1. Validate with `task validate`
2. Review with `git diff`
3. Commit (don't push)
4. Publish to JSR
5. Push to main
6. Wait for CI
7. Tag after CI passes
8. Wait for release workflow
9. Run bump-finalize

**bump-finalize.sh** output includes:
1. Review changes
2. Commit finalization
3. Update homebrew tap
4. Test installation

## File Modification Matrix

| File | Phase 1 (Prepare) | Phase 2 (Finalize) | Reason |
|------|-------------------|-------------------|--------|
| `packages/tools/deno.json` | ✓ | - | JSR version for publish |
| `packages/tools/{tool}/cli.ts` | ✓ | - | Tool version constant |
| `plugins/tools/skills/{tool}/{tool}` | ✓ | - | JSR import path |
| `homebrew/Formula/{tool}.rb` | - | ✓ | Needs release binaries for checksums |
| `CLI_SETUP.md` | - | ✓ | Should reference existing release |
| `MISE_SETUP.md` | - | ✓ | Should reference existing release |
| `plugins/tools/.claude-plugin/plugin.json` | - | ✓ | Plugin version update |

## Updated Release Flow

```
0. task validate (clean state)
   ↓
1. task bump-prepare TOOL=wl TOOL_VERSION=X JSR_VERSION=Y
   ↓
2. task validate (verify bump)
   ↓
3. git commit (local)
   ↓
4. cd packages/tools && deno publish
   ↓
5. git push origin main
   ↓
6. gh run watch (wait for CI ✅)
   ↓
7. git tag + push (trigger release)
   ↓
8. gh run watch (wait for release workflow ✅)
   ↓
9. task bump-finalize TOOL=wl VERSION=X
   ↓
10. git commit + push (finalization)
    ↓
11. task update-tap TOOL=wl VERSION=X
    ↓
12. brew upgrade wl (verify)
```

## Backward Compatibility

The original `task bump` is deprecated but still works:
- Shows deprecation warning
- Directs users to new process
- Still calls old script for emergency use

This allows gradual migration without breaking existing workflows.

## Testing Recommendations

Before using in production release:

1. **Dry run on feature branch:**
   ```bash
   git checkout -b test-bump-process
   task bump-prepare TOOL=wl TOOL_VERSION=0.6.0 JSR_VERSION=0.6.1
   git diff  # Verify only expected files changed
   git reset --hard  # Clean up
   ```

2. **Verify script error handling:**
   ```bash
   # Test with missing arguments
   ./scripts/bump-prepare.sh

   # Test with invalid tool name
   ./scripts/bump-prepare.sh invalid 0.1.0 0.1.0

   # Test with invalid version format
   ./scripts/bump-prepare.sh wl 0.1 0.1
   ```

3. **Test finalize with non-existent release:**
   ```bash
   # Should fail gracefully
   ./scripts/bump-finalize.sh wl 99.99.99
   ```

## Migration Guide

When doing the next release:

1. Use `task bump-prepare` instead of `task bump`
2. Note that you now need to specify BOTH tool version and JSR version
3. Follow the updated "Next steps" output from the script
4. After release workflow completes, run `task bump-finalize`
5. The homebrew checksums will be automatically calculated

## Files Changed

### New Files
- `/scripts/bump-prepare.sh` - Pre-release version preparation
- `/scripts/bump-finalize.sh` - Post-release finalization
- `/BUMP_IMPROVEMENTS.md` - This document

### Modified Files
- `/Taskfile.yml` - Added bump-prepare and bump-finalize tasks
- `/RELEASE.md` - Updated with two-phase process documentation

### Unchanged Files
- `/scripts/bump-version.sh` - Kept for backward compatibility (deprecated)
- `/scripts/update-homebrew-tap.sh` - Still used in step 11

## References

- **Original issue:** REX-04vcuw.md
- **Release documentation:** RELEASE.md
- **Task tracking:** wl task 3fn03v

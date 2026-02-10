# Bump Process Flow Diagram

## New Two-Phase Process

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1: PREPARE                             │
│              (Before JSR Publish & Release)                     │
└─────────────────────────────────────────────────────────────────┘

  task validate ✅
        │
        ▼
  task bump-prepare TOOL=wl TOOL_VERSION=0.6.1 JSR_VERSION=0.6.2
        │
        ├─── Modifies: packages/tools/deno.json
        │              (JSR package version → 0.6.2)
        │
        ├─── Modifies: packages/tools/worklog/cli.ts
        │              (VERSION constant → "0.6.1")
        │
        └─── Modifies: plugins/tools/skills/worklog/wl
                       (import from @dohzya/tools@0.6.2)
        │
        ▼
  task validate ✅ (verify bump)
        │
        ▼
  git add -A && git commit -m "chore(wl): bump to v0.6.1"
        │
        ▼
  cd packages/tools && deno publish
  (CRITICAL: JSR now has correct version 0.6.2)
        │
        ▼
  git push origin main
        │
        ▼
  gh run watch (WAIT FOR CI ✅)
  (GATE: Must be green before tagging)
        │
        ▼
  git tag wl-v0.6.1 && git push origin wl-v0.6.1
        │
        ▼
  gh run watch (WAIT FOR RELEASE WORKFLOW ✅)
  (GitHub Actions builds binaries from JSR @0.6.2)
        │
        ▼
  GitHub Release "wl-v0.6.1" created with binaries
        │
        │
┌───────┴─────────────────────────────────────────────────────────┐
│                    PHASE 2: FINALIZE                            │
│              (After GitHub Release Exists)                      │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
  task bump-finalize TOOL=wl VERSION=0.6.1
        │
        ├─── Verifies: gh release view wl-v0.6.1 ✅
        │
        ├─── Downloads: All 4 platform binaries from GitHub
        │              - wl-darwin-arm64
        │              - wl-darwin-x86_64
        │              - wl-linux-arm64
        │              - wl-linux-x86_64
        │
        ├─── Calculates: SHA256 checksums
        │
        ├─── Modifies: homebrew/Formula/wl.rb
        │              - version "0.6.1"
        │              - URLs → wl-v0.6.1
        │              - sha256 checksums (all 4 platforms)
        │
        ├─── Modifies: CLI_SETUP.md
        │              - Update wl-v0.6.1 references
        │
        ├─── Modifies: MISE_SETUP.md
        │              - Update wl-v0.6.1 references
        │
        └─── Modifies: plugins/tools/.claude-plugin/plugin.json
                       - "version": "0.6.1"
        │
        ▼
  git add -A && git commit -m "chore(wl): finalize v0.6.1 release"
        │
        ▼
  git push origin main
        │
        ▼
  task update-tap TOOL=wl VERSION=0.6.1
  (Downloads binaries again, copies formula to tap repo, pushes)
        │
        ▼
  brew update && brew upgrade wl && wl --version
  (Users can now install v0.6.1)
        │
        ▼
  DONE ✅
```

## File Modification Summary

### Phase 1 Files (Pre-Release)

```
packages/tools/
├── deno.json ...................... JSR package version
├── worklog/
│   └── cli.ts ..................... Tool VERSION constant
└── markdown-surgeon/
    └── cli.ts ..................... Tool VERSION constant

plugins/tools/skills/
├── worklog/
│   └── wl ......................... JSR import path
└── markdown-surgeon/
    └── md ......................... JSR import path
```

### Phase 2 Files (Post-Release)

```
homebrew/Formula/
├── wl.rb .......................... Version, URLs, checksums
└── md.rb .......................... Version, URLs, checksums

CLI_SETUP.md ....................... Version references
MISE_SETUP.md ...................... Version references

plugins/tools/.claude-plugin/
└── plugin.json .................... Plugin version
```

## Key Decision Points

### Why separate JSR and tool versions?

```
Scenario: Release md bugfix, wl unchanged

JSR Package @dohzya/tools: 0.6.1 → 0.6.2 (always increments)
Tool md:                   0.5.1 → 0.5.2 (bugfix bump)
Tool wl:                   0.6.0 → 0.6.0 (unchanged)

Tag created: md-v0.5.2
JSR package: @dohzya/tools@0.6.2

bump-prepare needs BOTH versions to be explicit!
```

### Why wait for CI before tagging?

```
❌ BAD: Tag immediately after push
   git push origin main
   git tag wl-v0.6.1 && git push origin wl-v0.6.1
   # CI might fail → tag points to broken commit

✅ GOOD: Wait for CI, then tag
   git push origin main
   gh run watch  # ← WAIT FOR GREEN
   git tag wl-v0.6.1 && git push origin wl-v0.6.1
   # CI passed → tag points to validated commit
```

### Why download binaries for checksums?

```
❌ BAD: Use local build
   task build VERSION=0.6.1
   shasum -a 256 dist/wl-*
   # Might differ from GitHub Actions build

✅ GOOD: Download from GitHub release
   curl -sL github.com/.../wl-v0.6.1/wl-darwin-arm64
   shasum -a 256 wl-*
   # Matches what users will download
```

## Error Recovery

### If Phase 1 fails

```
git reset --hard HEAD~1  # Undo commit
# Fix issue
# Re-run bump-prepare
```

### If JSR publish fails

```
# Fix issue in code
task validate
git add -A && git commit --amend
deno publish
# Continue from push step
```

### If Phase 2 fails

```
# Release exists, so safe to retry
task bump-finalize TOOL=wl VERSION=0.6.1
# Or fix manually and re-run
```

### If checksums wrong

```
# Phase 2 calculates from GH release
# So just re-run:
git reset --hard HEAD~1  # Undo finalize commit
task bump-finalize TOOL=wl VERSION=0.6.1
# Will download and recalculate
```

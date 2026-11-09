# Release Process

## Pre-flight Checklist

Before starting ANY release:

- [ ] `git status` is clean (no uncommitted changes)
- [ ] `task validate` passes (MANDATORY)
- [ ] On `main` branch and up-to-date with origin
- [ ] Know which tool(s) you're releasing and their NEW version numbers
- [ ] Know the NEW `deno.json` version (JSR package - must always increment)
- [ ] Audit every tool changed since its previous tag; release it now or leave it explicitly in `Unreleased`

## Version Semantics (CRITICAL)

**Understanding the two-version system:**

### 1. JSR Package Version (`packages/tools/deno.json`)

- Version of the `@dohzya/tools` package published to JSR
- **Shared across ALL tools** (wl + md + recap combined in one package)
- **MUST be bumped EVERY time ANY tool is released**
- This is what GitHub Actions downloads when building binaries

### 2. Individual Tool Versions (`cli.ts` constants)

- `packages/tools/worklog/cli.ts` → `wl` version (what `wl --version` shows)
- `packages/tools/markdown-surgeon/cli.ts` → `md` version (what `md --version` shows)
- `packages/tools/recap/cli.ts` → `recap` version (what `recap --version` shows)
- `packages/tools/dz-review/cli.ts` → `dz-review` version (what `dz-review --version` shows)
- Can differ from each other and from the JSR package version
- These are independent version numbers for each CLI tool

### Release Scope Audit (CRITICAL)

Before `task bump-prepare`, identify every tool changed since its previous tool tag:

```bash
git log --oneline wl-vX.Y.Z..HEAD -- packages/tools/worklog packages/tools/CHANGELOG.md
git log --oneline md-vX.Y.Z..HEAD -- packages/tools/markdown-surgeon packages/tools/CHANGELOG.md
git log --oneline recap-vX.Y.Z..HEAD -- packages/tools/recap packages/tools/CHANGELOG.md
git log --oneline dz-review-vX.Y.Z..HEAD -- packages/tools/dz-review packages/tools/CHANGELOG.md
```

The default proposed release scope is **all changed tools**. The agent must show the maintainer the detected scope before bumping versions, for example:

| Tool    | Evidence since previous tag | Proposed action |
| ------- | --------------------------- | --------------- |
| `wl`    | source/changelog changed    | release now     |
| `recap` | source/changelog changed    | release now     |
| `md`    | no changes                  | exclude         |

The maintainer may remove a changed tool from the release scope. Only then is the tool deferred:

- **Release it now:** bump its `cli.ts` version, include its tool tag, run `task bump-finalize` for that tool, update its Homebrew formula, and verify the installed binary.
- **Defer it intentionally:** keep its notes under `## Unreleased`, exclude it from the released changelog section, and record the maintainer decision plus why it is acceptable for the shared JSR package to contain that source before the CLI binary is released.

`@dohzya/tools` is one shared JSR package. Publishing it for `wl` or `dz-review` can also publish newer `recap` or `md` source to JSR, but that does not release those Homebrew binaries. If a changed tool is needed for the release scenario, release that tool too.

### Example Scenario

Releasing md bugfix while wl stays unchanged:

```
Before:
  deno.json: 0.6.0
  wl version: 0.6.0
  md version: 0.5.0

After:
  deno.json: 0.6.1  ← MUST increment (JSR package)
  wl version: 0.6.0  ← Unchanged
  md version: 0.5.1  ← Bugfix release

Tag to create: md-v0.5.1
JSR package: @dohzya/tools@0.6.1
```

## Quick Reference

```bash
# 0. ALWAYS validate first (code + plugin manifests)
task validate  # ✅ Must be green (validate:code + validate:plugin)

# 0a. Audit release scope before bumping:
#     - check each tool's previous tag against HEAD
#     - release every changed tool now or keep it explicitly in Unreleased

# 1. Prepare version bump (updates deno.json + tool cli.ts + skill imports only)
#    The script prompts for confirmation. For non-interactive use (e.g. inside a subagent):
echo y | task bump-prepare TOOL=wl TOOL_VERSION=0.6.1 JSR_VERSION=0.6.2
#    Interactive (default):
task bump-prepare TOOL=wl TOOL_VERSION=0.6.1 JSR_VERSION=0.6.2

# 1b. Update CHANGELOG.md — add a new section at the top:
#     ## [wl-v0.6.1] — YYYY-MM-DD
#     List notable changes since the previous tag (git log wl-v0.6.0..HEAD --oneline)
#     ⚠️  NEVER infer changelog content from commit message subjects alone
#        Always read the actual diff to describe what was truly implemented

# 1c. Validate after bump
task validate  # ✅ Must pass

# 2. Commit (don't push yet)
git add -A && git commit -m "chore(wl): bump to v0.6.1"

# 3. Push to main
git push origin main

# 4. Wait for CI to pass on main (MANDATORY GATE)
gh run watch
# ✅ Confirm all checks are GREEN before proceeding

# 5. Publish to JSR via GitHub Actions (OIDC provenance)
gh workflow run publish.yml
gh run watch  # wait for publish to complete

# 6. Tag and push tag ONLY after CI + JSR publish are green
git tag wl-v0.6.1 && git push origin wl-v0.6.1

# 7. Wait for release workflow to build binaries (~2-3 min)
gh run watch
# ✅ Confirm release workflow completed successfully

# 8. Finalize release (updates homebrew checksums, docs, plugin metadata)
task bump-finalize TOOL=wl VERSION=0.6.1

# 9. Commit and push finalization
git add -A && git commit -m "chore(wl): finalize v0.6.1 release"
git push origin main

# 10. Update homebrew tap (downloads binaries again, updates tap repo)
task update-tap TOOL=wl VERSION=0.6.1

# 11. Verify installation
brew update && brew upgrade wl && wl --version

# 12. (Optional) Bundle release for mise
git tag v0.6.2 && git push origin v0.6.2
# Then update dohzya/mise-tools with new tag
```

## Order of Operations (CRITICAL)

| Step | Validation                | Command                                                                    | Why                                                                                                              |
| ---- | ------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0    | `task validate` ✅        | Must pass (runs validate:code + validate:plugin)                           | Ensure clean starting state + plugin manifests                                                                   |
| 0a   | Scope audit               | Compare each tool's previous tag to `HEAD`; inspect `CHANGELOG.md`         | Decide which changed tools are released now vs intentionally deferred                                            |
| 1    | N/A                       | `echo y \| task bump-prepare TOOL=wl TOOL_VERSION=X.Y.Z JSR_VERSION=X.Y.Z` | Updates deno.json, cli.ts, skill imports ONLY (script prompts for confirmation; `echo y \|` for non-interactive) |
| 1b   | N/A                       | Update `CHANGELOG.md` — add `[wl-vX.Y.Z] — YYYY-MM-DD` section             | Document what changed — read actual diffs, not just commit subjects                                              |
| 1c   | `task validate` ✅        | Must pass                                                                  | Verify bump didn't break anything                                                                                |
| 2    | N/A                       | `git commit` (no push!)                                                    | Commit version changes locally                                                                                   |
| 3    | N/A                       | `git push origin main`                                                     | Push commit (NOT tag yet!)                                                                                       |
| 4    | **CI GREEN** ✅ (GATE)    | `gh run watch`                                                             | **MUST pass before publishing** - never publish or tag failed CI                                                 |
| 5    | JSR publish green ✅      | `gh workflow run publish.yml` then `gh run watch`                          | Publish to JSR via GitHub Actions with OIDC provenance                                                           |
| 6    | N/A                       | `git tag wl-vX.Y.Z && git push origin wl-vX.Y.Z`                           | Trigger release workflow (builds from JSR)                                                                       |
| 7    | Release workflow green ✅ | `gh run watch`                                                             | GitHub Actions builds binaries from JSR                                                                          |
| 8    | N/A                       | `task bump-finalize TOOL=wl VERSION=X.Y.Z`                                 | Updates homebrew checksums, docs, plugin metadata (post-release)                                                 |
| 9    | N/A                       | `git commit && git push`                                                   | Push finalization changes                                                                                        |
| 10   | N/A                       | `task update-tap TOOL=wl VERSION=X.Y.Z`                                    | Downloads GH release binaries, updates tap repo                                                                  |
| 11   | Test installation         | `brew upgrade wl && wl --version`                                          | Verify users can install and get correct version                                                                 |

**Key gates:**

- ✅ Step 0: Clean validation before starting
- ✅ Step 0a: Scope audit covers every changed tool
- ✅ Step 1c: Validation after version bump
- ✅ Step 4: **CI MUST BE GREEN** before publishing to JSR or tagging
- ✅ Step 5: JSR publish must succeed before tagging
- ✅ Step 7: Release workflow must succeed before updating homebrew

**Key rules:**

- Git push (step 3) MUST happen before JSR publish (step 5)
- CI on main (step 4) MUST be green before JSR publish (step 5)
- JSR publish (step 5) MUST succeed before git tag (step 6)
- Checksums calculated from **downloaded GitHub release binaries**, never from local builds
- `task update-tap` handles everything: download, checksum, formula update, tap push
- Do not leave changed, user-facing CLI behavior in an unreleased tool by accident just because the shared JSR package is being published for another tool

## Claude Code Integration

When assisting with releases, Claude should:

1. **NEVER use `wl add`** - always use `wl trace <task-id>` when working on a specific task
2. **NEVER create tasks with TaskCreate** - use worklog for tracing
3. Create a checklist showing each step from "Order of Operations"
4. Mark steps as in_progress/completed as they execute
5. JSR publish is done via `gh workflow run publish.yml` (CI with OIDC provenance), not locally
6. **ALWAYS update CHANGELOG.md** (step 1b) before committing — add a new dated section with notable changes (`git log prev-tag..HEAD --oneline --no-merges`) — **read actual diffs to verify each change, never infer from commit subjects alone**
7. **ALWAYS run `task validate`** before ANY commit
8. **ALWAYS verify CI is green** before creating tags
9. **ALWAYS challenge the release scope** when `CHANGELOG.md` still has `Unreleased` entries for another tool touched since its previous tag
10. Never skip validation steps even if "it should work"

## Version Files

### Phase 1: Pre-Release (`task bump-prepare`)

Updates ONLY files needed BEFORE the GitHub release:

**For wl:**

- `packages/tools/deno.json` (JSR package version - always increments)
- `packages/tools/worklog/cli.ts` (VERSION constant - tool version)
- `plugins/tools/skills/worklog/wl` (import path with JSR version)

**For md:**

- Same pattern with `markdown-surgeon` paths

**For recap:**

- `packages/tools/deno.json` (JSR package version - always increments)
- `packages/tools/recap/cli.ts` (VERSION constant - tool version)
- No skill import to update (recap has no plugin skill yet)

**For dz-review:**

- `packages/tools/deno.json` (JSR package version - always increments)
- `packages/tools/dz-review/cli.ts` (CLI_VERSION constant - tool version)
- No skill import to update (the workflow skill has no CLI wrapper yet)

**Always (manual step 1b):**

- `packages/tools/CHANGELOG.md` (add new `[wl-vX.Y.Z] — YYYY-MM-DD` section)

### Phase 2: Post-Release (`task bump-finalize`)

Updates files that depend on the GitHub release existing:

**For released tools:**

- `homebrew/Formula/{tool}.rb` (version, URLs, and checksums from GH release)
- `CLI_SETUP.md` (version references in examples)
- `MISE_SETUP.md` (version references in examples)
- `plugins/tools/.claude-plugin/plugin.json` (Claude plugin version)
- `plugins/tools/.codex-plugin/plugin.json` (Codex plugin version)
- `.claude-plugin/marketplace.json` (Claude marketplace metadata/plugin versions)

For `dz-review`, `bump-finalize` skips plugin metadata version updates because the CLI version is independent from the global `tools` plugin version and the review workflow skill has no versioned JSR wrapper.

**Important:** The two-phase approach ensures:

1. Skill imports reference the JSR version that will be published
2. Homebrew checksums are calculated from actual GitHub release binaries
3. Documentation references don't point to non-existent releases

## Bundle Releases (mise)

Bundle releases combine wl + md + recap + dz-review for the mise backend (`dohzya/mise-tools`).

```bash
# 1. Verify latest tool releases exist
gh release list | head -5

# 2. Create bundle tag (no tool prefix)
git tag v0.6.0 && git push origin v0.6.0

# 3. Update mise-tools repo if its hard-coded bundled tool list changed
cd ~/bin/share/mise-tools-prep
# Update bundled tools, commit, push, tag
```

**Tag naming:**

- Bundle tags: `vX.Y.Z` (no tool prefix)
- Tool tags: `wl-vX.Y.Z`, `md-vX.Y.Z`, `recap-vX.Y.Z`, or `dz-review-vX.Y.Z`

## Build-Flag Release

Use this when the release changes **compiled binary behavior** such as Deno compile permissions or other build flags.

**Important:** the GitHub release workflow compiles binaries from the published JSR package, not from the checkout source directly. It uses direct versioned JSR URLs (`https://jsr.io/@dohzya/tools/<deno.json version>/...`) to avoid waiting for package index metadata propagation, but a build-flag release still needs a normal JSR bump and publish when the CLI `VERSION` changes. Otherwise the published binary may use new compile flags but still contain old TypeScript code and report the old tool version.

Follow the normal release process above. Do **not** skip `bump-prepare`, `CHANGELOG.md`, or `gh workflow run publish.yml` just because the TypeScript logic is unchanged.

```bash
# 0. Validate
task validate

# 1. Prepare a normal release bump
echo y | task bump-prepare TOOL=wl TOOL_VERSION=X.Y.Z JSR_VERSION=A.B.C

# 2. Update CHANGELOG.md

# 3. Validate, commit, push
task validate
git add -A && git commit -m "chore(wl): bump to vX.Y.Z"
git push origin main

# 4. Wait for CI to pass
gh run watch

# 5. Publish JSR, then tag after publish is green
gh workflow run publish.yml
gh run watch
git tag wl-vX.Y.Z && git push origin wl-vX.Y.Z

# 6. Wait for release workflow to build binaries
gh run watch

# 7. Finalize release (updates homebrew checksums, docs, plugin metadata)
task bump-finalize TOOL=wl VERSION=X.Y.Z
git add -A && git commit -m "chore(wl): finalize vX.Y.Z release"
git push origin main

# 8. Update homebrew tap
task update-tap TOOL=wl VERSION=X.Y.Z

# 9. Verify installation
brew upgrade wl && wl --version
```

**When this applies:**

- Adding a new `--allow-run=<binary>` permission to the compiled binary
- Changing other `deno compile` flags
- Any infrastructure/build change with no TypeScript code change

## Common Pitfalls

| Problem                                | Cause                                | Fix                                                      |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Published JSR with wrong version       | Didn't validate before commit        | Always `task validate` before commit                     |
| Binary shows wrong version             | JSR published from wrong commit      | Ensure CI is green, re-run `gh workflow run publish.yml` |
| Tag triggered build failure            | CI wasn't green on main              | **Never tag until CI passes** - delete tag and retry     |
| deno.json at wrong version             | Only bumped tool version             | deno.json MUST bump every release (it's the JSR pkg)     |
| Tool feature missing from Homebrew     | Changed tool was not included in tag | Run the scope audit; bump, tag, finalize, and verify it  |
| Homebrew checksum mismatch             | Checksums from local build           | Re-run `task update-tap` (downloads from GH release)     |
| Homebrew/docs point to missing release | bump script ran too early            | These files updated AFTER release exists                 |
| "Package not found" during build       | JSR publish missing or wrong version | Check JSR has correct version, republish if needed       |
| Can't republish to JSR                 | Same version exists                  | Bump to new version number                               |
| brew upgrade shows old version         | Tap not updated                      | Run `task update-tap`                                    |
| Workflow fails "version mismatch"      | Tag version doesn't match any tool   | Tag must match a tool version (wl or md cli.ts)          |

## Troubleshooting

### GitHub Actions failed?

```bash
# View failed logs
gh run view --log-failed

# Check what version was attempted
gh run view | grep "JSR version"
```

### Need to redo a release?

```bash
# Delete release and tag
gh release delete wl-v0.5.0 -y
git tag -d wl-v0.5.0
git push origin :refs/tags/wl-v0.5.0

# Fix issue, ensure CI passes, then re-tag
git tag wl-v0.5.0 && git push origin wl-v0.5.0
```

### Rollback completely?

```bash
git revert HEAD  # Revert version bump
git push
# Note: JSR versions cannot be deleted, must publish new version
```

### CI not passing after push?

```bash
# View CI status
gh run list --branch main --limit 1

# Don't create tags until this shows ✓
gh run watch
```

### Validation failing?

```bash
# Run locally to see errors
task validate

# Common issues:
# - Formatting (task fmt)
# - Type errors (check imports after bump)
# - Test failures (fix tests first)
```

## Local Testing (Optional)

Test CI before pushing:

```bash
# Requires act (GitHub Actions local runner)
mise exec -- act push --container-architecture linux/amd64
```

Test binary locally (after JSR publish via CI):

```bash
task build VERSION=0.5.0
./dist/wl-darwin-arm64 --version  # Should show correct version
```

## Post-release Checklist

After successful release:

- [ ] `wl --version` (or `md --version`, `recap --version`, or `dz-review --version`) shows correct version
- [ ] GitHub release exists with all platform binaries
- [ ] Homebrew formula updated and installable
- [ ] (Optional) mise backend updated if doing bundle release or changing the bundled tool list
- [ ] (Optional) Claude plugin marketplace updated

## Lessons Learned (REX-04vcuw)

Historical context - what went wrong and how this process was improved:

1. **Validation was skipped** → Now mandatory at steps 0, 1b
2. **Tags created before CI passed** → Now CI is a mandatory gate (step 5)
3. **JSR published with wrong code** → Now published via CI from committed code on main (step 5)
4. **Version confusion** → Now explicit "Version Semantics" section
5. **Workflow read wrong version** → Now reads from deno.json, not tag
6. **Bump script too eager** → Homebrew checksums only updated after release exists
7. **Used `wl add` instead of `wl trace`** → Now explicit in Claude Code Integration
8. **CHANGELOG written from commit names without reading the actual diffs** → Never infer changelog content from commit subjects; always read the actual diff (`git show <hash>`) to describe what was truly implemented

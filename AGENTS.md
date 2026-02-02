# Guidelines for AI Agents

## Project Setup

**First time setup:** Run `bash setup.sh` to install mise and Deno.

This will:

- Install [mise](https://mise.jdx.dev/) if not present
- Install Deno (latest version)
- Trust the repository's `mise.toml`

**Available commands:**

```bash
task fmt       # Format code
task test      # Run tests only
task check     # Check code (format + type + lint)
task validate  # Run all checks (fmt + check + lint + test)
```

## Pre-commit Checks

**CRITICAL:** Before saying you're done with any code changes, ALWAYS run:

```bash
task validate  # Runs fmt + check + lint + test
```

**Do not skip this step** - if any check fails, fix the issues before
committing. These checks are enforced by CI.

## Creating Releases

When it's time to create a new release, refer to [RELEASE.md](RELEASE.md) for
the complete release process, including:

- Automated scripts (`task bump`, `task build`, `task update-tap`)
- Manual step-by-step instructions
- Critical order of operations (JSR publish BEFORE building binaries!)
- Bundle releases (combining wl + md for mise backend)
- Common pitfalls and troubleshooting

**Important:** For bundle releases, always verify which tool versions will be
included BEFORE pushing the tag:

```bash
# Note: gh release list is tab-separated
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^wl-v/ {print $3; exit}'
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^md-v/ {print $3; exit}'
```

## CHANGELOG.md

You can and should maintain `packages/tools/CHANGELOG.md` when making changes.

**Important rules:**

1. **NEVER modify existing entries** - the history is immutable
   - Don't change version numbers, dates, or descriptions of past releases
   - Only fix typos if absolutely necessary
2. **ONLY add new entries** at the top
   - Add a new `## [X.Y.Z]` section for the new version
   - Document what changed in this release
3. When bumping version, use the automation script:
   - Run `task bump TOOL=wl VERSION=X.Y.Z` (updates all files)
   - Or follow manual checklist in [RELEASE.md](RELEASE.md)
   - Add new CHANGELOG entry

## Worklog Usage

**IMPORTANT:** For any work session, you must systematically:

1. **Create a worklog task** if one doesn't exist:
   ```bash
   wl add --desc "Description of the work to be done"
   ```
   This returns a task ID (e.g., `260202n`)

2. **Trace each significant action** as you work:
   ```bash
   wl trace <task-id> "Description of the action taken"
   ```
   Trace reading files, making changes, running tests, etc.

3. **Mark the task as done** when work is complete:
   ```bash
   wl done <task-id> "Summary of changes" "What was learned"
   ```

This helps maintain a clear record of all work done and supports effective
collaboration and progress tracking.

### .worklog/ Directory

The `.worklog/` directory is a local working directory and should never be
committed to git.

It is already in `.gitignore`.

# Guidelines for AI Agents

## Project Setup

**First time setup:** Run `bash setup.sh` to install mise and Deno.

This will:

- Install [mise](https://mise.jdx.dev/) if not present
- Install Deno (latest version)
- Trust the repository's `mise.toml`

**Available commands:**

```bash
mise run test   # Run tests
mise run check  # Type check
mise run fmt    # Format code
mise run lint   # Lint code
mise run ci     # Run all checks (what CI runs)
```

Or use Deno directly:

```bash
deno task validate  # Run all checks (fmt + check + lint + test)
deno task test      # Run tests only
deno fmt            # Format code
deno lint           # Lint code
deno check          # Type check
```

## Pre-commit Checks

**CRITICAL:** Before saying you're done with any code changes, ALWAYS run:

```bash
deno task validate  # Runs fmt + check + lint + test
```

**Do not skip this step** - if any check fails, fix the issues before
committing. These checks are enforced by CI.

## CHANGELOG.md

You can and should maintain `packages/tools/CHANGELOG.md` when making changes.

**Important rules:**

1. **NEVER modify existing entries** - the history is immutable
   - Don't change version numbers, dates, or descriptions of past releases
   - Only fix typos if absolutely necessary
2. **ONLY add new entries** at the top
   - Add a new `## [X.Y.Z]` section for the new version
   - Document what changed in this release
3. When bumping version:
   - Update `packages/tools/deno.json`
   - Update `.claude-plugin/marketplace.json`
   - Update `plugins/dz-skills/.claude-plugin/plugin.json`
   - Update CLI wrappers (`md`, `wl`, etc.)
   - Add new CHANGELOG entry

## .worklog/

The `.worklog/` directory is a local working directory and should never be
committed to git.

It is already in `.gitignore`.

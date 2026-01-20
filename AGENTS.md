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
deno test --allow-read --allow-write
deno check packages/tools/mod.ts
deno fmt
deno lint
```

## Pre-commit Checks

**CRITICAL:** Before saying you're done with any code changes, ALWAYS run these
commands:

```bash
deno fmt        # Format all code
deno lint       # Check for linting issues
deno check packages/tools/mod.ts  # Type check
deno test --allow-read --allow-write  # Run tests
```

These checks are enforced by CI, so catch issues early by running them locally
first.

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

The `.worklog/` directory is a local working directory and should never be committed to git.

It is already in `.gitignore`.

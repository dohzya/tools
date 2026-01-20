# Guidelines for AI Agents

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

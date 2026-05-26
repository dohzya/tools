# Codex Plugin Installation

This guide explains how to use the tools plugin with Codex while keeping Claude Code support unchanged.

## Prerequisites

- Codex configured with plugin support
- Deno installed for local CLI development and validation
- Optional: Homebrew or mise for installing the standalone `md` and `wl` CLIs

## Plugin Metadata

Codex metadata lives in two repository-local hidden directories:

- `plugins/tools/.codex-plugin/plugin.json` is the Codex plugin manifest, parallel to `plugins/tools/.claude-plugin/plugin.json`.
- `.agents/plugins/marketplace.json` is optional local discovery metadata. It lets an agent discover this repository's plugin from `./plugins/tools`; it is not user preference state.

These files are part of the repository contract, not generated local configuration.

## CLI Setup

For normal CLI use, install `md` and `wl` using one of the methods in [CLI_SETUP.md](CLI_SETUP.md):

```bash
brew tap dohzya/tools && brew install md wl
```

For repository development, use the local Deno entrypoints instead of the installed JSR versions:

```bash
deno -A packages/tools/markdown-surgeon/cli.ts <command>
deno -A packages/tools/worklog/cli.ts <command>
```

## Available Skills

- **markdown-surgeon**: surgically edit Markdown files by section.
- **worklog**: track work progress with traces, checkpoints, and agent-aware context.
- **obsidian-journal**: create timestamped journal entries through an Obsidian MCP server.
- **rex-session**: generate structured REX / post-mortem summaries from technical sessions.

## Worklog With Codex

Use Codex-specific commands when you know the agent, or `--agent` when you want auto-detection:

```bash
wl codex <task-id>
wl agent <task-id>
wl checkpoint --codex
wl checkpoint --agent
wl done --codex
wl done --agent
```

Inside a `wl codex` or `wl agent` session, `WORKLOG_TASK_ID` is set automatically. Do not prefix commands with `WORKLOG_TASK_ID=...`; use plain commands such as:

```bash
wl trace "Implemented Codex manifest validation"
wl show
```

## Known Limits

- Claude Code hooks in [CLAUDE_SETUP.md](CLAUDE_SETUP.md) configure Claude Code only. They do not automatically install equivalent Codex hooks unless Codex provides and is configured with a matching hook mechanism.
- The `obsidian-journal` skill requires an Obsidian MCP server with vault access in the active agent environment.

## Validation

Validate Codex plugin metadata without requiring the Claude CLI:

```bash
task validate:plugin:codex
```

Full repository validation still includes Claude plugin validation:

```bash
task validate
```

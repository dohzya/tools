# Claude Code Plugin Installation

This guide explains how to install the tools plugin for Claude Code.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed

## Installation

### Method 1: Via Marketplace (Recommended)

Add the marketplace and install the plugin:

```bash
# Add the marketplace
claude plugin marketplace add https://github.com/dohzya/tools

# Install the plugin
claude plugin install tools
```

### Method 2: Manual Installation

Clone the repository to your Claude plugins directory:

```bash
# Clone the repository
git clone https://github.com/dohzya/tools.git ~/.local/share/claude/plugins/tools

# Enable the plugin
claude plugin enable tools
```

## Verify Installation

Check that the plugin is enabled:

```bash
claude plugin list
```

You should see `tools` in the list of enabled plugins.

## Available Skills

Once installed, the following skills will be available in Claude Code:

- **markdown-surgeon**: Manipulate Markdown files surgically by section
- **obsidian-journal**: Create journal entries in Obsidian
- **rex-session**: Generate structured REX (Post-Mortem) from conversations
- **worklog**: Track work progress with append-only worklog

See the main [README](README.md) for detailed skill descriptions.

## Recommended Hooks

For the worklog skill, configure these hooks in `~/.claude/settings.json` to get automatic checkpoints on compaction and task context injection on session start:

```json
{
  "hooks": {
    "PreCompact": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "wl checkpoint --claude -q"}]}
    ],
    "SessionStart": [
      {"matcher": "startup", "hooks": [{"type": "command", "command": "wl show -q"}]},
      {"matcher": "compact", "hooks": [{"type": "command", "command": "wl show -q"}]}
    ]
  }
}
```

The `-q` flag silently no-ops when no worklog task is active — safe to configure globally.

## Updating

To update the plugin to the latest version:

```bash
# If installed via marketplace
claude plugin update tools

# If installed manually
cd ~/.local/share/claude/plugins/tools
git pull origin main
```

## Uninstalling

```bash
# Disable the plugin
claude plugin disable tools

# Remove it completely
claude plugin uninstall tools
```

## Troubleshooting

### Plugin not found

Make sure you've added the marketplace first:

```bash
claude plugin marketplace add https://github.com/dohzya/tools
claude plugin marketplace list
```

### Skills not appearing

Restart Claude Code after installation:

```bash
# Exit and restart your Claude Code session
```

### Manual installation path issues

Verify the plugin is in the correct directory:

```bash
ls -la ~/.local/share/claude/plugins/tools
```

The directory should contain a `plugins/` folder with the skill definitions.

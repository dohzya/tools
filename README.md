# dz-skills

A collection of Claude Code skills for markdown manipulation and productivity.

## Installation

Add this plugin to Claude Code:

```bash
claude mcp add-skill https://github.com/dohzya/dz-skills
```

## Skills

### markdown-surgeon

Manipulate Markdown files surgically by section without loading entire content.
Useful for:

- Editing large .md files
- Updating specific sections
- Using Markdown as a lightweight database

Commands: `outline`, `read`, `write`, `append`, `empty`, `remove`, `search`,
`concat`, `meta`, `create`

### obsidian-journal

Create journal entries in Obsidian. Use when storing, saving, or recording
information for later reference.

### rex-session

Generate structured REX (Retour d'EXpérience / Post-Mortem) from technical
conversations.

### work-journal

Automatically maintain work documentation during project tasks with WORKLOG.md
and CHANGES.md.

### worklog

Track work progress with append-only worklog and on-demand checkpoints.
Activates when `.worklog/` exists or user says "track this".

Commands: `wl init`, `wl add`, `wl trace`, `wl logs`, `wl checkpoint`,
`wl done`, `wl list`, `wl summary`

## Library

The core functionality is available as a JSR package:

```typescript
import { parseDocument } from "@dohzya/tools/markdown-surgeon";
```

See [packages/tools/README.md](packages/tools/README.md) for API documentation.

## CLI Tools Installation

The `md` (markdown-surgeon) and `wl` (worklog) tools can be installed as
standalone CLI tools without cloning this repository.

### Via Homebrew (macOS/Linux)

```bash
# Add the tap
brew tap dohzya/dz-tools

# Install individual tools
brew install md
brew install wl

# Or both at once
brew install md wl
```

### Via mise (using ubi backend)

Add to your `.mise.toml`:

```toml
[tools]
"ubi:dohzya/dz-skills" = { exe = "md", matching = "md-*" }
"ubi:dohzya/dz-skills#wl" = { exe = "wl", matching = "wl-*" }
```

Then run:

```bash
mise install
```

### Via Deno

If you have Deno installed:

```bash
# Install md
deno install -g --allow-read --allow-write -n md \
  jsr:@dohzya/tools/markdown-surgeon/cli

# Install wl
deno install -g --allow-read --allow-write --allow-run=git -n wl \
  jsr:@dohzya/tools/worklog/cli
```

### Manual Installation

Download pre-compiled binaries from
[GitHub Releases](https://github.com/dohzya/dz-skills/releases):

1. Find the latest release for your tool (`md-v*` or `wl-v*`)
2. Download the binary for your platform (e.g., `md-darwin-arm64` for macOS ARM)
3. Make it executable: `chmod +x md-darwin-arm64`
4. Move to your PATH: `mv md-darwin-arm64 ~/.local/bin/md`

## Development

```bash
# Check types
deno task check

# Run tests
deno task test
```

## License

MIT

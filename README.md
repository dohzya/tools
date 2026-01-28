# @dohzya/tools

A collection of CLI tools and Claude Code skills for markdown manipulation and
productivity.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![JSR](https://jsr.io/badges/@dohzya/tools)](https://jsr.io/@dohzya/tools)

**Quick Links:** [Claude Code Setup](CLAUDE_SETUP.md) ·
[CLI Tools Setup](CLI_SETUP.md) · [Library API](packages/tools/README.md)

## What's in this repo?

This repository provides three ways to use the tools:

1. **Claude Code Skills** - AI-powered workflows in Claude Code
2. **CLI Tools** - Standalone command-line tools (`md`, `wl`)
3. **TypeScript Library** - Importable package from JSR

## Installation

Choose your preferred method:

| Method          | Command                                                  | Best For               |
| --------------- | -------------------------------------------------------- | ---------------------- |
| **Claude Code** | See [CLAUDE_SETUP.md](CLAUDE_SETUP.md)                   | AI-assisted workflows  |
| **Homebrew**    | `brew tap dohzya/tools && brew install md wl`            | macOS/Linux users      |
| **mise**        | `mise use -g github:dohzya/tools@md-v0.4.0`              | Project-based installs |
| **Deno**        | `deno install -g jsr:@dohzya/tools/markdown-surgeon/cli` | Deno users             |
| **Library**     | `deno add @dohzya/tools`                                 | TypeScript projects    |

See [CLI_SETUP.md](CLI_SETUP.md) for detailed CLI installation options.

## Available Tools & Skills

| Name                 | Description                                                              | Available As                 |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| **markdown-surgeon** | Surgically edit Markdown files by section without loading entire content | Skill · CLI (`md`) · Library |
| **worklog**          | Track work progress with append-only logs and on-demand checkpoints      | Skill · CLI (`wl`) · Library |
| **obsidian-journal** | Create journal entries in Obsidian for later reference                   | Skill only                   |
| **rex-session**      | Generate structured REX (Post-Mortem) from technical conversations       | Skill only                   |

### markdown-surgeon

Manipulate large Markdown files efficiently:

```bash
# CLI
md outline document.md
md read document.md "Section Title"
md write document.md "Section" "Content"
```

```typescript
// Library
import { parseDocument } from "@dohzya/tools/markdown-surgeon";
const doc = parseDocument(markdown);
```

**Use cases:**

- Editing large .md files (READMEs, documentation)
- Updating specific sections without full file rewrites
- Using Markdown as a lightweight database

**Commands:** `outline`, `read`, `write`, `append`, `empty`, `remove`, `search`,
`concat`, `meta`, `create`

### worklog

Track your work progress with structured logging:

```bash
# CLI
wl init
wl add "Implemented feature X"
wl checkpoint "v1.0 feature complete"
wl logs
```

**Use cases:**

- Logging work progress during development
- Creating checkpoints at milestones
- Generating summaries for reports or PRs

**Commands:** `init`, `add`, `trace`, `logs`, `checkpoint`, `done`, `list`,
`summary`

**Activates automatically** in Claude Code when `.worklog/` exists or user says
"track this".

### obsidian-journal

Claude Code skill for creating timestamped journal entries in Obsidian.

**Use when:** storing, saving, or recording information for later reference.

### rex-session

Claude Code skill for generating structured REX (Retour d'EXpérience /
Post-Mortem) documents from technical conversations.

**Use when:** documenting incidents, project retrospectives, or technical
decisions.

## Library Usage

The core functionality is available as a JSR package:

```typescript
import { parseDocument } from "@dohzya/tools/markdown-surgeon";

const markdown = `# Title\n## Section 1\nContent`;
const doc = parseDocument(markdown);
console.log(doc.sections);
```

See [packages/tools/README.md](packages/tools/README.md) for complete API
documentation.

## Development

```bash
# Run tests
task test

# Check code (format + type + lint)
task check

# Format code
task fmt

# Run all checks
task validate
```

See [AGENTS.md](AGENTS.md) for AI agent guidelines when contributing.

## Documentation

- [CLAUDE_SETUP.md](CLAUDE_SETUP.md) - Claude Code plugin installation
- [CLI_SETUP.md](CLI_SETUP.md) - CLI tools installation (Homebrew, mise, Deno)
- [HOMEBREW_SETUP.md](HOMEBREW_SETUP.md) - Detailed Homebrew usage
- [MISE_SETUP.md](MISE_SETUP.md) - Detailed mise configuration
- [RELEASE.md](RELEASE.md) - Release process for maintainers
- [packages/tools/README.md](packages/tools/README.md) - TypeScript library API

## License

MIT

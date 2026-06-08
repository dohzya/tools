# @dohzya/tools

A collection of CLI tools and AI agent skills for markdown manipulation and productivity.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![JSR](https://jsr.io/badges/@dohzya/tools)](https://jsr.io/@dohzya/tools)

**Quick Links:** [Claude Code Setup](CLAUDE_SETUP.md) · [Codex Setup](CODEX_SETUP.md) · [CLI Tools Setup](CLI_SETUP.md) · [Library API](packages/tools/README.md)

## What's in this repo?

This repository provides three ways to use the tools:

1. **AI Agent Skills** - AI-powered workflows in Claude Code and Codex
2. **CLI Tools** - Standalone command-line tools (`md`, `wl`)
3. **TypeScript Library** - Importable package from JSR

## Installation

Choose your preferred method:

| Method          | Command                                                  | Best For               |
| --------------- | -------------------------------------------------------- | ---------------------- |
| **Claude Code** | See [CLAUDE_SETUP.md](CLAUDE_SETUP.md)                   | AI-assisted workflows  |
| **Codex**       | See [CODEX_SETUP.md](CODEX_SETUP.md)                     | AI-assisted workflows  |
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
| **docs-maintainer**  | Maintain and review source-verified project documentation                | Skill only                   |

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

**Commands:** `outline`, `read`, `write`, `append`, `empty`, `remove`, `search`, `concat`, `meta`, `create`

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

**Commands:** `init`, `add`, `trace`, `logs`, `checkpoint`, `done`, `list`, `summary`

**Activates automatically** in supported agents when `.worklog/` exists or user says "track this".

### obsidian-journal

AI agent skill for creating timestamped journal entries in Obsidian.

**Use when:** storing, saving, or recording information for later reference.

### rex-session

AI agent skill for generating structured REX (Retour d'EXpérience / Post-Mortem) documents from technical conversations.

**Use when:** documenting incidents, project retrospectives, or technical decisions.

### docs-maintainer

AI agent skill for maintaining and reviewing project documentation under `docs/`.

**Use when:** creating, updating, organizing, or reviewing durable project documentation.

## Library Usage

The core functionality is available as a JSR package:

```typescript
import { parseDocument } from "@dohzya/tools/markdown-surgeon";

const markdown = `# Title\n## Section 1\nContent`;
const doc = parseDocument(markdown);
console.log(doc.sections);
```

See [packages/tools/README.md](packages/tools/README.md) for complete API documentation.

## Development

**First-time setup:**

```bash
bash setup.sh  # Installs mise and Deno
```

**Commands:**

```bash
task test      # Run tests
task fmt       # Format code
task validate  # Run all checks (fmt + check + lint + test)
```

**Testing local changes:**

⚠️ Installed CLI tools (`wl`, `md`) use published JSR versions. To test local code:

```bash
deno -A packages/tools/worklog/cli.ts <command>
deno -A packages/tools/markdown-surgeon/cli.ts <command>
```

CLI test environment notes:

- Unset `NO_COLOR` when running tests that assert ANSI-colored output.
- Unset `WORKLOG_TASK_ID` when running worklog tests so agent context does not change CLI defaults.

See [AGENTS.md](AGENTS.md) for AI agent guidelines when contributing.

## Documentation

- [CLAUDE_SETUP.md](CLAUDE_SETUP.md) - Claude Code plugin installation
- [CODEX_SETUP.md](CODEX_SETUP.md) - Codex plugin installation
- [CLI_SETUP.md](CLI_SETUP.md) - CLI tools installation (Homebrew, mise, Deno)
- [HOMEBREW_SETUP.md](HOMEBREW_SETUP.md) - Detailed Homebrew usage
- [MISE_SETUP.md](MISE_SETUP.md) - Detailed mise configuration
- [RELEASE.md](RELEASE.md) - Release process for maintainers
- [packages/tools/README.md](packages/tools/README.md) - TypeScript library API

## License

MIT

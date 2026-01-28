# CLI Tools Installation

The `md` (markdown-surgeon) and `wl` (worklog) tools can be installed as
standalone CLI tools.

## Installation Methods

### Via Homebrew (macOS/Linux) - Recommended

```bash
# Add the tap
brew tap dohzya/tools

# Install individual tools
brew install md
brew install wl

# Or both at once
brew install md wl
```

See [HOMEBREW_SETUP.md](HOMEBREW_SETUP.md) for detailed Homebrew usage.

### Via mise (using github backend)

Install directly:

```bash
mise use -g github:dohzya/tools@md-v0.4.0
mise use -g github:dohzya/tools@wl-v0.4.3
```

Or add to your `.mise.toml`:

```toml
[tools]
"github:dohzya/tools@md-v0.4.0" = "latest"
"github:dohzya/tools@wl-v0.4.3" = "latest"
```

Then run `mise install`.

See [MISE_SETUP.md](MISE_SETUP.md) for detailed mise configuration.

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
[GitHub Releases](https://github.com/dohzya/tools/releases):

1. Find the latest release for your tool (`md-v*` or `wl-v*`)
2. Download the binary for your platform (e.g., `md-darwin-arm64` for macOS ARM)
3. Make it executable: `chmod +x md-darwin-arm64`
4. Move to your PATH: `mv md-darwin-arm64 ~/.local/bin/md`

## Available Tools

### md (markdown-surgeon)

Manipulate Markdown files surgically by section.

```bash
# Show document outline
md outline document.md

# Read a specific section
md read document.md "Section Title"

# Write to a section
md write document.md "Section Title" "New content"

# Search across files
md search "pattern" docs/
```

See the [markdown-surgeon skill](plugins/tools/skills/markdown-surgeon/SKILL.md)
for complete command reference.

### wl (worklog)

Track work progress with append-only logs and checkpoints.

```bash
# Initialize worklog
wl init

# Add entry
wl add "Working on feature X"

# Create checkpoint
wl checkpoint "Checkpoint name"

# View logs
wl logs
```

See the [worklog skill](plugins/tools/skills/worklog/SKILL.md) for complete
command reference.

## Updating

### Homebrew

```bash
brew update
brew upgrade md wl
```

### mise

```bash
mise upgrade md wl
```

### Deno

Reinstall with the latest version:

```bash
deno install -g --allow-read --allow-write -n md -f \
  jsr:@dohzya/tools/markdown-surgeon/cli
```

## Uninstalling

### Homebrew

```bash
brew uninstall md wl
brew untap dohzya/tools
```

### mise

```bash
mise uninstall md wl
```

### Deno

```bash
deno uninstall md wl
```

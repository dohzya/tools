# CLI Tools Installation

The `md` (markdown-surgeon) and `wl` (worklog) tools can be installed as standalone CLI tools.

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

### Via mise (using custom backend)

Install both tools as a bundle:

```bash
mise use https://github.com/dohzya/mise-tools@v0.5.0
```

Or add to your `.mise.toml`:

```toml
[tools]
"https://github.com/dohzya/mise-tools" = "0.5.0"  # Installs md + wl
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

Download pre-compiled binaries from [GitHub Releases](https://github.com/dohzya/tools/releases):

1. Find the latest release for your tool (`md-v0.7.0*` or `wl-v0.9.1*`)
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

See the [markdown-surgeon skill](plugins/tools/skills/markdown-surgeon/SKILL.md) for complete command reference.

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

See the [worklog skill](plugins/tools/skills/worklog/SKILL.md) for complete command reference.

## Shell Completions

Both `wl` and `md` support tab completion for bash, zsh, and fish.

### Fish

Add to `~/.config/fish/config.fish` (or a file in `~/.config/fish/conf.d/`):

```fish
# Tab completions for wl and md
wl completions fish | source
md completions fish | source
```

### Bash

Add to `~/.bashrc`:

```bash
# Tab completions for wl and md
eval "$(wl completions bash)"
eval "$(md completions bash)"
```

### Zsh

Add to `~/.zshrc`:

```zsh
# Tab completions for wl and md
eval "$(wl completions zsh)"
eval "$(md completions zsh)"
```

## Updating

### Homebrew

```bash
brew update
brew upgrade md wl
```

### mise

```bash
mise upgrade https-github-com-dohzya-mise-tools
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
mise uninstall https-github-com-dohzya-mise-tools
```

### Deno

```bash
deno uninstall md wl
```

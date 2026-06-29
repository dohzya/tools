# CLI Tools Installation

The `md` (markdown-surgeon), `wl` (worklog), `recap`, and `dz-review` tools can be installed as standalone CLI tools.

## Installation Methods

### Via Homebrew (macOS/Linux) - Recommended

```bash
# Add the tap
brew tap dohzya/tools

# Install individual tools
brew install md
brew install wl
brew install recap
brew install dz-review

# Or several at once
brew install md wl recap dz-review
```

See [HOMEBREW_SETUP.md](HOMEBREW_SETUP.md) for detailed Homebrew usage.

### Via mise (using custom backend)

Install all tools as a bundle:

```bash
mise plugins install mise-tools https://github.com/dohzya/mise-tools.git
mise use mise-tools@X.Y.Z
```

Or add to your `.mise.toml`:

```toml
[tools]
mise-tools = "X.Y.Z"  # Installs md + wl + recap + dz-review
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
deno install -g --allow-read --allow-write --allow-env --allow-run=git,claude,codex -n wl \
  jsr:@dohzya/tools/worklog/cli

# Install recap
deno install -g --allow-read --allow-write --allow-env --allow-run -n recap \
  jsr:@dohzya/tools/recap/cli

# Install dz-review
deno install -g --allow-read --allow-write --allow-env --allow-run -n dz-review \
  jsr:@dohzya/tools/dz-review/cli
```

### Manual Installation

Download pre-compiled binaries from [GitHub Releases](https://github.com/dohzya/tools/releases):

1. Find the latest release for your tool (`md-v0.8.0*`, `wl-v0.19.0*`, `recap-v0.4.0*`, or `dz-review-v0.3.0*`)
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

### recap

Build compact project context snapshots for humans and agents.

```bash
# Snapshot the current directory
recap

# Snapshot another directory
recap -C ../project

# Show selected configured sections
recap show status
```

### dz-review

Inspect and maintain Markdown review conversations and annotations.

```bash
# Inspect review state
dz-review status docs/file.md

# Normalize timestamps for reading
dz-review ts -i -I docs/file.md

# Restore compact timestamps before handing back
dz-review ts -i -S docs/file.md
```

See the [markdown review workflow skill](plugins/tools/skills/markdown-review-workflow/SKILL.md) for agent workflow guidance.

## Shell Completions

The CLI tools support tab completion for bash, zsh, and fish.

### Fish

Add to `~/.config/fish/config.fish` (or a file in `~/.config/fish/conf.d/`):

```fish
# Tab completions for the tools
wl completions fish | source
md completions fish | source
recap completions fish | source
dz-review completions fish | source
```

### Bash

Add to `~/.bashrc`:

```bash
# Tab completions for the tools
eval "$(wl completions bash)"
eval "$(md completions bash)"
eval "$(recap completions bash)"
eval "$(dz-review completions bash)"
```

### Zsh

Add to `~/.zshrc`:

```zsh
# Tab completions for the tools
eval "$(wl completions zsh)"
eval "$(md completions zsh)"
eval "$(recap completions zsh)"
eval "$(dz-review completions zsh)"
```

## Updating

### Homebrew

```bash
brew update
brew upgrade md wl recap dz-review
```

### mise

```bash
mise upgrade mise-tools
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
brew uninstall recap dz-review
brew untap dohzya/tools
```

### mise

```bash
mise uninstall mise-tools
```

### Deno

```bash
deno uninstall md wl recap dz-review
```

# Installing md and wl via Homebrew

This guide explains how to install the `md` (markdown-surgeon) and `wl`
(worklog) CLI tools using Homebrew.

## Prerequisites

- Homebrew installed ([brew.sh](https://brew.sh))
- macOS or Linux

## Installation

### Quick Start

```bash
# Add the tap
brew tap dohzya/tools

# Install both tools
brew install md wl
```

### Install Individual Tools

```bash
# Install only markdown-surgeon
brew install md

# Or install only worklog
brew install wl
```

## Verification

Check that the tools are installed correctly:

```bash
# Check md
md --help

# Check wl
wl --help
```

## Usage

### Markdown Surgeon (md)

Manipulate Markdown files surgically by section:

```bash
# List sections in a file
md outline README.md

# Read a specific section
md read README.md installation

# Update a section
md write README.md installation "New installation instructions"
```

See the [main repository](https://github.com/dohzya/tools) for complete
documentation.

### Worklog (wl)

Track work progress during development sessions:

```bash
# Initialize worklog in current directory
wl init

# Add a new task
wl add --desc "Implement new feature"

# List active tasks
wl list

# Trace work on a task
wl trace <task-id> "Progress update"

# Create checkpoint
wl checkpoint <task-id> "Changes made" "Things learned"

# Complete task
wl done <task-id> "Changes" "Learnings"
```

See the
[worklog skill documentation](https://github.com/dohzya/tools/tree/main/plugins/tools/skills/worklog)
for complete usage.

## Updating

Keep the tools up to date:

```bash
# Update tap
brew update

# Upgrade tools
brew upgrade md wl
```

Or upgrade all Homebrew packages:

```bash
brew upgrade
```

## Uninstalling

Remove the tools:

```bash
# Uninstall tools
brew uninstall md wl

# Optionally, remove the tap
brew untap dohzya/tools
```

## Troubleshooting

### Command not found after installation

Make sure Homebrew's bin directory is in your PATH:

```bash
# Check your PATH
echo $PATH

# Add to PATH if needed (add to ~/.zshrc or ~/.bashrc)
export PATH="/opt/homebrew/bin:$PATH"  # Apple Silicon
# or
export PATH="/usr/local/bin:$PATH"     # Intel Mac
```

### SHA256 checksum mismatch

The downloaded binary doesn't match the expected checksum. Try:

```bash
# Clear Homebrew cache
brew cleanup md wl

# Reinstall
brew reinstall md wl
```

### Permission denied when running commands

Make sure the binaries are executable:

```bash
chmod +x $(which md)
chmod +x $(which wl)
```

## Alternative Installation Methods

If Homebrew doesn't work for you, see the
[main README](https://github.com/dohzya/tools#cli-tools-installation) for other
installation options:

- mise (with github backend)
- Deno install
- Manual download from GitHub Releases

## Getting Help

- Report issues: <https://github.com/dohzya/tools/issues>
- View source: <https://github.com/dohzya/tools>
- Package: <https://jsr.io/@dohzya/tools>

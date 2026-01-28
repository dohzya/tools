# mise Installation Guide

This guide explains how to install `md` and `wl` using mise with the ubi backend.

## What is the github backend?

The github backend is a mise backend that automatically downloads
pre-compiled binaries from GitHub Releases, detecting the correct platform and
architecture automatically.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed
- GitHub releases with properly named binaries (already set up for dohzya/tools)

## Installation

### Method 1: Direct Command (Recommended)

Install directly with version tag:

```bash
# Install md (markdown-surgeon)
mise use -g github:dohzya/tools@md-v0.4.0

# Install wl (worklog)
mise use -g github:dohzya/tools@wl-v0.4.3
```

### Method 2: Project Configuration

Add to your project's `.mise.toml`:

```toml
[tools]
"github:dohzya/tools@md-v0.4.0" = "latest"
"github:dohzya/tools@wl-v0.4.3" = "latest"
```

Then run:

```bash
mise install
```

### Method 3: Global Configuration

Add to your global mise config (`~/.config/mise/config.toml`):

```toml
[tools]
"github:dohzya/tools@md-v0.4.0" = "latest"
"github:dohzya/tools@wl-v0.4.3" = "latest"
```

Then install:

```bash
mise install
```

## How It Works

The github backend:

1. Looks at the specified GitHub release tag (e.g., `md-v0.4.0`)
2. Downloads the binary asset for your platform (e.g., `md-darwin-arm64` on macOS ARM)
3. Installs it in your mise bin directory (`~/.local/share/mise/installs/...`)
4. Makes it available in your PATH automatically

## Version Pinning

Versions are pinned in the tag name itself:

```toml
[tools]
# Pin to specific versions using @ syntax
"github:dohzya/tools@md-v0.4.0" = "latest"
"github:dohzya/tools@wl-v0.4.3" = "latest"
```

To upgrade to a newer version, change the tag (e.g., `md-v0.5.0`).

## Updating

Update to latest versions:

```bash
mise upgrade
```

Or update specific tools:

```bash
mise upgrade md
mise upgrade wl
```

## Troubleshooting

### Binary not found

Check that releases exist with the expected naming pattern:
- md releases: `md-v*` tags with assets like `md-darwin-arm64`, `md-linux-x86_64`
- wl releases: `wl-v*` tags with assets like `wl-darwin-arm64`, `wl-linux-x86_64`

### Wrong version installed

Check which version is active:

```bash
mise current md
mise current wl
```

Check GitHub releases for available versions:

```bash
gh release list -R dohzya/tools
```

### Permission denied

Make sure binaries are executable (mise should handle this automatically).
If needed, manually fix:

```bash
chmod +x ~/.local/share/mise/installs/github-dohzya-tools/*/md-*
chmod +x ~/.local/share/mise/installs/github-dohzya-tools/*/wl-*
```

## Uninstalling

Remove from configuration and uninstall:

```bash
mise uninstall md
mise uninstall wl
```

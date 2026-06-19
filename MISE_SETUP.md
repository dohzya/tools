# mise Installation Guide

This guide explains how to install `md`, `wl`, `recap`, and `dz-review` using mise with a custom backend.

## What is the custom backend?

The custom mise backend automatically downloads pre-compiled binaries from GitHub Releases, detecting the correct platform and architecture automatically. It supports installing the tools together as a bundle or using Homebrew for individual installations.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed
- GitHub releases with properly named binaries (already set up for dohzya/tools)

## Installation

### Bundle Installation (Recommended)

Install the tools together using the bundle release:

**Direct Command:**

```bash
mise plugins install mise-tools https://github.com/dohzya/mise-tools.git
mise use -g mise-tools@X.Y.Z
```

**Project Configuration (`.mise.toml`):**

```toml
[tools]
mise-tools = "X.Y.Z"  # Installs md + wl + recap + dz-review
```

**Global Configuration (`~/.config/mise/config.toml`):**

```toml
[tools]
mise-tools = "latest"  # Latest bundle
```

Then run `mise install`.

### Individual Installation

For installing tools separately or using different versions, use Homebrew:

```bash
brew install dohzya/tools/wl
brew install dohzya/tools/md
brew install dohzya/tools/recap
brew install dohzya/tools/dz-review
```

## How It Works

The custom mise backend:

1. Looks at the specified GitHub release tag (for example `vX.Y.Z`)
2. Downloads the binary assets for your platform (for example `wl-darwin-arm64`, `md-darwin-arm64`, `recap-darwin-arm64`, and `dz-review-darwin-arm64` on macOS ARM)
3. Installs them in your mise bin directory (`~/.local/share/mise/installs/...`)
4. Makes all bundled tools available in your PATH automatically

## Bundle Versions

Bundle releases contain specific versions of the tools:

- `vX.Y.Z` = `wl` + `md` + `recap` + `dz-review` versions recorded in the GitHub release notes.

To see what versions are in a bundle, check the release notes at: https://github.com/dohzya/tools/releases

## Version Pinning

Pin to specific bundle versions:

```toml
[tools]
mise-tools = "X.Y.Z"  # Specific bundle
mise-tools = "latest" # Latest bundle
```

To upgrade, update the version and run `mise install`.

## Updating

Update to the latest bundle:

```bash
mise upgrade mise-tools
```

Or update your `.mise.toml` version and run:

```bash
mise install
```

## Troubleshooting

### Binary not found

Check that bundle releases exist with the expected naming pattern:

- Bundle releases: `v*` tags with assets like `wl-darwin-arm64`, `md-darwin-arm64`, `recap-darwin-arm64`, `dz-review-darwin-arm64`, etc.

### Wrong version installed

Check which version is active:

```bash
mise current mise-tools
wl --version
md --version
recap --version
dz-review --version
```

Check GitHub releases for available bundles:

```bash
gh release list -R dohzya/tools | grep -v "wl-v\|md-v\|recap-v\|dz-review-v"
```

### Permission denied

Make sure binaries are executable (mise should handle this automatically). If needed, manually fix:

```bash
chmod +x ~/.local/share/mise/installs/github-dohzya-tools/*/bin/*
```

### Need different versions of the tools

The bundle installs fixed versions. For flexibility, use Homebrew instead:

```bash
brew install dohzya/tools/wl
brew install dohzya/tools/md
brew install dohzya/tools/recap
brew install dohzya/tools/dz-review
```

## Uninstalling

Remove from configuration and uninstall:

```bash
mise uninstall github-dohzya-tools
```

# mise Installation Guide

This guide explains how to install `md` and `wl` using mise with a custom backend.

## What is the custom backend?

The custom mise backend automatically downloads pre-compiled binaries from GitHub Releases, detecting the correct platform and architecture automatically. It supports installing both tools together (bundle) or using homebrew for individual installations.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed
- GitHub releases with properly named binaries (already set up for dohzya/tools)

## Installation

### Bundle Installation (Recommended)

Install both tools together using the bundle release:

**Direct Command:**

```bash
mise use -g https://github.com/dohzya/mise-tools@v0.6.0
```

**Project Configuration (`.mise.toml`):**

```toml
[tools]
"https://github.com/dohzya/mise-tools" = "0.6.0"  # Installs md + wl
```

**Global Configuration (`~/.config/mise/config.toml`):**

```toml
[tools]
"https://github.com/dohzya/mise-tools" = "latest"  # Latest bundle
```

Then run `mise install`.

### Individual Installation

For installing tools separately or using different versions, use homebrew:

```bash
brew install dohzya/tools/wl
brew install dohzya/tools/md
```

## How It Works

The custom mise backend:

1. Looks at the specified GitHub release tag (e.g., `v0.5.0`)
2. Downloads both binary assets for your platform (e.g., `wl-darwin-arm64` and `md-darwin-arm64` on macOS ARM)
3. Installs them in your mise bin directory (`~/.local/share/mise/installs/...`)
4. Makes both tools available in your PATH automatically

## Bundle Versions

Bundle releases (e.g., `v0.5.0`) contain specific versions of both tools:

- `v0.6.0` = `wl-0.5.0` + `md-0.4.0`

To see what versions are in a bundle, check the release notes at: https://github.com/dohzya/tools/releases

## Version Pinning

Pin to specific bundle versions:

```toml
[tools]
"https://github.com/dohzya/mise-tools" = "0.6.0"  # Specific bundle
"https://github.com/dohzya/mise-tools" = "latest" # Latest bundle
```

To upgrade, update the version and run `mise install`.

## Updating

Update to the latest bundle:

```bash
mise upgrade github-dohzya-tools
```

Or update your `.mise.toml` version and run:

```bash
mise install
```

## Troubleshooting

### Binary not found

Check that bundle releases exist with the expected naming pattern:

- Bundle releases: `v*` tags (e.g., `v0.5.0`) with assets like `wl-darwin-arm64`, `md-darwin-arm64`, etc.

### Wrong version installed

Check which version is active:

```bash
mise current github-dohzya-tools
wl --version
md --version
```

Check GitHub releases for available bundles:

```bash
gh release list -R dohzya/tools | grep -v "wl-v0.11.0\|md-v0.7.0"
```

### Permission denied

Make sure binaries are executable (mise should handle this automatically). If needed, manually fix:

```bash
chmod +x ~/.local/share/mise/installs/github-dohzya-tools/*/bin/*
```

### Need different versions of md and wl

The bundle installs fixed versions. For flexibility, use homebrew instead:

```bash
brew install dohzya/tools/wl
brew install dohzya/tools/md
```

## Uninstalling

Remove from configuration and uninstall:

```bash
mise uninstall github-dohzya-tools
```

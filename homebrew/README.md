# Homebrew Tap for tools

This directory contains Homebrew formulas for distributing `md` and `wl` CLI tools.

## Setup

### 1. Create Homebrew Tap Repository

Create a new GitHub repository named `homebrew-dz-tools`:

```bash
# Create new repo on GitHub: dohzya/homebrew-dz-tools
git clone https://github.com/dohzya/homebrew-dz-tools.git
cd homebrew-dz-tools
```

### 2. Copy Formulas

Copy the formulas from this directory:

```bash
cp /path/to/tools/homebrew/Formula/*.rb Formula/
git add Formula/
git commit -m "Add md and wl formulas"
git push origin main
```

### 3. Update SHA256 Checksums

After creating releases with binaries, update the SHA256 checksums in each formula:

```bash
# Download binaries from GitHub release
curl -LO https://github.com/dohzya/tools/releases/download/md-v0.3.0/md-darwin-arm64

# Calculate SHA256
shasum -a 256 md-darwin-arm64

# Update the formula with the actual checksum
```

Repeat for each platform/architecture.

## Usage

Once the tap is published, users can install the tools:

```bash
# Add the tap
brew tap dohzya/dz-tools

# Install individual tools
brew install md
brew install wl

# Or install both
brew install md wl
```

## Updating

When releasing a new version:

1. Create new release tags (e.g., `md-v0.4.0`, `wl-v0.4.0`)
2. GitHub Actions will build and upload binaries
3. Update formulas with new version and SHA256 checksums
4. Push to tap repository

## Testing Formulas Locally

Before publishing:

```bash
# Test formula syntax
brew audit --strict Formula/md.rb

# Test installation locally
brew install --build-from-source Formula/md.rb

# Run formula tests
brew test md
```

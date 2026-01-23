# Release Process

This document describes how to create new releases for `md` and `wl` CLI tools.

## Prerequisites

1. Code is tested and ready for release
2. Version is bumped in `packages/tools/deno.json`
3. Package is published to JSR: `deno publish --config packages/tools/deno.json`

## Creating a Release

### 1. Tag and Push

Releases are triggered by git tags with the pattern `<tool>-v<version>`.

For `md` version 0.3.0:

```bash
git tag md-v0.3.0
git push origin md-v0.3.0
```

For `wl` version 0.3.0:

```bash
git tag wl-v0.3.0
git push origin wl-v0.3.0
```

### 2. GitHub Actions

The release workflow (`.github/workflows/release.yml`) will automatically:

1. Compile binaries for all platforms:
   - macOS (arm64, x86_64)
   - Linux (arm64, x86_64)
   - Windows (x86_64)

2. Create a GitHub Release with the binaries as assets

3. The release will be named `<tool> v<version>` (e.g., "md v0.3.0")

### 3. Update Homebrew Formulas

After the release is created:

1. Download binaries and calculate SHA256 checksums:

```bash
# For each platform binary
curl -LO https://github.com/dohzya/tools/releases/download/md-v0.3.0/md-darwin-arm64
shasum -a 256 md-darwin-arm64
```

2. Update the formulas in `homebrew/Formula/`:
   - Replace version number
   - Replace SHA256 checksums for each platform

3. Copy updated formulas to the Homebrew tap repository:

```bash
# In homebrew-dz-tools repo
cp ../tools/homebrew/Formula/*.rb Formula/
git add Formula/
git commit -m "Update md and wl to v0.3.0"
git push origin main
```

## Version Bumping Checklist

When preparing a new version:

- [ ] Update version in `packages/tools/deno.json`
- [ ] Run tests: `deno task test`
- [ ] Publish to JSR: `deno publish --config packages/tools/deno.json`
- [ ] Create git tags for each tool (can be same or different versions)
- [ ] Push tags to trigger releases
- [ ] Wait for GitHub Actions to complete
- [ ] Update and test Homebrew formulas
- [ ] Update mise configuration example if needed

## Testing Releases Locally

Before creating tags, you can test the build process locally:

```bash
./build.sh 0.3.0
```

This will compile binaries for all platforms in the `dist/` directory.

Test the local binary:

```bash
./dist/md-darwin-arm64 --help
./dist/wl-darwin-arm64 --help
```

## Troubleshooting

### Build Fails

- Check that the JSR package version exists
- Verify permissions in `build.sh` match CLI requirements
- Check Deno compile targets are supported

### Homebrew Formula Fails

- Verify SHA256 checksums are correct
- Test formula locally: `brew install --build-from-source Formula/md.rb`
- Run audit: `brew audit --strict Formula/md.rb`

### mise/ubi Installation Fails

- Verify release tags follow the pattern `<tool>-v<version>`
- Check that binary names match the expected pattern in `.mise.toml`
- Test ubi matching pattern manually

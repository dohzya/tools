#!/usr/bin/env bash
set -euo pipefail

# Script to finalize version bump (AFTER GitHub release exists)
# Usage: ./bump-finalize.sh <tool> <version>
#
# Example: ./bump-finalize.sh md 0.5.2
#
# This script updates files that depend on the GitHub release existing:
# - homebrew formulas (version, URLs, and checksums from GH release binaries)
# - documentation (*_SETUP.md with version references)
# - plugin.json
#
# IMPORTANT: This must run AFTER the GitHub release workflow completes
# and binaries are available for download.

TOOL="${1:-}"
VERSION="${2:-}"

if [[ -z "$TOOL" ]] || [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <tool> <version>"
  echo "Example: $0 md 0.5.2"
  exit 1
fi

if [[ "$TOOL" != "wl" ]] && [[ "$TOOL" != "md" ]]; then
  echo "Error: tool must be 'wl' or 'md'"
  exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be in format X.Y.Z (e.g., 0.4.3)"
  exit 1
fi

echo "=== Finalizing $TOOL v$VERSION release ==="
echo ""
echo "This script will:"
echo "  1. Download binaries from GitHub release $TOOL-v$VERSION"
echo "  2. Calculate SHA256 checksums"
echo "  3. Update homebrew/Formula/$TOOL.rb with version, URLs, and checksums"
echo "  4. Update documentation (*_SETUP.md) with version references"
echo "  5. Update plugin.json with version"
echo ""

# Verify GitHub release exists
echo "Verifying GitHub release exists..."
if ! gh release view "$TOOL-v$VERSION" --repo dohzya/tools >/dev/null 2>&1; then
  echo "❌ Error: GitHub release $TOOL-v$VERSION not found"
  echo ""
  echo "Make sure you:"
  echo "  1. Pushed the tag: git push origin $TOOL-v$VERSION"
  echo "  2. Waited for the release workflow to complete: gh run watch"
  echo "  3. Verified the release exists: gh release view $TOOL-v$VERSION"
  exit 1
fi
echo "✓ Release found"
echo ""

read -p "Continue with finalization? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Calculate checksums from GitHub release binaries
echo ""
echo "Downloading binaries from GitHub release to calculate checksums..."
TEMP_DIR=$(mktemp -d)

PLATFORMS=("darwin-arm64" "darwin-x86_64" "linux-arm64" "linux-x86_64")

for platform in "${PLATFORMS[@]}"; do
  echo "  Downloading $TOOL-$platform..."
  if ! curl -sfL "https://github.com/dohzya/tools/releases/download/$TOOL-v$VERSION/$TOOL-$platform" \
    -o "$TEMP_DIR/$TOOL-$platform"; then
    echo "❌ Error: Failed to download binary for $platform"
    echo "Make sure all binaries were built successfully in the release workflow"
    rm -rf "$TEMP_DIR"
    exit 1
  fi
done

echo ""
echo "Calculating SHA256 checksums..."
cd "$TEMP_DIR"
shasum -a 256 $TOOL-* > checksums.txt
cat checksums.txt
echo ""

# Extract checksums
DARWIN_ARM64=$(grep "$TOOL-darwin-arm64" checksums.txt | awk '{print $1}')
DARWIN_X86_64=$(grep "$TOOL-darwin-x86_64" checksums.txt | awk '{print $1}')
LINUX_ARM64=$(grep "$TOOL-linux-arm64" checksums.txt | awk '{print $1}')
LINUX_X86_64=$(grep "$TOOL-linux-x86_64" checksums.txt | awk '{print $1}')

cd - > /dev/null
rm -rf "$TEMP_DIR"

# Update homebrew formula
echo "Updating homebrew/Formula/$TOOL.rb..."

# Update version
sed -i.bak "s/version \".*\"/version \"$VERSION\"/" "homebrew/Formula/$TOOL.rb"

# Update URLs
sed -i.bak2 "s/$TOOL-v[0-9.]*/$TOOL-v$VERSION/g" "homebrew/Formula/$TOOL.rb"

# Update checksums - target the sha256 lines within each platform block
# We use awk to replace sha256 values while preserving structure
awk -v arm64="$DARWIN_ARM64" -v x64="$DARWIN_X86_64" -v larm64="$LINUX_ARM64" -v lx64="$LINUX_X86_64" '
BEGIN { in_macos=0; in_linux=0; }
/on_macos do/ { in_macos=1; in_linux=0; }
/on_linux do/ { in_linux=1; in_macos=0; }
/end$/ { if (in_macos || in_linux) { in_macos=0; in_linux=0; } }
/sha256/ {
  if (in_macos) {
    if (/arm64/) {
      print "      sha256 \"" arm64 "\""
      next
    } else if (/x86_64/ || /intel/) {
      print "      sha256 \"" x64 "\""
      next
    }
  } else if (in_linux) {
    if (/arm64/) {
      print "      sha256 \"" larm64 "\""
      next
    } else if (/x86_64/ || /intel/) {
      print "      sha256 \"" lx64 "\""
      next
    }
  }
}
{ print }
' "homebrew/Formula/$TOOL.rb" > "homebrew/Formula/$TOOL.rb.tmp"

mv "homebrew/Formula/$TOOL.rb.tmp" "homebrew/Formula/$TOOL.rb"
rm homebrew/Formula/$TOOL.rb.bak*

# Update documentation
echo "Updating CLI_SETUP.md..."
sed -i.bak "s/$TOOL-v[0-9.]*/$TOOL-v$VERSION/g" CLI_SETUP.md
rm CLI_SETUP.md.bak

echo "Updating MISE_SETUP.md..."
sed -i.bak "s/$TOOL-v[0-9.]*/$TOOL-v$VERSION/g" MISE_SETUP.md
rm MISE_SETUP.md.bak

# Update plugin.json
echo "Updating plugins/tools/.claude-plugin/plugin.json..."
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" plugins/tools/.claude-plugin/plugin.json
rm plugins/tools/.claude-plugin/plugin.json.bak

echo ""
echo "✅ Release finalization complete"
echo ""
echo "Next steps:"
echo "  1. Review changes:"
echo "       git diff"
echo "  2. Commit and push finalization:"
echo "       git add -A && git commit -m 'chore($TOOL): finalize v$VERSION release'"
echo "       git push origin main"
echo "  3. Update homebrew tap (downloads binaries again and pushes to tap repo):"
echo "       task update-tap TOOL=$TOOL VERSION=$VERSION"
echo "  4. Test installation:"
echo "       brew update && brew upgrade $TOOL && $TOOL --version"
echo ""

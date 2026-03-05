#!/usr/bin/env bash
set -euo pipefail

# Script to update homebrew tap after release
# Usage: ./update-homebrew-tap.sh <tool> <version>
#
# Example: ./update-homebrew-tap.sh wl 0.4.3

TOOL="${1:-}"
VERSION="${2:-}"

if [[ -z "$TOOL" ]] || [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <tool> <version>"
  echo "Example: $0 wl 0.4.3"
  exit 1
fi

if [[ "$TOOL" != "wl" ]] && [[ "$TOOL" != "md" ]] && [[ "$TOOL" != "recap" ]]; then
  echo "Error: tool must be 'wl', 'md', or 'recap'"
  exit 1
fi

TAP_DIR="$HOME/bin/share/homebrew-tools"

if [[ ! -d "$TAP_DIR" ]]; then
  echo "Error: Homebrew tap directory not found at $TAP_DIR"
  echo "Clone it first: cd ~/bin/share && git clone https://github.com/dohzya/homebrew-tools.git"
  exit 1
fi

echo "Updating homebrew tap for $TOOL v$VERSION..."
echo ""

# Calculate checksums from GitHub release
echo "Downloading binaries from GitHub release to calculate checksums..."
TEMP_DIR=$(mktemp -d)

PLATFORMS=("darwin-arm64" "darwin-x86_64" "linux-arm64" "linux-x86_64")

for platform in "${PLATFORMS[@]}"; do
  echo "  Downloading $TOOL-$platform..."
  curl -sL "https://github.com/dohzya/tools/releases/download/$TOOL-v$VERSION/$TOOL-$platform" \
    -o "$TEMP_DIR/$TOOL-$platform"
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

# Update formula in this repo
echo "Updating homebrew/Formula/$TOOL.rb with new checksums..."
cd -
sed -i.bak \
  -e "s/sha256 \".*\" # darwin-arm64/sha256 \"$DARWIN_ARM64\"/" \
  -e "s/sha256 \".*\" # darwin-x86_64/sha256 \"$DARWIN_X86_64\"/" \
  -e "s/sha256 \".*\" # linux-arm64/sha256 \"$LINUX_ARM64\"/" \
  -e "s/sha256 \".*\" # linux-x86_64/sha256 \"$LINUX_X86_64\"/" \
  "homebrew/Formula/$TOOL.rb"

# Alternative: update by line pattern if comments don't exist
sed -i.bak2 -E \
  "/darwin-arm64.*sha256/s/sha256 \"[^\"]*\"/sha256 \"$DARWIN_ARM64\"/" \
  "homebrew/Formula/$TOOL.rb"
sed -i.bak3 -E \
  "/darwin-x86_64.*sha256/s/sha256 \"[^\"]*\"/sha256 \"$DARWIN_X86_64\"/" \
  "homebrew/Formula/$TOOL.rb"
sed -i.bak4 -E \
  "/linux-arm64.*sha256/s/sha256 \"[^\"]*\"/sha256 \"$LINUX_ARM64\"/" \
  "homebrew/Formula/$TOOL.rb"
sed -i.bak5 -E \
  "/linux-x86_64.*sha256/s/sha256 \"[^\"]*\"/sha256 \"$LINUX_X86_64\"/" \
  "homebrew/Formula/$TOOL.rb"

rm homebrew/Formula/$TOOL.rb.bak*

# Copy to tap and push
echo "Copying formula to homebrew tap..."
cp "homebrew/Formula/$TOOL.rb" "$TAP_DIR/Formula/$TOOL.rb"

cd "$TAP_DIR"
git add "Formula/$TOOL.rb"
git commit -m "chore($TOOL): bump to v$VERSION

- Update version to $VERSION
- Update SHA256 checksums for all platforms"

echo ""
echo "Pushing to homebrew tap..."
git push origin main

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Homebrew tap updated successfully!"
echo ""
echo "Users can now install with:"
echo "  brew update"
echo "  brew upgrade $TOOL"
echo ""

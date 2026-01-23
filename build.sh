#!/usr/bin/env bash
set -euo pipefail

# Build script for tools CLI
# Compiles md and wl for multiple platforms

VERSION="${1:-0.3.0}"
DIST_DIR="dist"

echo "Building tools CLIs version ${VERSION}..."

# Clean dist directory
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# Tools to build
declare -A TOOLS=(
  ["md"]="jsr:@dohzya/tools@${VERSION}/markdown-surgeon/cli"
  ["wl"]="jsr:@dohzya/tools@${VERSION}/worklog/cli"
)

# Target platforms
declare -A TARGETS=(
  ["darwin-arm64"]="aarch64-apple-darwin"
  ["darwin-x86_64"]="x86_64-apple-darwin"
  ["linux-arm64"]="aarch64-unknown-linux-gnu"
  ["linux-x86_64"]="x86_64-unknown-linux-gnu"
  ["windows-x86_64"]="x86_64-pc-windows-msvc"
)

# Compile each tool for each platform
for tool in "${!TOOLS[@]}"; do
  entry="${TOOLS[$tool]}"
  echo ""
  echo "Building ${tool}..."

  for platform in "${!TARGETS[@]}"; do
    target="${TARGETS[$platform]}"
    output="${DIST_DIR}/${tool}-${platform}"

    # Add .exe extension for Windows
    if [[ "${platform}" == windows-* ]]; then
      output="${output}.exe"
    fi

    echo "  → ${platform} (${target})"

    # md only needs read/write, wl also needs run for git commands
    if [[ "${tool}" == "wl" ]]; then
      deno compile \
        --allow-read \
        --allow-write \
        --allow-run=git \
        --target "${target}" \
        --output "${output}" \
        "${entry}"
    else
      deno compile \
        --allow-read \
        --allow-write \
        --target "${target}" \
        --output "${output}" \
        "${entry}"
    fi
  done
done

echo ""
echo "✅ Build complete! Binaries in ${DIST_DIR}/"
ls -lh "${DIST_DIR}"

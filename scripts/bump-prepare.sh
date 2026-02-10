#!/usr/bin/env bash
set -euo pipefail

# Script to prepare version bump (BEFORE JSR publish and release)
# Usage: ./bump-prepare.sh <tool> <tool-version> <jsr-version>
#
# Example: ./bump-prepare.sh md 0.5.2 0.6.2
#
# This script updates ONLY files needed BEFORE the release:
# - deno.json (JSR package version)
# - cli.ts (tool version constant)
# - skill imports (must match JSR version for post-release)
#
# Files updated AFTER release by bump-finalize.sh:
# - homebrew formulas (checksums calculated from GH release binaries)
# - documentation (*_SETUP.md)
# - plugin.json

TOOL="${1:-}"
TOOL_VERSION="${2:-}"
JSR_VERSION="${3:-}"

if [[ -z "$TOOL" ]] || [[ -z "$TOOL_VERSION" ]] || [[ -z "$JSR_VERSION" ]]; then
  echo "Usage: $0 <tool> <tool-version> <jsr-version>"
  echo ""
  echo "Example: $0 md 0.5.2 0.6.2"
  echo ""
  echo "Arguments:"
  echo "  tool         - 'wl' or 'md'"
  echo "  tool-version - Version for the specific tool (what --version shows)"
  echo "  jsr-version  - Version for JSR package @dohzya/tools (must increment every release)"
  exit 1
fi

if [[ "$TOOL" != "wl" ]] && [[ "$TOOL" != "md" ]]; then
  echo "Error: tool must be 'wl' or 'md'"
  exit 1
fi

# Validate version format (basic check)
if ! [[ "$TOOL_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: tool-version must be in format X.Y.Z (e.g., 0.4.3)"
  exit 1
fi

if ! [[ "$JSR_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: jsr-version must be in format X.Y.Z (e.g., 0.4.3)"
  exit 1
fi

echo "=== Preparing $TOOL v$TOOL_VERSION (JSR @dohzya/tools@$JSR_VERSION) ==="
echo ""

# Get current versions
CURRENT_JSR=$(grep '"version":' packages/tools/deno.json | sed 's/.*"version": "\(.*\)".*/\1/')
if [[ "$TOOL" == "wl" ]]; then
  CURRENT_TOOL=$(grep 'const VERSION' packages/tools/worklog/cli.ts | sed 's/.*"\(.*\)".*/\1/')
else
  CURRENT_TOOL=$(grep 'const VERSION' packages/tools/markdown-surgeon/cli.ts | sed 's/.*"\(.*\)".*/\1/')
fi

echo "Current versions:"
echo "  JSR package: $CURRENT_JSR"
echo "  $TOOL tool: $CURRENT_TOOL"
echo ""
echo "New versions:"
echo "  JSR package: $JSR_VERSION"
echo "  $TOOL tool: $TOOL_VERSION"
echo ""

# Files to update in this phase
echo "Files to update (pre-release phase):"
echo "  ✓ packages/tools/deno.json (JSR version)"
if [[ "$TOOL" == "wl" ]]; then
  echo "  ✓ packages/tools/worklog/cli.ts (VERSION constant)"
  echo "  ✓ plugins/tools/skills/worklog/wl (JSR import)"
else
  echo "  ✓ packages/tools/markdown-surgeon/cli.ts (VERSION constant)"
  echo "  ✓ plugins/tools/skills/markdown-surgeon/md (JSR import)"
fi
echo ""
echo "Files NOT updated yet (will be updated by bump-finalize.sh AFTER release):"
echo "  ⏸  homebrew/Formula/$TOOL.rb (checksums)"
echo "  ⏸  CLI_SETUP.md"
echo "  ⏸  MISE_SETUP.md"
echo "  ⏸  plugins/tools/.claude-plugin/plugin.json"
echo ""

read -p "Continue with version bump preparation? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Update deno.json (JSR package version)
echo ""
echo "Updating packages/tools/deno.json to $JSR_VERSION..."
sed -i.bak "s/\"version\": \".*\"/\"version\": \"$JSR_VERSION\"/" packages/tools/deno.json
rm packages/tools/deno.json.bak

if [[ "$TOOL" == "wl" ]]; then
  # Update VERSION constant in cli.ts
  echo "Updating packages/tools/worklog/cli.ts VERSION to $TOOL_VERSION..."
  sed -i.bak "s/const VERSION = \".*\";/const VERSION = \"$TOOL_VERSION\";/" packages/tools/worklog/cli.ts
  rm packages/tools/worklog/cli.ts.bak

  # Update wl skill import (uses JSR version, not tool version)
  echo "Updating plugins/tools/skills/worklog/wl import to JSR $JSR_VERSION..."
  sed -i.bak "s/@dohzya\/tools@[0-9.]*\/worklog/@dohzya\/tools@$JSR_VERSION\/worklog/" plugins/tools/skills/worklog/wl
  rm plugins/tools/skills/worklog/wl.bak
else
  # Update VERSION constant in cli.ts
  echo "Updating packages/tools/markdown-surgeon/cli.ts VERSION to $TOOL_VERSION..."
  sed -i.bak "s/const VERSION = \".*\";/const VERSION = \"$TOOL_VERSION\";/" packages/tools/markdown-surgeon/cli.ts
  rm packages/tools/markdown-surgeon/cli.ts.bak

  # Update md skill import (uses JSR version, not tool version)
  echo "Updating plugins/tools/skills/markdown-surgeon/md import to JSR $JSR_VERSION..."
  sed -i.bak "s/@dohzya\/tools@[0-9.]*\/markdown-surgeon/@dohzya\/tools@$JSR_VERSION\/markdown-surgeon/" plugins/tools/skills/markdown-surgeon/md
  rm plugins/tools/skills/markdown-surgeon/md.bak
fi

echo ""
echo "✅ Pre-release version bump complete"
echo ""
echo "Next steps (from RELEASE.md):"
echo "  1. Validate changes:"
echo "       task validate"
echo "  2. Review changes:"
echo "       git diff"
echo "  3. Commit (don't push yet!):"
echo "       git add -A && git commit -m 'chore($TOOL): bump to v$TOOL_VERSION'"
echo "  4. Publish to JSR (CRITICAL - must happen with correct committed code):"
echo "       cd packages/tools && deno publish && cd ../.."
echo "  5. Push commit (NOT tags yet!):"
echo "       git push origin main"
echo "  6. Wait for CI to pass (MANDATORY GATE):"
echo "       gh run watch"
echo "  7. ONLY after CI is green, create and push tag:"
echo "       git tag $TOOL-v$TOOL_VERSION && git push origin $TOOL-v$TOOL_VERSION"
echo "  8. Wait for release workflow to build binaries:"
echo "       gh run watch"
echo "  9. Finalize release (updates homebrew checksums, docs, plugin):"
echo "       task bump-finalize TOOL=$TOOL VERSION=$TOOL_VERSION"
echo ""

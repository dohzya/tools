#!/bin/bash
set -e

echo "🚀 Setting up dz-skills development environment..."

# Install mise if not already installed
if ! command -v mise &> /dev/null; then
    echo "📦 Installing mise..."
    curl https://mise.run | sh
    export PATH="$HOME/.local/bin:$PATH"
    echo "✅ mise installed"
else
    echo "✅ mise already installed"
fi

# Trust the repo's mise.toml first
echo "🔒 Trusting mise.toml..."
mise trust

# Install tools from mise.toml
echo "📦 Installing tools (Deno)..."
mise install

echo ""
echo "✨ Setup complete! You can now:"
echo "   - Run tests: deno test --allow-read --allow-write"
echo "   - Type check: deno check packages/tools/mod.ts"
echo "   - Format code: deno fmt"
echo "   - Lint code: deno lint"

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# In standard CI or non-virtiofs environments where node_modules is already populated, exit fast.
if ! df -T "$REPO_ROOT" 2>/dev/null | grep -q "virtiofs"; then
  exit 0
fi

mkdir -p "$REPO_ROOT/node_modules"

if mountpoint -q "$REPO_ROOT/node_modules"; then
  exit 0
fi

# Guard against accidental unmounted files inside ./node_modules on virtiofs
if [ -n "$(ls -A "$REPO_ROOT/node_modules" 2>/dev/null)" ]; then
  echo "ERROR: Unmounted files detected in $REPO_ROOT/node_modules on virtiofs." >&2
  echo "Run: rm -rf $REPO_ROOT/node_modules/* && echo 3 | sudo tee /proc/sys/vm/drop_caches" >&2
  exit 1
fi

PROJECT_HASH="$(pwd -P | sha1sum | cut -c1-8)"
PROJECT_CACHE_DIR="$HOME/.cache/projects/$(basename "$PWD")-${PROJECT_HASH}"
CACHE_DEPS="$PROJECT_CACHE_DIR/deps"

mkdir -p "$CACHE_DEPS"

if [ ! -d "$CACHE_DEPS/node_modules/zod" ] || [ ! -d "$CACHE_DEPS/node_modules/typescript" ]; then
  cat > "$CACHE_DEPS/package.json" << 'EOF'
{
  "name": "gridlock-ext4-deps",
  "private": true,
  "dependencies": {
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "~5.7.2"
  }
}
EOF
  (
    cd "$CACHE_DEPS"
    npm install --prefer-offline --no-audit --no-fund --cache "$PROJECT_CACHE_DIR/npm"
  )
fi

mkdir -p "$CACHE_DEPS/node_modules/@samasastudio"
ln -sfn "$REPO_ROOT/packages/core" "$CACHE_DEPS/node_modules/@samasastudio/gridlock-core"
ln -sfn "$REPO_ROOT/packages/widgets" "$CACHE_DEPS/node_modules/@samasastudio/gridlock-widgets"

sudo mount --bind "$CACHE_DEPS/node_modules" "$REPO_ROOT/node_modules"

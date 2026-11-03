#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# In standard CI or non-virtiofs environments where node_modules is already populated, exit fast.
if ! df -T "$REPO_ROOT" 2>/dev/null | grep -q "virtiofs"; then
  exit 0
fi

mkdir -p "$REPO_ROOT/node_modules"

IS_MOUNTED=0
if mountpoint -q "$REPO_ROOT/node_modules"; then
  IS_MOUNTED=1
  if [ -d "$REPO_ROOT/node_modules/zod" ] && [ -d "$REPO_ROOT/node_modules/typescript" ] && [ -d "$REPO_ROOT/node_modules/motion-plus" ]; then
    exit 0
  fi
elif [ -n "$(ls -A "$REPO_ROOT/node_modules" 2>/dev/null)" ]; then
  # Guard against accidental unmounted files inside ./node_modules on virtiofs
  echo "ERROR: Unmounted files detected in $REPO_ROOT/node_modules on virtiofs." >&2
  echo "Run: rm -rf $REPO_ROOT/node_modules/* && echo 3 | sudo tee /proc/sys/vm/drop_caches" >&2
  exit 1
fi

PROJECT_HASH="$(pwd -P | sha1sum | cut -c1-8)"
PROJECT_CACHE_DIR="$HOME/.cache/projects/$(basename "$PWD")-${PROJECT_HASH}"
CACHE_DEPS="$PROJECT_CACHE_DIR/deps"

mkdir -p "$CACHE_DEPS"

if [ ! -d "$CACHE_DEPS/node_modules/zod" ] || [ ! -d "$CACHE_DEPS/node_modules/typescript" ] || [ ! -d "$CACHE_DEPS/node_modules/motion-plus" ]; then
  {
    echo "@motionplus:registry=https://api.motion.dev/npm/"
    if [ -n "${MOTION_PLUS_TOKEN:-}" ]; then
      printf "//api.motion.dev/npm/:_authToken=%s\n" "$MOTION_PLUS_TOKEN"
    elif [ -f "$REPO_ROOT/../profile-site/.npmrc" ]; then
      grep "api.motion.dev" "$REPO_ROOT/../profile-site/.npmrc" || true
    fi
  } > "$CACHE_DEPS/.npmrc"
  chmod 600 "$CACHE_DEPS/.npmrc"

  cat > "$CACHE_DEPS/package.json" << 'EOF'
{
  "name": "gridlock-ext4-deps",
  "private": true,
  "dependencies": {
    "motion": "^12.6.2",
    "motion-plus": "npm:@motionplus/core@^2.12.0",
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

if [ "$IS_MOUNTED" -eq 0 ]; then
  sudo mount --bind "$CACHE_DEPS/node_modules" "$REPO_ROOT/node_modules"
fi

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

extract_env_token() {
  local file="$1"
  [ -f "$file" ] || return 0
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?(MOTION_PLUS_TOKEN|MOTION_TOKEN)=[[:space:]]*["\x27]?([^"\x27#[:space:]]+)["\x27]?[[:space:]]*$/\3/p' "$file" | head -n 1
}

# In standard CI or non-virtiofs environments, exit fast when dependencies and @esbuild binary are populated,
# or bootstrap cold cloud VMs in a subshell without modifying $HOME/.npmrc.
if ! df -T "$REPO_ROOT" 2>/dev/null | grep -q "virtiofs"; then
  if [ -d "$REPO_ROOT/node_modules/typescript" ] && [ -d "$REPO_ROOT/node_modules/@esbuild" ]; then
    exit 0
  fi

  (
    TMP_NPMRC=""
    cleanup_tmp_npmrc() {
      if [ -n "$TMP_NPMRC" ] && [ -f "$TMP_NPMRC" ]; then
        rm -f "$TMP_NPMRC"
      fi
    }
    trap cleanup_tmp_npmrc EXIT

    if [ -z "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f /usr/local/share/ca-certificates/agent-gateway-ca.crt ] && [ -f /etc/ssl/certs/ca-certificates.crt ]; then
      CA_BUNDLE="$HOME/.config/atlas-dossier/ca-bundle.crt"
      mkdir -p "$HOME/.config/atlas-dossier"
      cat /etc/ssl/certs/ca-certificates.crt /usr/local/share/ca-certificates/agent-gateway-ca.crt > "$CA_BUNDLE"
      chmod 600 "$CA_BUNDLE"
      export NODE_EXTRA_CA_CERTS="$CA_BUNDLE"
      export npm_config_cafile="$CA_BUNDLE"
    fi

    if [ ! -d "$REPO_ROOT/node_modules/motion-plus" ]; then
      RAW_TOKEN="${MOTION_PLUS_TOKEN:-${MOTION_TOKEN:-}}"
      if [ -z "$RAW_TOKEN" ]; then
        RAW_TOKEN="$(extract_env_token "$REPO_ROOT/.env.local")"
      fi
      if [ -z "$RAW_TOKEN" ]; then
        RAW_TOKEN="$(extract_env_token "$HOME/.config/atlas-dossier/credentials.env")"
      fi
      CLEAN_TOKEN="$(printf '%s' "$RAW_TOKEN" | tr -d '\r\n' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^["\x27]//; s/["\x27]$//')"
      if printf '%s' "$CLEAN_TOKEN" | grep -qE '^https?://.*[?&]token='; then
        CLEAN_TOKEN="$(printf '%s' "$CLEAN_TOKEN" | sed -E 's/^.*[?&]token=([^&]+).*$/\1/')"
      fi

      TMP_NPMRC="$(mktemp "${TMPDIR:-/tmp}/gridlock-npmrc.XXXXXX")"
      chmod 600 "$TMP_NPMRC"
      {
        if [ -r "$HOME/.npmrc" ]; then
          grep -v "api.motion.dev" "$HOME/.npmrc" | grep -v '\${' || true
        fi
        echo "@motionplus:registry=https://api.motion.dev/npm/"
        if [ -n "$CLEAN_TOKEN" ]; then
          printf "//api.motion.dev/npm/:_authToken=%s\n" "$CLEAN_TOKEN"
        elif [ -r "$HOME/.npmrc" ]; then
          grep "api.motion.dev" "$HOME/.npmrc" | grep -v '\${' || true
        fi
      } > "$TMP_NPMRC"
      export npm_config_userconfig="$TMP_NPMRC"
    fi

    if [ ! -d "$REPO_ROOT/node_modules/typescript" ]; then
      npm install --prefer-offline --no-package-lock --no-audit --no-fund
    fi

    if [ ! -d "$REPO_ROOT/node_modules/@esbuild" ] && [ -f "$REPO_ROOT/node_modules/esbuild/install.js" ]; then
      node "$REPO_ROOT/node_modules/esbuild/install.js"
    fi
  )
  exit 0
fi

PROJECT_HASH="$(pwd -P | sha1sum | cut -c1-8)"
PROJECT_CACHE_DIR="$HOME/.cache/projects/$(basename "$PWD")-${PROJECT_HASH}"
CACHE_DEPS="$PROJECT_CACHE_DIR/deps"
PKG_SHA="$(sha256sum "$REPO_ROOT/package.json" | cut -d' ' -f1)"
STAMP_FILE="$CACHE_DEPS/.package-json.sha256"

mkdir -p "$REPO_ROOT/node_modules"

IS_MOUNTED=0
if mountpoint -q "$REPO_ROOT/node_modules"; then
  IS_MOUNTED=1
  if [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$PKG_SHA" ] && [ -d "$REPO_ROOT/node_modules/motion-plus" ]; then
    exit 0
  fi
elif [ -n "$(ls -A "$REPO_ROOT/node_modules" 2>/dev/null)" ]; then
  # Guard against accidental unmounted files inside ./node_modules on virtiofs
  echo "ERROR: Unmounted files detected in $REPO_ROOT/node_modules on virtiofs." >&2
  echo "Run: rm -rf $REPO_ROOT/node_modules/* && echo 3 | sudo tee /proc/sys/vm/drop_caches" >&2
  exit 1
fi

mkdir -p "$CACHE_DEPS"

if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$PKG_SHA" ] || [ ! -d "$CACHE_DEPS/node_modules/motion-plus" ]; then
  RAW_TOKEN="${MOTION_PLUS_TOKEN:-${MOTION_TOKEN:-}}"
  if [ -z "$RAW_TOKEN" ]; then
    RAW_TOKEN="$(extract_env_token "$REPO_ROOT/.env.local")"
  fi
  if [ -z "$RAW_TOKEN" ]; then
    RAW_TOKEN="$(extract_env_token "$HOME/.config/atlas-dossier/credentials.env")"
  fi
  CLEAN_TOKEN="$(printf '%s' "$RAW_TOKEN" | tr -d '\r\n' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^["\x27]//; s/["\x27]$//')"
  if printf '%s' "$CLEAN_TOKEN" | grep -qE '^https?://.*[?&]token='; then
    CLEAN_TOKEN="$(printf '%s' "$CLEAN_TOKEN" | sed -E 's/^.*[?&]token=([^&]+).*$/\1/')"
  fi

  {
    echo "@motionplus:registry=https://api.motion.dev/npm/"
    if [ -n "$CLEAN_TOKEN" ]; then
      printf "//api.motion.dev/npm/:_authToken=%s\n" "$CLEAN_TOKEN"
    elif [ -f "$HOME/.npmrc" ]; then
      grep "api.motion.dev" "$HOME/.npmrc" | grep -v '\${' || true
    fi
  } > "$CACHE_DEPS/.npmrc"
  chmod 600 "$CACHE_DEPS/.npmrc"

  node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    fs.writeFileSync(
      process.argv[1],
      JSON.stringify({ name: "gridlock-ext4-deps", private: true, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2) + "\n"
    );
  ' "$CACHE_DEPS/package.json"
  (
    cd "$CACHE_DEPS"
    npm install --prefer-offline --no-audit --no-fund --cache "$PROJECT_CACHE_DIR/npm"
  )
  printf '%s\n' "$PKG_SHA" > "$STAMP_FILE"
fi

mkdir -p "$CACHE_DEPS/node_modules/@samasastudio"
ln -sfn "$REPO_ROOT/packages/core" "$CACHE_DEPS/node_modules/@samasastudio/gridlock-core"
ln -sfn "$REPO_ROOT/packages/widgets" "$CACHE_DEPS/node_modules/@samasastudio/gridlock-widgets"

if [ "$IS_MOUNTED" -eq 0 ]; then
  sudo mount --bind "$CACHE_DEPS/node_modules" "$REPO_ROOT/node_modules"
fi

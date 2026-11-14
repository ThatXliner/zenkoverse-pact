#!/bin/sh
# Keeps this checkout on origin/main: rebuilds dist/ when main moves.
# The serving process reads dist/ per request, so it restarts only when
# server/ or the files it imports from src/net (the shared numbers and the
# clash referee) change.
set -eu
cd "$(dirname "$0")/.."
while true; do
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    server_changed=$(git diff --quiet HEAD origin/main -- server src/net/rules.json src/net/clash.js && echo no || echo yes)
    git reset -q --hard origin/main
    npm ci --no-audit --no-fund
    npm run build -- --outDir dist.next --emptyOutDir
    rm -rf dist.prev && { [ -d dist ] && mv dist dist.prev || true; } && mv dist.next dist
    echo "deployed $(git rev-parse --short HEAD)"
    [ "$server_changed" = yes ] && vanityctl restart zenkoverse
  fi
  sleep 60
done

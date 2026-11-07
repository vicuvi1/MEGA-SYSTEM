#!/usr/bin/env bash
# Session start: install, then prove the baseline is green before any feature work.
#   bash scripts/init.sh            install + typecheck + tests
#   SMOKE=1 bash scripts/init.sh    also the UI smoke test (slower)
#   RUN_START_COMMAND=1 ...         start the website dev server at the end
set -euo pipefail

INSTALL_CMD="npm ci --ignore-scripts"
VERIFY_CMD="npx tsc --noEmit -p tsconfig.json && npx vitest run"
SMOKE_CMD="npm run smoke"
START_CMD="npm run web"

cd "$(dirname "$0")/.."
echo "== Life System: $(pwd)"
echo "== branch $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"

if [ ! -d node_modules ]; then
  echo "== install: $INSTALL_CMD"
  eval "$INSTALL_CMD"
fi

echo "== verify: $VERIFY_CMD"
if ! eval "$VERIFY_CMD"; then
  echo "!! The baseline is red. Fix this before any feature work (see docs/harness/progress.md)."
  exit 1
fi

if [ "${SMOKE:-0}" = "1" ]; then
  echo "== smoke: $SMOKE_CMD"
  eval "$SMOKE_CMD"
fi

echo "== baseline green. Start the website with: $START_CMD"
if [ "${RUN_START_COMMAND:-0}" = "1" ]; then exec $START_CMD; fi

#!/bin/bash
# Local helper: typecheck, tests, bot bundle, commit (message from a file), push.
# Usage: scripts/ship.sh <message-file>
set -e
cd "$(dirname "$0")/.."
npx tsc --noEmit -p tsconfig.json
if ! timeout 400 npx vitest run > /tmp/vt.log 2>&1; then
  grep -E "FAIL|Error" /tmp/vt.log | head -30
  exit 1
fi
grep -E "Tests " /tmp/vt.log
npm run build:bot > /dev/null 2>&1
git add -A
git commit -q -F "$1"
for i in 1 2 3 4; do
  if git pull -q --rebase origin main && git push -q origin main 2> /dev/null; then break; fi
  sleep $((2 ** i))
done
git log --oneline -1

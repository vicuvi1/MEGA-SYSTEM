#!/usr/bin/env bash
# One-line answers about the Windows release pipeline, so nobody needs an agent to check.
#   bash scripts/release-status.sh        latest release + last 3 runs
#   bash scripts/release-status.sh fail   the ✗ lines of the newest failed run
set -euo pipefail
REPO="${REPO:-vicuvi1/MEGA-SYSTEM}"
if [ "${1:-}" = "fail" ]; then
  id=$(gh api "repos/$REPO/actions/workflows/release.yml/runs?per_page=10" --jq '[.workflow_runs[] | select(.conclusion=="failure")][0].id')
  [ -z "$id" ] && { echo "no failed run in the last 10"; exit 0; }
  job=$(gh api "repos/$REPO/actions/runs/$id/jobs" --jq '.jobs[0].id')
  gh api "repos/$REPO/actions/jobs/$job/logs" | grep -E "✗|… .*trying once more|##\[error\]" | cut -c30-400 | head -12
  exit 0
fi
echo "latest release: $(gh api "repos/$REPO/releases/latest" --jq '.tag_name + " (" + .published_at + ")"')"
gh api "repos/$REPO/actions/workflows/release.yml/runs?per_page=3" --jq '.workflow_runs[] | "run \(.run_number) \(.head_sha[0:7]) \(.status) \(.conclusion // "-")"'

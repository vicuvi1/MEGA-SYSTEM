# Session handoff

Write this when a session stops before its work is finished, so the next one can start in
minutes. Overwrite it each time. Older notes belong in `progress.md`.

## Currently verified
- `main` passes typecheck, unit tests and smoke. The last green release is v1.4.1366.

## Changes this session
- Added the harness files: `CLAUDE.md`, `scripts/init.sh`, `docs/harness/*` and `docs/DECISIONS.md`.

## Still broken or unverified
- The "Sport Track Today" smoke step is flaky on the Windows runner. It passes on retry; the root
  cause hasn't been found yet.
- The five "Life boost" builders are still finishing. Check `git log origin/main` for their commits.

## Next best action
- Merge or verify each Life boost commit, run `SMOKE=1 bash scripts/init.sh`, and update
  `feature_list.json`.
- **Don't touch:** `src/core/schema.ts` beyond appending, the security rules in `api/_sqlguard.mjs`,
  or the honest-points rules.

## Commands
- **Startup:** `bash scripts/init.sh`, then `npm run web`.
- **Verification:** `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run smoke`.
- **One smoke step:** `SMOKE_ONLY="Sport Track" npm run smoke`. Locally you may need
  `CHROMIUM_PATH=/usr/bin/google-chrome`.
- **Debug a failed step:** `SMOKE_FULL=1 SMOKE_ONLY="<step words>" npm run smoke`.

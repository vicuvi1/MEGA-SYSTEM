---
name: ship
description: Finish a Life System change. Verify (typecheck, tests, scoped smoke, bundles), commit in plain English, rebase on origin/main, push, then write the short report. Use at the end of any build task instead of re-explaining these steps.
---
# Ship a Life System change

Run these steps in order. Stop and report if a step fails and you can't fix it in scope.

1. **Verify**
   - `npx tsc --noEmit -p tsconfig.json`
   - `npx vitest run`. Tests that depend on the hour pin the clock (`vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime`).
   - If `src/server/**`, `src/renderer/src/web/**` or other bot code changed: `npm run build:bot`, and stage `api/_bot/bot.mjs`.
   - If `src/core/sport*.ts` changed: `npm run build:sport`, and stage `src/renderer/public/apps/sport/sportkit.js`.
   - UI change: `SMOKE_ONLY="<your step words>" npm run smoke`. Add or update a smoke step. Use robust waits for slow Windows runners, and `pathToFileURL` for dynamic imports. Locally you may need `CHROMIUM_PATH=/usr/bin/google-chrome`. Leave the full smoke run to the coordinator or CI unless asked.
2. **Docs:** update the matching `docs/areas/<area>.md` and the feature's entry in `docs/harness/feature_list.json`. Don't append to `docs/AI_HANDOFF.md`.
3. **Commit**
   - Plain English about what changed for the user.
   - Stage files by name; never stage `node_modules`.
   - End the message with the attribution trailer the session asks for.
   - Don't put model IDs in commit messages.
4. **Rebase:** `git fetch origin main && git rebase origin/main`. On a conflict:
   - Keep both sides.
   - For `api/_bot/bot.mjs`, rebuild it from the merged source instead of hand-merging.
   - Re-run the typecheck and tests.
5. **Push:** `git push origin HEAD:main`. Retry network errors up to 4 times with backoff. Never force-push.
6. **Report (at most about 250 words):**
   - what changed for the user;
   - the files touched;
   - checks run, with results;
   - the commit hash;
   - risks or what you couldn't do;
   - screenshot paths, if any.

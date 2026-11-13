# AGENTS.md: working on Life System

This file is the single authority for the working rules. Every AI tool reads it, including Claude
Code (through `CLAUDE.md`), Codex and the others.

## Read first (progressive, don't read everything)
1. [`docs/INDEX.md`](docs/INDEX.md): what the project is, the invariants, the commands and the area map.
2. **One** area file in `docs/areas/` for your task. Read more only if the task really crosses areas.
3. [`docs/harness/progress.md`](docs/harness/progress.md): where things stand.
4. If you are about to change one of the choices listed in [`docs/DECISIONS.md`](docs/DECISIONS.md), read it first.

The full [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) (about 23k tokens) is the historical reference. Don't read it by default.

## Rules
- **Feature freeze (owner, from 2026-11-11 for 2 weeks):** no new features. Only simplify, fix, hide unused modules, and build what the Sunday reviews show is needed. The app is organised around 3 daily numbers: sleep (asleep by 23:30, up by 06:45), focus blocks started, and exactly 3 must-dos.
- **Desktop only for now (owner's choice, Nov 2026):** build every new feature for the Windows desktop app (Electron renderer, island, desktop main process). Do no web-only, phone-layout or bot work unless the owner asks for it. Keep the web build and the existing smoke steps working, but don't spend effort polishing them.
- **Public repo:** no secrets, ids, emails or the owner's real data anywhere. Use made-up data.
- **Security rules that must hold:**
  - `/api/db` refuses the `sys_*` tables and ATTACH/PRAGMA, and pages may only read `cloud_snapshots` and `cloud_snapshot_parts` (`api/_sqlguard.mjs`).
  - The PIN lives only on the server (`sys_auth`) and changes through `/api/login {changePin}`.
  - The bots obey only the owner's chat ids.
  - A database hiccup is a 503, never a sign-out.
- **Honest points:** points are paid only for something actually done, logged at the time (see `src/main/sleep.ts` and `src/main/discipline.ts`).
- **Database:** `src/core/schema.ts` is append-only. Each migration bumps `SCHEMA_VERSION` in `api/_schema.mjs`.
- **Functions:** add no new files in `api/` (the Hobby plan allows 12 functions).
- **Writing:** commit messages and UI text are plain, simple English about what changed for the user.
- **Git:** `git fetch origin main && git rebase origin/main` before pushing. Never force-push. Never commit `node_modules`. Don't redo or undo recent work without reading `git log`.
- **Read narrowly:** use Grep and line ranges on big files (`DesktopIsland.tsx`, `webBots.ts`, `sport/index.html`, `finance/js/app.js`, `e2e/smoke.mjs`); don't read them whole.

## Definition of done
- `npx tsc --noEmit -p tsconfig.json` is clean, and `npx vitest run` passes. Tests that depend on the hour pin the clock.
- `npm run smoke` passes. A UI change has a smoke step. Builders may run only their area with `SMOKE_ONLY`; the coordinator or CI runs the full suite.
- If bot or server code changed: `npm run build:bot`, and commit `api/_bot/bot.mjs`. If `src/core/sport*.ts` changed: `npm run build:sport`, and commit `sportkit.js`.
- New or changed behaviour is written in the matching `docs/areas/*.md` file.
- The Windows release run is green (`bash scripts/release-status.sh`). A red release blocks all other shipping until it is fixed. Tests must not assume the operating system: the release builds on Windows, CI on Linux (both run the unit tests).
- The feature's entry in `docs/harness/feature_list.json` is updated.

## Reports and handoffs
- A builder ends with a report of **at most about 250 words**: what changed (user-visible), files, tests run and their results, the commit hash, risks, and screenshot paths.
- The coordinator keeps `docs/harness/progress.md` to 5–8 lines per milestone, and starts a fresh session at milestones (see `docs/harness/session-handoff.md`).

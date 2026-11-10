# Life System: documentation index

Start here. Read **this page plus the one area file your task needs**. Don't read the full
[`AI_HANDOFF.md`](AI_HANDOFF.md) (about 23k tokens) unless the task really spans the whole system.
It is kept as the complete historical reference.

## What it is
Life System (`vicuvi1/MEGA-SYSTEM`) is one person's life operating system. It covers:
- Today (plan, Top 3, habits)
- Calendar (Google) and Tasks (Todoist)
- Goals and Season, Insights
- Sleep (Waky), Discipline, Money (Finance Helper), Sport Track
- Rewards (an honest points wallet), Notebook, Music
- **Ben**, an AI coach in the app and on Telegram

It ships three ways from one codebase:
- the **website** (the main product; every push to `main` deploys to Vercel);
- a **Windows desktop app** (Electron plus the floating "Dynamic Island"; a release is built on every push to `main`);
- **Telegram bots**, answered by the server.

## Invariants: never break these
- **Public repo:** no secrets, ids, emails or the owner's real data in code, tests, docs or screenshots. Use made-up data. Importers parse files locally in the browser.
- **Security:**
  - `/api/db` refuses the server-only `sys_*` tables and ATTACH/PRAGMA, and pages may only *read* `cloud_snapshots` (`api/_sqlguard.mjs`).
  - The PIN lives only on the server (`sys_auth`) and changes through `/api/login {changePin}`.
  - Bots obey only the owner's chat ids.
  - A database hiccup is a 503, never a sign-out.
  - The CSP is in `vercel.json`. Details: [areas/security.md](areas/security.md).
- **Honest points:** points are paid only for something actually done, logged at the time. Imports, back-dated logs, badges, levels and taps on "auto" habits pay nothing extra (`src/main/sleep.ts`, `src/main/discipline.ts`, `src/main/shop.ts`).
- **Sync:**
  - The browser runs on a sql.js copy of Turso (`src/renderer/src/web/mirror.ts`, live refresh, offline queue).
  - Desktop writes save locally first and upload next in line.
  - Never bypass the mirror or write to Turso directly from a page. Details: [areas/architecture.md](areas/architecture.md) and [areas/data-sync.md](areas/data-sync.md).
- **Database:** `src/core/schema.ts` is append-only. A migration bumps `SCHEMA_VERSION` in `api/_schema.mjs` (a test checks this). Prefer synced settings (registered in `src/core/settingsKeys.ts`) for small data.
- **Vercel Hobby plan, at most 12 functions:** add no new files in `api/` (`functionCount.test.ts`). Add ops to existing functions or use `vercel.json` rewrites.
- **Bot bundle:** server bot code is built into `api/_bot/bot.mjs` (`npm run build:bot`). It is committed, and CI fails if it is stale.
- **Original art only:** no franchise characters, logos or hot-linked images. Public-domain sources need a NOTICE file.
- **Writing:** commit messages and UI text use plain, simple English about what changed for the user.

## Commands
```bash
bash scripts/init.sh                       # install if needed + typecheck + unit tests (SMOKE=1 adds smoke)
npx tsc --noEmit -p tsconfig.json          # types
npx vitest run                             # unit tests
npm run build:bot                          # only if bot/server code changed; commit api/_bot/bot.mjs
npm run build:sport                        # only if src/core/sport*.ts changed; commit sportkit.js
npm run smoke                              # the real app on fake data, fixed clock (Fri 08:30)
SMOKE_ONLY="<step words>" npm run smoke    # one area's steps (+ sign-in)
```
Locally, the smoke test may need `CHROMIUM_PATH=/usr/bin/google-chrome`. Tests that depend on the hour
must pin the clock: `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime(...)`.

## Areas: read only the one you need
| Area | Doc | Main code |
|---|---|---|
| Overview, repos, owner's rules | [areas/overview.md](areas/overview.md) | — |
| Architecture (stack, data, functions) | [areas/architecture.md](areas/architecture.md) | `api/`, `src/main/`, `src/renderer/src/web/` |
| Security and secret names | [areas/security.md](areas/security.md) | `api/login.mjs`, `api/_sqlguard.mjs`, `vercel.json` |
| Data and sync | [areas/data-sync.md](areas/data-sync.md) | `src/core/schema.ts`, `web/mirror.ts`, `settingsKeys.ts` |
| Ben (coach brain, chat, memory, pushes) | [areas/ben.md](areas/ben.md) | `web/webBots.ts`, `web/botBrain.ts`, `src/core/ben*.ts`, `src/server/telegramBot.ts` |
| Day planner, plan editor, calendar | [areas/planner.md](areas/planner.md) | `src/core/dayPacker.ts`, `planShift.ts`, `planEdit.ts`, `planSync.ts`, `src/renderer/src/plan/` |
| Today page | [areas/today.md](areas/today.md) | `DayFlow.tsx`, `dayflow/`, `habits/` |
| Goals and Season | [areas/goals.md](areas/goals.md) | `pages/Goals.tsx`, `pages/Season.tsx`, `src/core/goal*.ts` |
| Career (jobs, portfolio, flashcards, study, money plan) | [areas/career.md](areas/career.md) | `pages/Career.tsx`, `src/renderer/src/career/`, `src/core/career/` |
| Focus boost (push ladder, launch kits, Dojo, win music) and Study Time | [areas/focus.md](areas/focus.md) | `src/renderer/src/boost/`, `src/core/pushLadder.ts`, `src/core/studyTime.ts`, `pages/StudyTime.tsx` |
| Healthy day, sleep care, My life | [areas/health.md](areas/health.md) | `src/core/healthyDay.ts`, `sleepCare.ts`, `lifeFit.ts` |
| Desktop island | [areas/island.md](areas/island.md) | `src/desktop/island.ts`, `DesktopIsland.tsx`, `IslandFeed.tsx`, `src/core/island*.ts` |
| Voice | [areas/voice.md](areas/voice.md) | `src/renderer/src/voice/`, `src/core/voice*.ts` |
| Music | [areas/music.md](areas/music.md) | `src/renderer/src/music/`, `src/desktop/scWeb.ts` |
| The coach (Coach today card, weekly review, safety rules) | [areas/coach.md](areas/coach.md) | `src/core/coach{Config,Plan,Safety,Text,Week}.ts`, `src/renderer/src/coach/` |
| Sport Track and the Body page (protein, weight, readiness, photos) | [areas/sport.md](areas/sport.md) | `src/renderer/public/apps/sport/`, `src/core/sport*.ts`, `src/renderer/src/body/` |
| Photo Locker (photos, videos, files backed up to Google Drive) | [areas/vault.md](areas/vault.md) | `src/core/vaultSync.ts`, `src/renderer/src/vault/`, `api/google.mjs` (`driveToken`) |
| Rewards and money | [areas/rewards-money.md](areas/rewards-money.md) | `pages/Rewards.tsx`, `src/main/shop.ts`, `public/apps/finance/` |
| Plugins and PC automation | [areas/plugins-pc.md](areas/plugins-pc.md), [pc-automation.md](pc-automation.md) | `src/plugins/` |
| Operations (tick, backups, cost, CI) | [areas/ops.md](areas/ops.md) | `api/cron.mjs`, `.github/workflows/` |
| Custom Center (your widgets, actions, reminders, modes, looks) | [areas/custom.md](areas/custom.md) | `src/core/custom/`, `pages/CustomCenter.tsx`, `src/renderer/src/custom/` |
| How to work, UI and motion rules | [areas/workflow.md](areas/workflow.md) | `src/renderer/src/motion.css`, `Select.tsx`, `PageTabs.tsx` |

Other docs:
- [desktop.md](desktop.md), [web-server.md](web-server.md) and [code-signing.md](code-signing.md);
- [PLAN.md](PLAN.md) for long-term tasks;
- [DECISIONS.md](DECISIONS.md) for choices not to undo.

**Keep docs in their area:** update the matching `docs/areas/*.md` file, not `AI_HANDOFF.md`. All handoff sections up to 2026-11-07 (Career and Body included) are already in the area files.

## Working state and process
- Where things stand: [harness/progress.md](harness/progress.md). What works and how it is checked: [harness/feature_list.json](harness/feature_list.json).
- Session handoffs and the coordinator format: [harness/session-handoff.md](harness/session-handoff.md).
- Before ending a session: [harness/clean-state-checklist.md](harness/clean-state-checklist.md).
- Which model does what: [harness/model-routing.md](harness/model-routing.md). Brief template: [harness/brief-template.md](harness/brief-template.md).
- Measuring token use: [harness/measurement.md](harness/measurement.md).

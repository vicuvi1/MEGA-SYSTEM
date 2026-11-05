# AGENTS.md — working on Life System

**Read `docs/AI_HANDOFF.md` first.** It is the full, current description of the
project: who it's for, the repos, the secrets (names only), the architecture,
Ben (the AI coach), the data, and the rules. This file is the short version.

## What it is

Life System (`vicuvi1/MEGA-SYSTEM`) is one person's life operating system:
Today (plan, must-dos, habits, focus), Calendar (Google), Tasks (Todoist),
Insights, Sleep (Waky), Discipline (MAN), Money (Finance Helper), Body (Sport
Track), Rewards (a points wallet), a Notebook, and **Ben**, an AI coach who
talks in the app and on Telegram, plans the day and holds you to it.

It ships three ways from one codebase:

- **Website** (the main product): https://mega-system-ten.vercel.app, PIN login.
  Every push to `main` deploys to Vercel.
- **Windows desktop app**: an Electron shell around the same web build, plus a
  floating "Dynamic Island" command center. Built and published as a GitHub
  Release on every push to `main` (`.github/workflows/release.yml`).
- **Telegram bots** (Ben and the specialist bots), answered by the server 24/7.

## Where things live

```
api/              Vercel functions (max 12 on the Hobby plan): login (PIN, passkeys,
                  devices), db (guarded Turso proxy), coach, telegram webhook, cron
                  (tick, daily jobs, sport), ai, google, todoist, config, bot-setup/health.
api/_bot/bot.mjs  The server bundle of src/server/telegramBot.ts (npm run build:bot;
                  Vercel also rebuilds it on deploy).
src/core/         Pure TypeScript logic, no DOM/Electron: dates, ledger, rules, streaks,
                  rhythm (Ben's day), islandModel (island states), sleep, capture…
src/main/         The services (wallet, focus, sleep, discipline, body, shop, weekPlan,
                  progress…). They run on the browser's copy of the database.
src/renderer/     The React 19 app. src/renderer/src/web/ is the data layer: mirror.ts
                  (sql.js copy of Turso, live sync, offline queue), webServices.ts,
                  webBots.ts (the bots' brain, shared with the server), session.ts.
src/renderer/public/apps/  The embedded apps: finance, waky, man, sport.
src/desktop/      The Electron shell: main.ts, island.ts (the floating island window),
                  preload.ts. Built with electron.desktop.config.mts.
src/server/       telegramBot.ts: the server side of the bots, the tick, daily jobs.
e2e/              smoke.mjs (the real app on fake data) and server.mjs.
```

## How to work

- Ship: `bash scripts/ship.sh <message-file>` (typecheck, tests, bot bundle,
  commit, push). UI check: `npm run smoke`.
- Tests: `npx vitest run`. Types: `npx tsc --noEmit -p tsconfig.json`.
- Commit messages and UI text: plain, simple English about what changed for the
  user, not jargon.
- The repo is **public**: no secrets, no real personal data in code, tests,
  docs or screenshots. Use made-up data.
- Security rules that must hold: `/api/db` refuses the server-only `sys_*`
  tables and ATTACH/PRAGMA (`api/_sqlguard.mjs`); the PIN lives only on the
  server (`sys_auth`) and is changed through `/api/login {changePin}`; the bots
  obey only your own chat ids; a database hiccup is a 503, never a sign-out.
- Points must be honest: a habit pays only for something you actually did when
  you log it (see `src/main/sleep.ts` and `src/main/discipline.ts`).

# Life System + Ben: handoff prompt for any AI

Copy everything below the line into a new AI chat (Claude, ChatGPT, Codex, Gemini…) to continue the work.

---

You are joining an ongoing project as a senior full-stack engineer. Read all of this before you change anything. Ask me before anything destructive (deleting data, force-pushing, rewriting history, rotating keys).

## 1. Who I am and what I want

- I'm Victor, a university student in Moldova (time zone Europe/Chisinau, money in MDL/lei). I'm building one personal system that runs my life: study, a cyber security career (CTFs, Rust, crypto), training, sleep, discipline, money.
- I mainly use the **web app on a laptop** (desktop-first; it must also work on a phone) and **Telegram**.
- The heart of it is **Ben**, my AI coach. Ben talks like a close friend who knows me very well. He is tough love: he gets angry (😤 😠 😡) when I slip, hyped (😎) when I win, and holds me to my promises. Short replies, numbers first, one push. Always English.
- Ask me several questions before big features. I like choosing between options.
- Write commit messages and UI text in plain, simple English (what changed for me, not jargon).

## 2. Repositories and where things live

| What | Where |
|---|---|
| **Life System** (main project: web app, Ben, Telegram bot server) | GitHub `vicuvi1/MEGA-SYSTEM`, branch `main`. Every push to `main` auto-deploys to Vercel. |
| Live app | https://mega-system-ten.vercel.app (PIN login) |
| Vercel project | name `mega-system`, project id `prj_lRPy8El6DPaknUTkP28KIOU5MR5p`, team `team_d3XtH8SuXYkrYiJ852hlrGVq` (Hobby plan) |
| Database | **Turso** (libSQL, SQLite in the cloud). One database holds everything. |
| **Finance Helper** (my money app, separate repo; syncs its data into Life System) | GitHub `vicuvi1/finance-helper-app` (has its own AGENTS.md rules) |
| **Sporty** (old Python workout bot, runs on my own server next to my "Hermes" agent) | GitHub `vicuvi1/Sport-Bot-Telegram-`. Ben has taken over its features; Sporty is being retired. A sync branch `claude/wizardly-mccarthy-wy4oey` exists but was never merged (not needed any more). |

**The repos are PUBLIC.** Never commit secrets or my real personal data (real task names, amounts, people's names, screenshots). Use made-up data in tests and docs.

## 3. Secrets: names and where to find them (values are NOT here on purpose)

All server secrets are **Vercel environment variables** (Vercel → mega-system → Settings → Environment Variables). Ask me for a value only if you truly need it, and never write one into the repo, a log or a chat summary.

| Variable | What it is |
|---|---|
| `TURSO_URL` / `TURSO_DATABASE_URL`, `TURSO_TOKEN` / `TURSO_AUTH_TOKEN` | Turso database URL and token |
| `SESSION_SECRET` | signs app login sessions (falls back to a hash of the Turso token) |
| `TELEGRAM_CHAT_ID` | my Telegram chat id (only this chat is obeyed) |
| `MEGA_BOT_TOKEN` | **Ben's bot** (the Telegram bot formerly called Mega; I rename it to Ben in @BotFather) |
| `TELEGRAM_BOT_TOKEN`, `SPORT_BOT_TOKEN`, `FINANCE_BOT_TOKEN`, `MAN_BOT_TOKEN`, `WAKY_BOT_TOKEN` | older/specialist bots; `BOTS_NOT_ON_SERVER` lists bots the server should not run |
| `OPENROUTER_API_KEY` | main AI (OpenRouter, DeepSeek). `OPENROUTER_MODEL` / `OPENROUTER_STRONG_MODEL` optionally pin models |
| `GEMINI_API_KEY` | backup AI, and voice notes/photos |
| `TODOIST_TOKEN` | my Todoist |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Calendar OAuth (the refresh token is stored in the database after I sign in) |
| `CRON_SECRET` | protects the daily Vercel cron jobs |
| `SPORT_SYNC_KEY` | lets Sporty read/write water and workouts (`/api/cron?job=sport`) |
| `LIFE_TZ` | time zone (Europe/Chisinau) |
| `APP_URL` | public app URL for links in messages |
| `GITHUB_TOKEN` | optional: a fine-grained **read-only** GitHub token for the GitHub plugin (recent commits) |
| `NOTION_TOKEN` | optional: a read-only Notion connection token for the notes plugin |

Bot tokens come from @BotFather. If a token was ever pasted in a chat or screenshot, it must be revoked there and replaced in Vercel.

## 4. Architecture (Life System repo)

- **Stack:** TypeScript, React 19, Vite. The web app is plain browser code and **the product**. The Windows desktop app is an Electron shell around the same build (`src/desktop`, with the floating island in `src/desktop/island.ts`). The old Electron-only code (its own main process, Telegram hub, AI service, backups) was removed; `src/main` now holds only the services the web app runs.
- **Data:** the browser keeps a **sql.js copy (mirror) of the Turso database** (`src/renderer/src/web/mirror.ts`). It refreshes live (checks `settings.data_version` every few seconds) and writes go through to Turso. The same "desktop services" (`src/main/*.ts`: wallet, focus, sleep, body, shop, weekPlan, progress…) run on that copy via `src/renderer/src/web/webServices.ts`.
- **Server = Vercel functions in `api/*.mjs`**. Hobby plan: **max 12 serverless functions**, so extra jobs live inside `api/cron.mjs` (`?job=tick`, `?job=sport`, daily jobs).
  - `api/telegram.mjs`: Telegram webhook (Ben and the other bots).
  - `api/coach.mjs`: the app's coach chat (streams NDJSON: `{"step":…}` lines, then the reply). It also takes `{op:'rhythm'|'undo'}`.
  - `api/cron.mjs`: `job=tick` (Ben writes first: reminders, check-ins, daily rhythm). It is called every 10 min by GitHub Actions (`.github/workflows/tick.yml`) and every 2 min by the open app. There are also daily jobs and `job=sport`.
  - `api/ai.mjs`: `askModel()`. OpenRouter DeepSeek **flash** for quick replies, the **strong** model (newest DeepSeek pro/reasoning) for plans, reviews, corrections and photos, falling back to flash, with Gemini as backup and for media.
  - `api/google.mjs`, `api/todoist.mjs`, `api/login.mjs`, `api/db.mjs` (proxy to Turso), `api/config.mjs`, `api/bot-setup.mjs` (bot health on GET, also `/api/bot-health`), `api/mcp.mjs` (Life System for AI apps over MCP: personal tokens in `sys_mcp_tokens`, OAuth for claude.ai/ChatGPT; tools in `src/server/mcp.ts`; local bridge `scripts/life-mcp.mjs`). `/api/google-callback` is a rewrite to `api/google.mjs`.
- **Bot bundle:** all server logic is in `src/server/telegramBot.ts`, built into `api/_bot/bot.mjs` with `npm run build:bot`. **Rebuild and commit `api/_bot/bot.mjs` after changing anything under `src/server`, `src/renderer/src/web`, `src/core` or `src/main` that the server uses.**
- **Pure logic in `src/core/*.ts`, with tests next to it (`*.test.ts`, vitest).** Keep logic pure and tested; UI files only render.

### Ben's brain (most important files)

| File | What |
|---|---|
| `src/renderer/src/web/botBrain.ts` | Ben's persona and prompt, `lifeContext()` (everything Ben knows), actions he can take (`readAction`), memory, profile, coach log, letters |
| `src/renderer/src/web/webBots.ts` | runs everything: `think()` (one message: context → model → actions → reply), Telegram handling, buttons (callback data prefixes), commands, undo |
| `src/renderer/src/web/rhythmBot.ts` | daily rhythm: morning plan (approve/change/redo), evening review, Sunday review, weekly letter, goal booking |
| `src/core/coachKit.ts` | E#/T# references, reminders and check-ins, promises (kept/broken/ignored), nudges, mood (`coachMood`) |
| `src/core/coachMind.ts` | long-term memory: goals tracked, people, what works / doesn't, patterns from my data |
| `src/core/rhythm.ts` | when each rhythm message is due, plan building and cleaning, review score |
| `src/core/goalPlan.ts` | goals planned backward from deadlines, minutes per day, booking blocks |
| `src/core/coachImpact.ts` | "Is the coach working?" weekly scorecard |
| `src/core/coachButtons.ts` | interactive buttons/widgets under Ben's replies |
| `src/core/sportCards.ts`, `src/core/sportShared.ts` | water and workout cards and the shared water/reps log |
| `src/core/coachNext.ts` | "Do this now" |

Ben's actions (the model returns JSON with `reply`, `mood`, `chips`, `buttons`, `show`, `actions`, `remember`, `steps`, `need`) include: log, water, reps, sleep, habit, mustdo, focus (only when I ask to start), task/edit/done/star/move in Todoist (T-numbers), calendar event/move/resize/delete/shift (E-numbers), remind, checkin, kept/broken (P-numbers), delmoney/editmoney (M-numbers), goal + book, aim/works/fails/pattern/person (memory), reward, week plan, exercise/target/noexercise.

### Plugins (`src/plugins/`)

Small add-ons compiled into the app, each off until switched on in Settings → Plugins (`plugins_on`). A plugin (`src/plugins/<id>/index.ts`, `definePlugin`) can add a line to `lifeContext()`, actions checked by `readAction()` before the built-ins, Telegram commands, a file reader, server jobs (morning / tick / evening, run from `runTick` via `src/plugins/run.ts`) and read-only `mcpTools`. Today cards and Settings pieces live in `card.tsx` / `settings.tsx`, registered in `src/plugins/cards.tsx` (browser only, never in the server bundle). Settings keys: `plugin_<id>` (your settings), `plugin_<id>_data` (what the job fetched), `plugins_status`.
Plugins now: weather (Open-Meteo), github (commits + CTFtime), gmail (deadline digest, read-only, "Connect Gmail" adds `gmail.readonly`), bank (CSV import into the Finance Helper inbox), health (phone numbers by Shortcut: `POST /api/cron?job=health` with a per-phone key, hashed in `sys_health_keys`), notes (Obsidian vault in the desktop app, Notion optional).

### App UI

- `src/renderer/src/App.tsx` (shell), `pages/*.tsx`, CSS in `src/renderer/src/*.css`. **`design.css` is the design system, loaded last** (tokens like `--accent`, `--surface`, `--muted`, `--s-*`, `--t-*`; dark by default, a light mode exists).
- **Coach page** (`pages/Coach.tsx`, `CoachPanels.tsx`, `CoachPlan.tsx`, `CoachAbout.tsx`): a messenger look. Mood header, pinned "Do this now", live cards, chat with action cards + Undo, coach-written chips, buttons and widgets, mic dictation, photos, search, and an info drawer with tabs (Plan, Goals, Score, About you).
- **Focus island** (`FocusIsland.tsx`): Dynamic-Island-style live timer at the top of every page, customizable (stored device-only in `localStorage['ls.island']`).
- `newVersion.tsx`: open tabs detect a new deploy (`/version.json`) and offer a reload.
- `coachUnread.ts`: toast + badge when Ben messages on his own.

### Database: `settings` table keys (key → JSON value)

`coach_memory`, `coach_profile`, `coach_log`, `coach_mind`, `coach_reminders`, `coach_nudges`, `coach_rhythm`, `coach_rhythm_prefs`, `coach_history`, `coach_letters`, `goal_booking`, `sport_tracker_json` (**the one shared water + reps log**: `{savedAt, data:{lastDate, exercises[], water:{currentMl,targetMl,glassSizeMl}}}`; its day turns at 04:00 local, like the rest of the app), `ben_workouts`, `app_sync_finance` (Finance Helper data), `week_plan`, `focus_running`, `block_marks`, `cal_templates`, `today_order`, `milestones_seen`, `data_version`. There are also normal tables (ledger, focus_sessions, focus_goals, sleep_logs, workouts…; see `src/core/schema.ts`).

## 5. How to work

```bash
npm ci
npx tsc --noEmit -p tsconfig.json   # typecheck
npx vitest run                      # all tests must pass (~415)
npm run build:web                   # web app
npm run build:bot                   # server bundle api/_bot/bot.mjs (commit it!)
```

- Only push to `main` when typecheck and **all** tests pass (gate it: `npx vitest run >/dev/null 2>&1 && git push`). A push deploys straight to production.
- After pushing, check the Vercel deployment is READY, then call `https://mega-system-ten.vercel.app/api/cron?job=tick` (should return `{"ok":true,…}`).
- Commit as me: `git -c user.name=vicuvi1 -c user.email=victorbarbuta27@gmail.com commit`. Before pushing: `git fetch origin main && git rebase origin/main`. Never force-push.
- Local testing: a fake Turso + API server can be made with sql.js (see `src/renderer/src/web/fakeTurso.ts` and tests). The bot bundle exports `coachChat`, `runTick`, `handleTelegramUpdate`, `coachRhythm`, `coachUndo`, `sportShared` for end-to-end tests with a fake model.
- Check UI changes with screenshots at desktop width (1280–1440 px) first, then phone (390 px). Playwright + Chromium are fine.

## 6. Where we are now (latest state)

Done and live:
- **Ben** (renamed from Mega): friend voice, moods, memory, promises with escalating follow-ups, goal plans booked into Google Calendar, daily rhythm (morning plan → approve, nudges, evening review, Sunday review + weekly letter), scorecard, undo, interactive buttons, live presence in the app.
- **Ben does water and workouts** (taking over from Sporty): `/water` card (+250/+500/+1000/−250), `/workout` checklist (+10/+25/✓ All, Complete all, 3 full days → +5% auto-progression), and Ben edits the exercise plan. Body goal: build muscle, daily short home sessions.
- **Focus island** timer at the top of every page.

Waiting on me (Victor):
- Revoke the bot token that was pinned in my Telegram chat (in @BotFather) and put the new one in Vercel (`MEGA_BOT_TOKEN`).
- Rename the Mega bot to "Ben" in @BotFather.
- Decide what happens to the old bots (Sporty, Finance, Waky/MAN): switch off, or "I moved, talk to Ben".

Next planned (Stage 2, ask me first):
1. **Cyber security mentor** in Ben: CTFs for my level, a Rust/crypto path, track solved challenges, portfolio ideas.
2. **Nutrition and body:** log meals by photo or text, protein for muscle gain, weight trend, sleep + training together.
3. **Web lookups** with sources when I ask.
4. For study, Ben does **not** teach. He only plans what to study, when and for how long (blocks).
5. Maybe later: a floating always-on-top timer (Picture-in-Picture), a live timer on Telegram, a 1-bot cleanup of the old bots.

Known limits:
- Vercel Hobby keeps only 1 hour of logs.
- Max 12 functions (put new endpoints inside existing ones).
- Water and reps (Sport Track) turn the day at 04:00 local, like the rest of the app.

### Reliability (how the system protects itself)
- **Checks before shipping:** `.github/workflows/ci.yml` (every push: tsc, vitest, server bundle up to date, build, `e2e/smoke.mjs` in a real browser against `e2e/server.mjs`, a fake Turso). The Windows release runs the same smoke test; Vercel's `vercel-build` runs tests + tsc, so a red commit never goes live. CI runs on `ubuntu-24.04` (Playwright can't install on 26.04 yet). Always commit `api/_bot/bot.mjs` after `npm run build:bot`.
- **System health:** beats in `sys_health`, errors in `sys_errors` (`src/renderer/src/web/systemHealth.ts`), checks in `src/core/health.ts` (a refused key names where to fix it: `keyHint`). Ben warns on Telegram after 30 min broken, says when fixed, Sunday report. Settings → System health.
- **Backups:** the server makes the daily `cloud_snapshots` row (30 kept) and once a week test-restores the newest into a throwaway DB (`restoreDrill.ts`, beat `restoreDrill`). Desktop also writes daily files to the PC and Google Drive.
- **Sync of only what changed:** `src/renderer/src/web/tableVersions.ts`. Tracked writes record their tables in `sys_table_versions`; `'*'` follows `data_version` while every write is tracked. An untracked write (old app, restore, a direct SQL write) breaks the chain, so devices do a full download once and repair it. Any new code that writes data straight to Turso and bumps `data_version` is therefore safe without tracking, but add `trackStatements` to keep it cheap.
- **Desktop crash net:** two crashes or failed loads in 3 min offer reload / save a backup / previous version (`src/desktop/main.ts`).
- **Dependencies:** `.github/dependabot.yml`, monthly grouped PRs; CI tests them.

## 7. Rules for you

- Small, focused commits; plain-English messages; one feature at a time.
- Don't redo or undo recent work without a reason; read `git log` first.
- Never put secrets or my real personal data in code, tests, docs or commit messages.
- When something is wrong, say so plainly; when it works, show proof (test output, screenshot).
- Ask me questions when a decision is mine to make.

# Life System + Ben: handoff prompt for any AI

Last checked: 2026-11-05. Copy everything below the line into a new AI chat (Claude, ChatGPT, Codex, Gemini…) to continue the work.

---

You are joining an ongoing project as a senior full-stack engineer. Read all of this before you change anything. Ask me before anything destructive (deleting data, force-pushing, rewriting history, rotating keys). The short version of these rules is in `AGENTS.md` at the repo root.

## 1. Who I am and what I want

- I'm Victor, a university student (time zone Europe/Chisinau, money in MDL/lei). I'm building one personal system that runs my life: study, a cyber security career (CTFs, Rust, crypto), training, sleep, discipline, money.
- I mainly use the **web app on a laptop** (desktop-first; it must also work on a phone) and **Telegram**.
- The heart of it is **Ben**, my AI coach. Ben talks like a close friend who knows me very well. He is tough love: he gets angry (😤 😠 😡) when I slip, hyped (😎) when I win, and holds me to my promises. Short replies, numbers first, one push. Always English.
- Ask me several questions before big features. I like choosing between options.
- Write commit messages and UI text in plain, simple English (what changed for me, not jargon).

## 2. Repositories and where things live

| What | Where |
|---|---|
| **Life System** (web app, desktop app, Ben, Telegram bot server) | GitHub `vicuvi1/MEGA-SYSTEM`, branch `main`. Every push to `main` deploys to Vercel and builds a Windows release. |
| Live app | https://mega-system-ten.vercel.app (PIN login) |
| Vercel project | `mega-system` (Hobby plan). Find the ids in the Vercel dashboard; they are not written here. |
| Database | **Turso** (libSQL, SQLite in the cloud). One database holds everything. |
| **Finance Helper** (money app, separate repo; syncs its data into Life System) | GitHub `vicuvi1/finance-helper-app` (its own AGENTS.md rules) |
| **Sporty** (old Python workout bot) | GitHub `vicuvi1/Sport-Bot-Telegram-`. Ben has taken over its features; Sporty is being retired, but `/api/cron?job=sport` still answers it while it runs. |

**The repos are PUBLIC.** Never commit secrets, personal emails, ids, or my real personal data (real task names, amounts, people's names, screenshots). Use made-up data in tests and docs.

## 3. Secrets: names only (values are NOT here on purpose)

Server secrets are **Vercel environment variables** (Vercel → mega-system → Settings → Environment Variables). GitHub Actions secrets are under the repo's Settings → Secrets and variables → Actions. Never write a value into the repo, a log or a chat summary.

| Variable | Where | What it is |
|---|---|---|
| `TURSO_URL` / `TURSO_DATABASE_URL`, `TURSO_TOKEN` / `TURSO_AUTH_TOKEN` | Vercel | Turso database URL and token |
| `SESSION_SECRET` | Vercel | signs app sessions (falls back to a hash of the Turso token) |
| `TELEGRAM_CHAT_ID` | Vercel | my Telegram chat id (only this chat is obeyed) |
| `MEGA_BOT_TOKEN` | Vercel | **Ben's bot** |
| `TELEGRAM_BOT_TOKEN`, `SPORT_BOT_TOKEN`, `FINANCE_BOT_TOKEN`, `MAN_BOT_TOKEN`, `WAKY_BOT_TOKEN` | Vercel | older/specialist bots; `BOTS_NOT_ON_SERVER` lists bots the server should not run |
| `OPENROUTER_API_KEY` | Vercel | main AI. `OPENROUTER_MODEL` / `OPENROUTER_STRONG_MODEL` override the pinned models |
| `GEMINI_API_KEY` | Vercel | backup AI, voice notes and photos |
| `TODOIST_TOKEN` | Vercel | Todoist |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Vercel | Google Calendar/Gmail OAuth (the refresh token is stored in the database) |
| `CRON_SECRET` | Vercel **and** GitHub | signs the timers: Vercel crons, the GitHub tick, the backup workflow |
| `BACKUP_PASSPHRASE` | GitHub | encrypts the weekly off-site backup (keep a copy in your password manager: without it the backup can't be opened) |
| `SPORT_SYNC_KEY` | Vercel | lets Sporty read/write water and workouts (`/api/cron?job=sport`) |
| `LIFE_TZ` | Vercel | time zone (Europe/Chisinau) |
| `APP_URL` | Vercel | public app URL for links in messages |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel | phone push notifications (`scripts/vapid-keys.mjs` makes a pair) |
| `GITHUB_TOKEN`, `NOTION_TOKEN` | Vercel | optional, read-only: the GitHub and notes plugins |
| `AZURE_SIGN_*`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | GitHub | optional: signed Windows installers (`docs/code-signing.md`) |

Bot tokens come from @BotFather. If a token was ever pasted in a chat or screenshot, revoke it there and replace it in Vercel.

## 4. Architecture

- **Stack:** TypeScript, React 19, Vite. The web app is plain browser code and **the product**. The Windows desktop app is an Electron shell around the same build (`src/desktop`: `main.ts`, the floating island `island.ts`, `preload.ts`; built with `electron.desktop.config.mts`; the page is served locally from `out/renderer`, a copy of `dist`). `src/main` holds the services the web app runs.
- **Data:** the browser keeps a **sql.js copy (mirror) of the Turso database** (`src/renderer/src/web/mirror.ts`), refreshed live (only changed tables: `tableVersions.ts`), with an offline queue. The services (`src/main/*.ts`: wallet, focus, sleep, discipline, body, shop, weekPlan, progress…) run on that copy via `webServices.ts`. `src/renderer/src/tursoWebBridge.ts` is the web bridge (`life.*`), live.
- **Server = Vercel functions in `api/*.mjs`**: 11 of the 12 the Hobby plan allows (`functionCount.test.ts` fails at 13). Files starting with `_` are helpers, not functions. Extra jobs live inside existing functions.
  - `api/login.mjs`: PIN login, `renew` (sliding session), `signOutAll`, passkeys (`_passkey.mjs`), devices (`_devices.mjs`), `changePin`.
  - `api/db.mjs`: guarded Turso proxy (`_sqlguard.mjs`), the app's daily backup (`{snapshot}`, `_snapshots.mjs`), the database-version check (`_schema.mjs`).
  - `api/coach.mjs`: the app's coach chat (NDJSON stream), `{op:'rhythm'|'undo'}`.
  - `api/telegram.mjs`: Telegram webhook (Ben and the other bots).
  - `api/cron.mjs`: `job=tick` (Ben writes first, and the daily messages by local time), daily jobs `morning|reask|midday|evening|night`, `job=backup`, `job=sport`, `job=health` (phone numbers), `job=plugins`.
  - `api/ai.mjs`: `askModel()`: OpenRouter (pinned DeepSeek flash for quick replies, pinned strong model for plans/reviews, falling back to flash), Gemini as backup and for media; usage and the monthly budget (`_budget.mjs`).
  - `api/google.mjs`, `api/todoist.mjs`, `api/config.mjs` (bot settings without tokens, push subscribe), `api/bot-setup.mjs` (bot health, also `/api/bot-health`), `api/mcp.mjs` (Life System for AI apps over MCP: personal tokens in `sys_mcp_tokens`, OAuth for claude.ai/ChatGPT in `_mcpauth.mjs`; tools in `src/server/mcp.ts`; local bridge `scripts/life-mcp.mjs`).
- **Bot bundle:** server logic is in `src/server/telegramBot.ts`, built into `api/_bot/bot.mjs` with `npm run build:bot` (committed; CI fails if it is stale; Vercel rebuilds it too).
- **Pure logic in `src/core/*.ts`**, tests next to it (`*.test.ts`, vitest). Keep logic pure and tested; UI files only render.

### Ben's brain (most important files)

| File | What |
|---|---|
| `src/renderer/src/web/botBrain.ts` | persona and prompt, `lifeContext()`, actions (`readAction`), memory, profile, coach log, letters |
| `src/renderer/src/web/webBots.ts` | `think()` (context → model → actions → reply), Telegram handling, buttons, commands, undo (shared by browser and server) |
| `src/renderer/src/web/rhythmBot.ts` | daily rhythm: morning plan, evening review, Sunday review, weekly letter, goal booking |
| `src/renderer/src/web/benDesk.ts` + `BenDesk.tsx` | Ben's desk (`ben_desk`): patterns, energy map, excuses, mood, study topics, stakes, the Sunday call, the month's story |
| `src/renderer/src/CoachFeed.tsx` | the chat feed: cards for Ben's automatic messages, folded updates, the "Now" card |
| `src/core/coachKit.ts`, `coachMind.ts`, `rhythm.ts`, `goalPlan.ts`, `coachImpact.ts`, `coachButtons.ts`, `coachNext.ts` | references and promises, long-term memory, rhythm timing, goal plans, scorecard, buttons, "Do this now" |

### Pages and features

Today, Calendar, Tasks (Todoist), Goals, Focus, Progress, Reviews (month/year), Coach, Sleep (Waky embedded), **Discipline** (one built-in page; MAN is no longer embedded), Money (Finance Helper embedded), Body (Sport Track embedded), Rewards, **Notebook** (`pages/Notebook.tsx`, synced `notes` table; Ben can write notes too), Settings. Embedded apps live in `src/renderer/public/apps/` and talk to the host by `postMessage` (`LIFE_SYSTEM_BRIDGE`).

### Plugins (`src/plugins/`)

Small add-ons, each off until switched on in Settings → Plugins (`plugins_on`). A plugin can add a line to `lifeContext()`, actions, Telegram commands, a file reader, server jobs (morning/tick/evening via `src/plugins/run.ts`) and read-only `mcpTools`. Settings keys: `plugin_<id>`, `plugin_<id>_data`, `plugins_status`. Now: weather, github, gmail, bank (CSV import), health (phone numbers by Shortcut, keys hashed in `sys_health_keys`), notes (Obsidian in the desktop app, Notion optional).

### Database

- Tables: see `src/core/schema.ts` (**append-only**: never edit a shipped migration, add a new one and bump `SCHEMA_VERSION` in `api/_schema.mjs`; a test checks they match). Pages built for an older schema may read but `/api/db` refuses their writes ("A new version is out — please reload"). A migration that MOVES data must run once on the server, never in each browser.
- Server-only tables (`/api/db` refuses them): `sys_auth` (PIN hash, sign-out counter), `sys_login_guard`, `sys_passkeys`, `sys_passkey_chal`, `sys_devices`, `sys_gate` (once-only job slots), `sys_push`, `sys_kv`, `sys_mcp_tokens`. `cloud_snapshots` is **read-only** from pages.
- Other `sys_*` tables (never copied to devices): `sys_health` (beats and notes), `sys_error_log`, `sys_ben_log`, `sys_table_versions`, `sys_writes`, `sys_cas`.
- `settings` keys (key → JSON), the main ones: `coach_memory`, `coach_profile`, `coach_log`, `coach_mind`, `coach_reminders`, `coach_nudges`, `coach_rhythm`, `coach_rhythm_prefs`, `coach_history`, `coach_letters`, `ben_desk`, `goal_booking`, `sport_tracker_json` (the one shared water + reps log; its day turns at 04:00), `ben_workouts`, `app_sync_finance`, `week_plan`, `focus_running`, `block_marks`, `cal_templates`, `today_order`, `notif_settings`, `ai_models` (your model picks), `ai_budget`, `plugins_on`, `plugin_*`, `pin_hash` (offline copy, written by the server only), `data_version`. Another agent is moving these names into one typed list; prefer that list when it exists.

### Sign-in and security

- The PIN is checked only by the server (`sys_auth`) and changed through `/api/login {changePin}`. Wrong PINs are limited per device and overall.
- Sessions last **14 days** and are renewed while the app is in use (`session.ts renewSession`). A database hiccup is a 503, never a sign-out.
- Passkeys (fingerprint/face) and a device list with "sign this device out" (Settings → General).
- `vercel.json` sends a Content-Security-Policy: strict for the app (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), and a looser one for `/apps/*` (their big inline scripts). The embedded apps run in same-origin iframes WITHOUT `sandbox`: the host injects their theme and data into them, and they keep their own localStorage, which a sandbox (opaque origin) would break. The trade-off: code running inside an embedded app could read the session; keep those apps free of third-party scripts.
- The bots obey only `TELEGRAM_CHAT_ID`.

### Timers (Ben writes first)

- `.github/workflows/tick.yml` calls `/api/cron?job=tick` every 10 minutes (with `CRON_SECRET` and `X-Life-Timer: github`); the open app also calls it every 2 minutes. Twice a month its keepalive job re-enables the scheduled workflows through the GitHub API (GitHub switches them off after 60 days without commits in a public repo).
- The tick sends the daily messages (`morning` 08:30, `reask` 10:00, `midday` 13:00, `evening` 21:30, local time: `src/core/dailyClock.ts`) and the bedtime wind-down; the Vercel crons in `vercel.json` (UTC) are the backup. Both claim the same once-a-day slot (`sys_gate` `daily:<job>`), so nothing goes twice.
- Settings → System health shows "Ben's server" (any tick) and "Ben's timer" (the outside timer only), red after 30 minutes. Optional second pinger: a free cron-job.org or UptimeRobot monitor calling `https://mega-system-ten.vercel.app/api/cron?job=tick` every 10 minutes with the header `Authorization: Bearer <CRON_SECRET>` (and `X-Life-Timer: pinger`).

### Backups

- The server makes the daily `cloud_snapshots` row (gzipped, `gz:` + base64; 30 kept) and once a week test-restores the newest into a throwaway database (`restoreDrill.ts`). The app may add today's through `/api/db {snapshot}` but can never change or delete one. The desktop app also writes daily files to the PC and Google Drive.
- **Off-site:** `.github/workflows/backup.yml` runs every Monday: it downloads the newest backup (`/api/cron?job=backup`, `CRON_SECRET`), encrypts it with `BACKUP_PASSPHRASE` and keeps it 90 days as a workflow artifact (public repo: artifacts are downloadable by any signed-in GitHub user, which is why they are encrypted).
- **Restore an off-site copy:** download the artifact (Actions → Off-site backup → a run → Artifacts), unzip it, then
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in life-backup-YYYY-MM-DD.json.gz.enc -pass pass:'<passphrase>' | gunzip > backup.json`
  and load `backup.json` in Settings → Backups & data → "Restore from Backup File".

### Cost watch

- Each cold server start downloads the whole database into memory; the rows it read are counted per month (`sys_health` `note:coldreads:YYYY-MM`) and shown in System health (warns near Turso's free monthly reads). A `/tmp` cache was not added: on Vercel each function has its own instances and a warm instance already keeps its copy in memory.
- `ai_usage`: calls older than 90 days are rolled up into one row per month, model and kind (`calls` column) once a day; `bot_seen_updates` keeps 14 days (pruned by the server and the app). The ledger and focus history are kept whole: they are the honest record of points; they are small (one row per action).

## 5. How to work

```bash
npm ci                              # Node 22 (.nvmrc, engines)
npx tsc --noEmit -p tsconfig.json   # typecheck
npx vitest run                      # all tests must pass (~860)
npm run build:web                   # web app
npm run build:bot                   # server bundle api/_bot/bot.mjs (commit it!)
npm run smoke                       # the real app on fake data (e2e/smoke.mjs + e2e/server.mjs)
bash scripts/ship.sh <message-file> # typecheck, tests, bundle, commit, push
```

- Only push to `main` when typecheck and **all** tests pass. A push deploys straight to production.
- After pushing, check the Vercel deployment is READY, then `/api/cron?job=tick` should return `{"ok":true,…}`.
- Commit with the owner's git identity as configured on the machine (never write a personal email into the repo). Before pushing: `git fetch origin main && git rebase origin/main`. Never force-push.
- Local testing: a fake Turso is in `src/renderer/src/web/fakeTurso.ts`; the bot bundle exports `coachChat`, `runTick`, `handleTelegramUpdate`, `coachRhythm`, `coachUndo`, `sportShared` for end-to-end tests with a fake model.
- Check UI changes at desktop width (1280–1440 px) first, then phone (390 px).

## 6. Reliability (how the system protects itself)

- **Checks before shipping:** `.github/workflows/ci.yml` (tsc, vitest, bundle up to date, build, smoke test under the real CSP). Vercel's `vercel-build` runs tests + tsc, so a red commit never goes live. The Windows release (`release.yml`) runs the same smoke test and opens the app on Windows before publishing.
- **System health:** beats in `sys_health`, errors in `sys_error_log` (`systemHealth.ts`), checks in `src/core/health.ts`. Ben warns on Telegram after 30 min broken, says when fixed, Sunday report. Settings → System health.
- **Desktop crash net:** two crashes in 3 minutes offer reload / save a backup / previous version.
- **Dependencies:** `.github/dependabot.yml`, monthly grouped PRs; CI tests them. Electron and sql.js majors are ignored there on purpose: see `docs/PLAN.md` (quarterly Electron task).
- **Signed installers:** `docs/code-signing.md`.

## 7. Rules for you

- Small, focused commits; plain-English messages; one feature at a time.
- Don't redo or undo recent work without a reason; read `git log` first.
- Never put secrets, ids or my real personal data in code, tests, docs or commit messages.
- Points must be honest: a habit pays only for something actually done when it is logged.
- When something is wrong, say so plainly; when it works, show proof (test output, screenshot).
- Ask me questions when a decision is mine to make.

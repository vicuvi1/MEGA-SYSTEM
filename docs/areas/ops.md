# Operations and reliability

> Timers (the tick), alarms, self-check, backups, cost watch, CI, crash net.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

### Timers (Ben writes first)


- `.github/workflows/tick.yml` calls `/api/cron?job=tick` every 10 minutes (with `CRON_SECRET` and `X-Life-Timer: github`); the open app also calls it every 2 minutes with its session. Without the secret or a session the tick answers 401. Twice a month its keepalive job re-enables the scheduled workflows through the GitHub API (GitHub switches them off after 60 days without commits in a public repo).
- The tick sends the daily messages (`morning` 08:30, `reask` 10:00, `midday` 13:00, `evening` 21:30, local time: `src/core/dailyClock.ts`) and the bedtime wind-down; the Vercel crons in `vercel.json` (UTC) are the backup. Both claim the same once-a-day slot (`sys_gate` `daily:<job>`), so nothing goes twice.
- Settings → System health shows "Ben's server" (any tick) and "Ben's timer" (the outside timer only), red after 30 minutes. Optional second pinger: a free cron-job.org or UptimeRobot monitor calling `https://mega-system-ten.vercel.app/api/cron?job=tick` every 10 minutes with the header `Authorization: Bearer <CRON_SECRET>` (and `X-Life-Timer: pinger`).

- **Sustained failures only (2026-11-07).** A part that reports OK/errors (AI, Telegram, Google, Todoist) counts as broken only after 3 failed calls in a row (`sys_health` `<part>:fails`, reset by the next OK; a refused key at once), and the warning still waits 30 minutes from the first of them. A capped "thinking" try that Ben's chat retries with the quick model, and a call that ends after a later call already answered, don't count (`aiFailureCounts`). The daily AI ping asks the quick model with thinking off (5 tokens, fastest provider) twice (8 s, then 12 s after a 1 s wait) before it reports a failure; never the thinking model. The thinking model's cap (`thinkMs` in `api/ai.mjs`) now runs from when the chat asked, not after the model lookups.
- **AI time-outs (2026-11-08).** Root cause of "Ben's AI: Failing … aborted due to timeout": in the tick the thinking model took up to 35 s, the quick-model fallback got the last ~12 s of the 50 s request and timed out too, and the next AI calls in the same tick failed at once because no time was left; three "failures" in one tick. Now: background thinking is capped at `BACKGROUND_THINK_MS` (28 s); the quick model gets ONE retry after 1 s through the fastest provider when it times out or gets a 429/5xx (not for Ben's chat, which retries itself); the answer is marked `fallback: 'quick'` when it stands in for the thinking model; a call never made because the request's time was used up (`TimeUpError` with `skipped`) is not a failure; a time-out reads "quick timed out after 30 s", not the browser's text; OpenRouter's model list has a 5 s limit (it had none). Tests: `src/server/aiHealth.test.ts`.
- **Alerts once a day (2026-11-08).** Each kind of problem (`alertKey`: the self-check's "sc:ai" is the same kind as "ai", "sc:bot:*" is "telegram") is told at most once per local day; on a new day an unresolved problem gets one reminder. Everything broken at once is one message, each line with "What to do" (`alertHelp`; the timer's is the 3 pinger steps with the URL and the header NAMES, never the secret), and the server line folds into the timer's. Under it, "🔕 Mute … for 7 days" (`hm|<kind>`, saved in settings `health_mutes`; muting the timer mutes the server line too). "✅ Working again" only for a kind that was warned about, and only after it stayed OK for an hour (`ALERT_STEADY_MS`), so a GitHub timer that runs every few hours no longer flaps. The note `alerted` is now kind → `{at, day, on, okSince}` (old id → time notes still read). A live tick/timer/AI check hides this morning's stale self-check answer for the same part. Tests: `src/core/health.test.ts`.
- **GitHub's timer is throttled.** The `*/10` schedule really runs every 3–6 h (27 runs in a week), so the outside timer goes stale between runs. The real fix is the second pinger above (owner-only step: the secret lives in Vercel and the pinger). The open app's 2-minute call does run the tick and counts as "Ben's server" (not as "Ben's timer").
- **Desktop updates check (2026-11-09).** After ~15 pushes where the Windows release workflow failed unseen, the health tick asks GitHub's public API (no token, `User-Agent: life-system`, 5 s) for the last 5 runs of `release.yml` on main, at most once an hour (cached in `sys_health` `note:desktopupdates`). Broken = the last 2 completed runs failed (cancelled/running ignored). A GitHub error is "unknown" (green row, old answer kept), never broken. Row "Desktop updates" in System health shows the latest release version and when it was built; the alert (kind `desktop`) follows the usual once-a-day, mute and recovery rules and links the failed run. Logic: `src/core/desktopUpdates.ts`, tests `src/core/desktopUpdates.test.ts`. The "released >24 h ago while CI passed" rule was left out; the desktop app's update panel does not show this state (it cannot read server health cheaply).
- **Two alarms (CL4).** The 30-minute warnings run in the tick; the daily Vercel crons (`runDaily` in `api/cron.mjs`) run the same checks (`healthAlarm`), so a dead tick is still reported. The tick answers `health: false` (and `broken: [...]`, by kind) when something not muted has been broken 30+ minutes; the GitHub tick workflow then fails, and GitHub emails you. `backup.yml` re-enables `tick.yml` too (each workflow keeps the other on).

- **Optional outside watch: an UptimeRobot keyword monitor.** Monitor type "Keyword", URL `https://mega-system-ten.vercel.app/api/bot-health`, custom header `Authorization: Bearer <CRON_SECRET>`, keyword `"ok":false` with "alert when the keyword EXISTS", every 30 minutes. It emails you when a bot's token is refused or Telegram can't be reached, even if Ben's server is the part that broke.

- **Daily self-check (CL3).** Once a day (`sys_gate` slot `selfcheck`, from the tick or a daily cron) the server checks each bot's Telegram link (right address, no delivery error in 24 h, under 50 waiting; a wrong link is set again), Google's sign-in, the Todoist key, a 1-token AI ping and the month's AI budget (warning at 80 %), a timed database read, today's backup (warning above 3 MB, the limit is 4.5 MB), the restore drill (within 8 days) and the tick/timer beats. Results: `sys_health` `note:selfcheck`, shown in Settings → System health; problems go to Telegram at most once a day per kind (the same "alerted" list as the 30-minute alerts). Logic: `src/core/selfCheck.ts`, `src/server/selfCheck.ts`.

- **Server calls (CL2).** Every `/api` function counts its calls (and `/api/db` the rows it returns) in memory and adds them to `sys_health` `note:calls:YYYY-MM` every 25 calls or 2 minutes; System health shows the month and the rate per hour. An idle open tab asks about 70 times an hour (data every 90 s, the tick and outside apps every 10 minutes; nothing while hidden).

- **Desktop at night (CL5, CL8, CL9).** A downloaded update installs at 04:00 when nobody has used the PC for 30 minutes and no focus timer runs (or at once when the website says this version is too old to save); a ready update keeps looking for newer ones. A window frozen 30 s is restarted; a dead island window is made again; at 04:00 windows over 300 MB reload. The website reloads a hidden tab at 04:00 after 3 days, or when it holds over 250 MB.

- **Soak test (CL12).** `npm run soak` (`e2e/soak.mjs`, needs `npm run build:web`) runs the real app on the fake server with a fake clock across nights: memory, listeners, calls per idle hour, offline and a server outage, a database version bump, the day turning at 04:00. `-- --short` for a quick run, `--months=24` to seed two years of history, `SOAK_START=23:00` to start at another local time (with `--short` the one idle hour crosses midnight), `SOAK_DEBUG=1` to list the database calls of each hour. The server side: `src/server/castle.test.ts` runs 144 ticks.

### Backups


- The server makes the daily `cloud_snapshots` row (gzipped, `gz:` + base64; 30 kept) and once a week test-restores the newest into a throwaway database (`restoreDrill.ts`). The app may add today's through `/api/db {snapshot}` but can never change or delete one. The desktop app also writes daily files to the PC and Google Drive.

- **Off-site:** `.github/workflows/backup.yml` runs every Monday: it downloads the newest backup (`/api/cron?job=backup`, `CRON_SECRET`), encrypts it with `BACKUP_PASSPHRASE` and keeps it 90 days as a workflow artifact (public repo: artifacts are downloadable by any signed-in GitHub user, which is why they are encrypted).

- **Restore an off-site copy:** download the artifact (Actions → Off-site backup → a run → Artifacts), unzip it, then
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in life-backup-YYYY-MM-DD.json.gz.enc -pass pass:'<passphrase>' | gunzip > backup.json`
  and load `backup.json` in Settings → Backups & data → "Restore from Backup File".

### Cost watch


- Each cold server start downloads the whole database into memory; the rows it read are counted per month (`sys_health` `note:coldreads:YYYY-MM`) and shown in System health (warns near Turso's free monthly reads). A `/tmp` cache was not added: on Vercel each function has its own instances and a warm instance already keeps its copy in memory.
- `ai_usage`: calls older than 90 days are rolled up into one row per month, model and kind (`calls` column) once a day; `bot_seen_updates` keeps 14 days (pruned by the server and the app). The ledger and focus history are kept whole: they are the honest record of points; they are small (one row per action).

## 6. Reliability (how the system protects itself)

- **Checks before shipping:** `.github/workflows/ci.yml` (tsc, vitest, bundle up to date, build, smoke test under the real CSP). Vercel's `vercel-build` runs tests + tsc, so a red commit never goes live. The Windows release (`release.yml`) runs the same smoke test and opens the app on Windows before publishing.

- **System health:** beats in `sys_health`, errors in `sys_error_log` (`systemHealth.ts`), checks in `src/core/health.ts`. Ben warns on Telegram after 30 min broken, says when fixed, Sunday report. Settings → System health.

- **Desktop crash net:** two crashes in 3 minutes offer reload / save a backup / previous version.

- **Dependencies:** `.github/dependabot.yml`, monthly grouped PRs; CI tests them. Electron and sql.js majors are ignored there on purpose: see `docs/PLAN.md` (quarterly Electron task).

- **Signed installers:** `docs/code-signing.md`.

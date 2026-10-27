# Life System

One desktop app, one points wallet, many sections. Doing good things (waking up on time, study blocks, clean days, workouts, skincare, staying under budget) earns coins and XP. Slipping costs a small number of coins. Coins buy real rewards from the Shop.

The full roadmap is in [docs/PLAN.md](docs/PLAN.md).

## Status

**Phases 0-6 are fully implemented (v0.7.0): Core economy, Tasks + Schedule, Discipline (MAN), Sleep (Waky), Body & Training workouts, Finance Helper money tracking, Daily Rituals hub, Telegram bot nudges, custom backups, and desktop installer.**

Apps inside Life System (same screens, same features):
- **Money → Finance Helper**: the real Finance Helper (copied into `apps/finance`) runs in its own tab with its desktop features: folder and Drive sync, daily backups in Documents\Finance Helper\Backups, Binance, Telegram bot and Ctrl+Alt+N quick add. `src/main/apps/finance.ts` replaces only its main.cjs.
- **Discipline → MAN**: the MAN desktop page (`apps/man`) runs in its own tab.
- **Sleep → Waky**: Life System starts your installed Waky (no window of its own) and shows it in its tab, so its alarm, wake task and updates keep working.
- On first start the standalone Finance Helper's and MAN's saved data is copied in (originals untouched). Secrets stored by the standalone apps (Telegram, Binance, Drive keys) are tied to those apps, so connect them once again inside Life System.
- Each section has a second tab with Life System's own view (coins, streak, stats). Coins from Finance now come from the copy inside Life System, so its Drive sync file is no longer needed.
- Refresh the copies with `node scripts/sync-apps.mjs --finance <checkout> --man <index.html>`.

Connected apps (Sleep, Money, Connected apps pages):
- Waky stays the alarm. Life System reads `data/waky.json`: each on-time wake-up pays +10 and each on-time bedtime +5, from the day you connect. Sleep shows this morning, the wake streak, on-time rate, a two-week chart and average sleep.
- Finance Helper stays the money app. Life System reads the file it syncs to `G:\My Drive\Finance Helper\finance-helper-sync.json`: a day with logged spending pays +3, and a finished day with everyday spending (bills and rent left out) under your daily budget pays +5. Days after Finance Helper's last save aren't judged. Turn on its folder sync so the file stays fresh.
- MAN: its desktop copy's saved streak is read once to suggest the Discipline start date that shows the same day count. Nothing is paid from it.
- Checked on start and every 5 minutes, or with "Check now". Payouts are never repeated, even after an undo. Sleep and money rules can't be tapped in Quick log anymore.

Phase 3 (Discipline, private):
- The streak is worked out from a start date and dated resets, never a manual +1. A reset ("I slipped") restarts the current count only; best streak, total clean days and XP stay. It costs a few coins and opens a comeback plan.
- Daily clean check-in (+20), morning oath (hold 3 s), and the urge crusher: a 3-minute breathing and push-up timer that pays only when it runs to the end. Panic shortcut from anywhere: Ctrl + Alt + U (also in the tray menu).
- Milestones at 3, 7, 10, 14, 30, 60, 90, 180 and 365 days pay bonus coins and XP once per streak. Days reached before the streak was entered in the app show as reached without coins, so a backdated start can't unlock a pile at once.
- Ranks, a 90-day campaign grid, a daily quote. Stealth mode hides the section and its Today card until clicked. The event log is append-only.
- Study and Discipline points can no longer be tapped in Quick log; they only come from the timer, check-in and crusher.

Phase 2 (Tasks + Schedule):
- Tasks in categories Body, Face, Finance, University, Life (add your own). One-off tasks with an optional due date, or repeating every day or on chosen weekdays. Each task pays up to 30 coins; all tasks together pay at most 150 coins a day (XP keeps counting). Unticking a task takes its coins back.
- Schedule: blocks on a weekly plan or on one day. A study block pays only after its focus timer has run for 80% of the block; skipping costs a few coins, and a study block left open past its day is marked missed with the same cost. Workout blocks log a workout. One block runs at a time.
- Windows reminders before and at the start of each block. Closing the window keeps the app in the tray so reminders keep coming; quit from the tray icon. "Start with Windows" works in the installed app.
- Today shows today's blocks and tasks.

Phases 0-1:

- Shop: rewards with a coin price and a real-money cost, tiers that unlock with level (Bronze 1, Silver 5, Gold 10, Legendary 20), one "main goal" shown on Today, add/edit/archive your own rewards.
- Monthly real-money reward budget, so coins never push overspending.
- Chests: every level up drops one, opened for bonus coins. Chest prizes are final (no undo-and-reroll).
- Bought something by mistake? Undo it in History and the coins come back.

- Wallet: an append-only ledger. The database rejects edits and deletes, and an undo is a new row that needs a reason.
- Levels and ranks: XP never goes down. Penalties take coins only and never push the wallet below zero.
- Point rules: editable in the app, with daily limits and cooldowns.
- Encrypted backups to `G:\My Drive\Life System\backups`. They run on launch, every 30 minutes if something changed, and on quit. Restore and "check latest backup" are in Settings. If Drive is missing, backups wait on this PC.
- App lock (PIN) on start, after 10 minutes idle, and when Windows locks or sleeps.
- Sidebar sections Tasks, Schedule, Sleep, Discipline, Body, Money, Shop and Journey are placeholders for the next phases.

## Install and update

- Installed per user at `%LOCALAPPDATA%\Programs\life-system`, with a **Life System** shortcut on the Desktop and in the Start menu. Data lives in `%APPDATA%\LifeSystem` and survives updates.
- **Settings → Updates → Update now** (or the "Update to x" badge in the top bar) downloads the newest GitHub Release, installs it quietly and restarts. It also checks on start and every 4 hours. The private repo is read with this PC's GitHub CLI login (`gh auth login`); no token is stored in the app.
- Publishing a version: `npm run release` (next patch), `npm run release -- minor`, or `npm run release -- 1.2.3`. It bumps the version, tags and pushes; `.github/workflows/release.yml` builds the installer and publishes the release.
- Local installer build without publishing: `npm run dist` (output in `release/`).

## Run it

```bash
npm install
npm run dev      # the real desktop app (Electron)
npm run web      # UI only, in a browser, with demo data
npm test         # unit tests
npm run typecheck
```

Data lives in `%APPDATA%\LifeSystem\life.db`. Dev runs use `%APPDATA%\LifeSystem-dev` and back up to `backups-dev`.

## Layout

```
src/core/      pure logic, no Electron: ledger, rules, levels, streaks, backup crypto, retention
src/main/      Electron main process: SQLite + migrations, wallet, PIN lock, backups, IPC
src/preload/   the typed bridge exposed to the UI as window.life
src/shared/    API types shared by main, preload and UI
src/renderer/  React UI: shell, Today, History, Point rules, Settings, lock screen
```

## Notes

- The PIN is a privacy lock for the screen. The local database itself is not encrypted; the Drive backups are, with AES-256-GCM and your passphrase.
- The backup passphrase is stored with Windows DPAPI so backups run on their own. Keep a copy somewhere safe: without it, a backup can't be opened on another PC.

# Life System

One desktop app, one points wallet, many sections. Doing good things (waking up on time, study blocks, clean days, workouts, skincare, staying under budget) earns coins and XP. Slipping costs a small number of coins. Coins buy real rewards from the Shop.

The full roadmap is in [docs/PLAN.md](docs/PLAN.md).

## Status

**Phases 0-3 are done. Next: Phase 4, Sleep (Waky port).**

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

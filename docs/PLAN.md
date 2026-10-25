# Life System: one desktop app, one points wallet, many sections

## Context
Victor has built several separate self-improvement apps. Each has its own "request/reward" idea, and none of them share a currency:

| Existing app | Where it lives | What is worth keeping |
|---|---|---|
| **MAN** (recovery / "Spartan Discipline", Antigravity-built) | disk: `C:\Users\victo\.gemini\antigravity\scratch\ManApp`; private repo `vicuvi1/Poppy-bot` | panic "urge crusher", 90-day map, ranks, milestone feasts, disguise idea |
| **Waky** (wake-up check-in) | `vicuvi1/Waky-` | coins, tiers, chests, shields, reward shop, undo (`app/game.py`, `app/stats.py`) |
| **Finance-Helper-App** | `vicuvi1/Finance-Helper-App`; Drive: `G:\My Drive\Finance Helper` | safe-to-spend, jars, budgets (pure tested logic in `js/model.js`) |
| **Sport-Bot (Workout Crew)** | this repo | per-user timezone scheduler, level curve, quests, moderator flow |
| **life_os** (Next.js + Firebase, July) | `vicuvi1/life_os` | habit/streak maths, notification scheduler, Firestore rules pattern |

**Goal:** a new, clean desktop app, the "Life System". One points wallet, a game-like feel (levels, ranks, chests), and sections for Tasks, Schedule, Sleep, Discipline, Body, Money and a Reward Shop. Doing good things earns points. Slipping costs a *small* amount. Points buy real things (shaver, face cream, phone case, a Kaaba trip fund) so the brain learns "good actions get rewarded".

**Decisions already made by Victor:** new clean project (not an extension of life_os or Sport-Bot); a **desktop app** with its backup in **Google Drive**; the recovery module is **private and discreet** inside the hub, under a neutral name.

**Findings that shape the design**
- Every existing app derives points from source data or keeps a loose counter. None has a real wallet. Waky derives coins from day records, the sport bot re-counts points on demand, and MAN's streak is a manual `+1` button.
- MAN's streak never resets when a day is missed. A one-time hack in `loadData()` forces it to at least 3, so the "10 days" it shows may not be exact. The hub will derive streaks from dated events.
- MAN stores a GitHub PAT in plaintext, commits `debug.keystore` and `MAN.apk`, and has the passcode `man` hardcoded. None of that carries over.
- Google Drive for Desktop is already running with `G:\My Drive`. Backing up there needs **no OAuth**. We write files into the synced folder.
- Node 22 and Python 3.13 are installed. The Finance app already uses Electron + electron-builder + GitHub-Releases auto-update, so that pattern is proven here.

## Approach (recommended)

**Stack**
- **Electron** (main process + sandboxed renderer, `contextIsolation` on, a typed IPC bridge in `preload`).
- **Renderer:** React + TypeScript + Vite, with CSS variables for themes (reusing the sport-bot palette tokens: dark with lime/orange accents) and `framer-motion` for animation.
- **Storage:** local **SQLite** in `%APPDATA%\LifeSystem\life.db` (via `better-sqlite3`, with Electron prebuilt binaries; first task is a spike to confirm it installs, with fallback to Node's built-in `node:sqlite`). Versioned SQL migrations.
- **Tests:** Vitest for all pure core logic; one Playwright-for-Electron smoke test.
- **Repo:** new private GitHub repo `vicuvi1/Life-System`, local at `C:\Users\victo\Projects\Life-System`. Develop locally first, push finished phases to GitHub as backup, per the local-first workflow.

**Architecture: a small core plus pluggable sections**
```
src/main/        DB, migrations, ledger, rules engine, scheduler, backup, IPC handlers
src/core/        PURE logic (no Electron, fully unit-tested): ledger.ts, levels.ts, streaks.ts, rules.ts, shop.ts
src/modules/<m>/ manifest.ts (name, icon, route), View.tsx, rules.ts (point rules), migrations/*.sql
src/renderer/    shell: sidebar, top bar (level/XP/coins), dashboard, theme, FX, lock screen
```
Adding a section means adding a folder to `src/modules/`. The shell reads the module registry to build the sidebar and dashboard cards.

**The wallet (the key piece)**
- `ledger` table, **append-only**: `id, ts, module, kind (earn | spend | adjust | undo), coins, xp, rule_id, ref, note, undo_of`.
- Balance = sum of coins. Nothing is stored as a counter, so it can always be audited and rebuilt.
- **XP and level never go down** (progress feels safe). **Coins can be docked, but only a little**, and the balance never goes below 0. A skipped study block costs about -5 coins and no XP.
- Level curve and rank names: adapt `leveling_service.py` (`80·L^1.3`). Tiers, chests, shields and vouchers: port from Waky's `game.py`.
- **Rules table** (editable in the UI, not hardcoded): `id, module, trigger, coins, xp, daily_cap, cooldown`. Examples:
  - up by 07:00: +10
  - study block completed with the focus timer: +15
  - study block skipped: -5
  - clean day: +20
  - 10 / 30 / 90 clean day bonuses
  - workout done: +10
  - under daily budget: +5
- Anti-gaming: daily caps per rule, task completion that can require a timer, and every manual adjustment or undo carries a required note and is visible in history. A weekly review screen lists the biggest earners and any adjustments.
- Undo: writes an `undo` row pointing at the original, never a delete.

**Sections (sidebar)**
1. **Today:** dashboard with level bar, coins, streak flames, today's schedule, top tasks per category, and "next reward" progress.
2. **Tasks:** categories **Body, Face, Finance, University, Life** plus user-defined ones. Each task has points, priority, due date and optional repeat. The to-do list is the same idea as the sport bot's quests, without the moderator.
3. **Schedule:** a day/week timeline with time blocks (study blocks, workouts, sleep, prayer/free). Blocks link to rules, so finishing or skipping one posts to the wallet. Recurring blocks and desktop notifications before they start.
4. **Sleep:** port Waky: wake-up "I'm up" check-in, bedtime log, journey levels, streak shields. Import Waky's `data/waky.json` history as ledger events.
5. **Discipline** (neutral name, private): honest streak derived from dated entries (see below).
6. **Body:** workouts and body logs, ported from the sport bot's exercise/streak model. The Telegram bot stays running for now and is not rewritten.
7. **Money:** lightweight daily income/expense log with a safe-to-spend figure and budget points. The full Finance app stays separate. A later step reads its Drive file (`G:\My Drive\Finance Helper`) for "under budget" events.
8. **Shop:** rewards with a coin price, tier unlocks, chests, and a real-money **monthly budget cap** so points never push overspending. Seed items: face cream, phone case, shaver machine, Kaaba trip fund (a long-running savings goal). Add a "wishlist" with real prices.
9. **Journey / Insights:** level and rank history, weekly recap, charts of earned vs. spent per module.

**Discipline module: how it works**
- Stored as dated events: `clean_day`, `relapse`, `urge_resisted`, `oath`. The current streak, best streak and total clean days are computed from them. There is no manual `+1`.
- **Honest relapse flow:** one button. It resets the *current* streak only. Best streak and total clean days are kept. XP is never lost. A small, capped coin penalty applies. It opens a "comeback quest" instead of shame text.
- **Urge Crusher:** the 3-minute breathing and push-up timer from MAN, plus a one-click panic hotkey. A successful use earns coins.
- Milestones 10, 30 and 90 days, plus the existing 60-plus-quote codex and 8 ranks, are ported from `ManApp`.
- **Privacy:** neutral names everywhere ("Discipline"). A "stealth" toggle blurs the section and its dashboard card. Its numbers can be hidden from the dashboard. No explicit wording is stored in the database or backups.
- **Seeding:** on first run the user enters the real start date of the current streak (to be confirmed; the MAN counter might be off). MAN stays installed and untouched until the user chooses to retire it.

**Backup to Google Drive**
- `G:\My Drive\Life System\backups\`. On launch, on exit, and every 30 minutes if there were changes, write a consistent snapshot (SQLite `VACUUM INTO`).
- **Encrypt** snapshots with a user passphrase (AES-GCM + PBKDF2, modelled on the Finance app's `js/cipher.js`). The recovery and money data go into Drive, so they should not sit there as plain files.
- Retention: the last 10 snapshots plus one per day for 30 days. A "Restore from backup" screen, and a "verify last backup" check that opens the snapshot read-only.
- Also an **app lock** (PIN on launch and after idle). If `G:\` is missing, the app shows a warning badge and keeps a local copy until Drive returns.

## Phases
Each phase ends with something usable, and gets pushed to GitHub when finished.

| Phase | Deliverable |
|---|---|
| **0 Foundations** | New repo, Electron + Vite + React + TS skeleton, the SQLite spike, migrations, IPC bridge, lock screen, **encrypted Drive backup + restore**, test setup |
| **1 Core economy** | Ledger, levels/ranks, rules engine and editor, Shop (tiers, chests, budget cap, undo), dashboard shell, first theme and FX. **First usable version.** |
| **2 Tasks + Schedule** | Categorized tasks, repeating tasks, day/week timeline, study blocks with focus timer, notifications, tray icon and auto-start |
| **3 Discipline** | The module above, with panic hotkey and stealth mode |
| **4 Sleep** | Waky port plus import of Waky history |
| **5 Body + Money** | Workout logging; money log with safe-to-spend; read-only link to the Finance app's Drive data |
| **6 Polish + extras** | Weekly recap, themes, sounds, installer (electron-builder) with GitHub-Releases auto-update, optional Telegram nudges from the desktop app (token stored locally and encrypted), optional phone view later |

Order rationale: Phases 0-2 give a working wallet, tasks and schedule in the first sessions. Discipline comes right after, since it matters most to Victor and the Android app keeps working meanwhile.

## Critical files / reuse
- Port from: `Waky-/app/game.py`, `app/stats.py` (tiers, chests, redeem and undo); `Sport-Bot-Telegram-/services/leveling_service.py` (level curve), `scheduler.py` (per-user timezone cron idea), `webapp/dev.py` (seed + switch-user dev workflow), `webapp/static/app.css` (design tokens); `Finance-Helper-App/js/cipher.js` (encryption), `electron/*.cjs` + `.github/workflows/desktop.yml` (installer and updates); `ManApp/src/com/mindprotocol/man/SpartanCodex.java`, `AchievementsManager.java` and `desktop/index.html` (quotes, ranks, rewards).
- Not reused: MAN's streak code, passcode, PAT updater, committed keystore/APK, the sport bot's crew/duel domain.

## Verification
- `npm test`: Vitest covers the ledger (balance, undo, floor at 0, daily caps), level curve, streak derivation (gaps, relapse, timezone/midnight edges), shop (tier lock, budget cap, undo) and the backup encrypt/decrypt round trip.
- Run `npm run dev`, then check by hand: earn via a rule, spend in the shop, undo, relapse flow, and a task completed after midnight.
- Backup: change data, quit, confirm an encrypted file appears in `G:\My Drive\Life System\backups`, restore it into a fresh profile, and confirm the balance and streaks match. Test the "Drive missing" path too.
- UI: renderer runs in the browser with a mock bridge for screenshots at narrow and wide window sizes; one Playwright-Electron smoke test (launch, unlock, add task, complete task, balance changes).
- Packaging (Phase 6): build the installer, install on a clean path, and confirm auto-start and tray.

## Open items to confirm during build (not blockers)
- Real start date of the current clean streak.
- Initial point values, shop items and their prices.
- Monthly real-money reward budget.
- Whether to retire the MAN Android app once Discipline is trusted.
- After approval: save a project memory note for this hub and add the new repo to the memory index.

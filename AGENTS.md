# AGENTS.md — Agent System & Developer Guide

## 1. Project Overview & Architecture
Life System (`MEGA-SYSTEM`) is an offline-first, local-first gamified habit, task, workout, and life operations hub built on Electron 45, React 19, TypeScript, and SQLite (`better-sqlite3`). It unifies multiple self-improvement domains (Sleep/Waky, Discipline/MAN, Money/Finance Helper, Workouts/Body, Tasks, Schedule, Shop, Telegram Bot Command Center) into a single append-only points wallet with levels, ranks, chests, and rewards.

### Directory Structure
```
src/
  core/        Pure TypeScript business logic (zero Electron/DOM deps): ledger, levels, streaks, dates, body, shop, quests, sleep, money, shields, dataExport, botCommands.
  main/        Electron main process: SQLite migrations (001-006), DPAPI secrets, backups, Telegram notifier, TelegramBotHub (2-way long-polling), SleepService, MoneyService, ShieldService, DataExportService, IPC handlers.
  preload/     Typed context bridge exposed safely to the renderer as window.life.
  shared/      Cross-boundary TypeScript types and LifeApi interface definitions.
  renderer/    React 19 + Framer Motion user interface (Today, Tasks, Schedule, Sleep, Discipline, Body, Money, Shop, Journey, BotCenter, Connected, Settings).
apps/          Embedded sandboxed apps (Finance Helper, MAN) running in isolated partitions.
```

---

## 2. Recent Implementation Summary (Phases 5 through 8 — v0.9.0)
- **Phase 5 (Body Module)**:
  - Database Migration `005` with `exercises`, `workouts`, and `body_metrics` tables.
  - Multi-exercise workout session logger with custom reps/units, awarding `body.workout_done` (+10 coins, +25 XP) to the wallet.
  - Weight & waist metric tracking with 12-week moving average smoothing.
- **Phase 6 (Daily Rituals, Audio Polish, Telegram Bridge & Packaging)**:
  - **Daily Rituals Hub**: 5 core pillars tracked on Today: Morning Oath (+3), Clean Day (+20), Workout Session (+10), Skincare Routine (+5), and Spending Log (+3).
  - **Audio System Expansion**: Synthesized audio for level-ups, fanfare, and completed rituals.
  - **Desktop Visibility**: Windows desktop shortcut (`Life System.lnk`) and launcher on `C:\Users\victo\Desktop`.
- **Phase 7 (Standalone Sleep & Expense Hub, Streak Shield Economy & Data Portability)**:
  - **Database Migration 006**: Created `sleep_logs` and `expenses` tables.
  - **Standalone Sleep Tracker**: Native sleep check-in with 1-click "I'm Up" (+10 coins) and "Bedtime" (+5 coins).
  - **Standalone Expense Hub**: Native expense tracker with category breakdown and daily budget (+3 coins on first log).
  - **Streak Shield Economy**: Purchase Streak Shields (50 coins) in the Shop to protect streaks.
  - **Data Export**: 1-click JSON system snapshot and CSV exports for workouts and expenses in Settings.
- **Phase 8 (Telegram Bot Command Center — v0.9.0)**:
  - **Pure Bot Command Domain Parser (`src/core/botCommands.ts`)**: Parses 11 Telegram command types (`/today`, `/checkin`, `/oath`, `/workout`, `/expense`, `/tasks`, `/done`, `/wake`, `/bed`, `/panic`, `/help`) and direct exercise shortcuts (`/pushups 50`, `/pullups 20`, `/squats 30`).
  - **Long-Polling Telegram Bot Hub (`src/main/telegramHub.ts`)**: Outbound HTTPS polling (`getUpdates?offset=X&timeout=20`) requiring zero open ports or webhooks. Enforces strict Chat ID whitelist verification before executing any local ledger write.
  - **Real-Time 2-Way Ledger Synchronization**: Actions performed from Telegram immediately insert append-only rows in SQLite ledger, award coins/XP, update streaks, and broadcast `wallet:changed` IPC to refresh the desktop UI in real-time.
  - **Multi-Bot Ecosystem Bridges**: Configuration fields and routing for Sport Bot, Finance Helper Bot, and MAN Recovery Bot.
  - **Desktop Bot Center UI (`src/renderer/src/pages/BotCenter.tsx` & `bots.css`)**:
    - Hero panel with live polling status, last poll timestamp, error indicator, and processed command counter.
    - DPAPI encrypted token & Chat ID configuration card with password show/hide and 1-click test ping.
    - 3-tab navigation: Interactive Command Codex (with 1-click copy), Ecosystem Bot Bridges, and Live Command Audit Feed (last 50 commands with status and responses).
- **Testing & Quality Assurance**:
  - **143 tests passing** across 25 test suites (`npm test`).
  - **0 TypeScript compilation errors** (`npm run typecheck`).
  - Production build verified with `electron-vite build`.

---

## 3. Adversarial Code Review & Security Hardening
During the autonomous audit, the following edge cases and flaws were addressed:
1. **Chat ID Whitelist Security**: Disallowed any unknown Telegram sender from querying the user's ledger, balances, or executing commands. Rejections are logged as unauthorized in the audit feed.
2. **DPAPI Credential Encryption**: Primary and secondary bot tokens are encrypted at rest with Windows DPAPI via `safeStorage` in `telegram_hub.bin`.
3. **Outbound Polling Resiliency**: Added error backoff intervals and AbortController signals so network drops or Telegram rate limits gracefully recover without app freezes.
4. **Append-Only Ledger Guarantee**: All coin awards from Telegram commands run through the pure `Wallet` service, guaranteeing valid reasons, timestamping, and immutability.
5. **Secondary Bot Fallbacks**: Secondary bridges automatically fall back to the primary chat ID if a dedicated ID is not supplied.

---

## 4. Handoff Brief for Claude Code
Life System v0.9.0 now features a fully operational, 2-way Telegram Bot Command Center alongside its complete offline SQLite database, gamified ledger, standalone sleep/expense/body engines, and React 19 UI with 143 passing tests. The new `BotCenter.tsx` page is modular, responsive, and styled using `bots.css` tokens. When you take over visual design, focus on enhancing Tailwind styling, tactile button interactions, and real-time animation polish across `BotCenter.tsx` and `Today.tsx` without breaking the established IPC channel contracts.

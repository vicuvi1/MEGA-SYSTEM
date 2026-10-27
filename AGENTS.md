# AGENTS.md — Agent System & Developer Guide

## 1. Project Overview & Architecture
Life System (`MEGA-SYSTEM`) is an offline-first, local-first gamified habit, task, workout, and life operations hub built on Electron 45, React 19, TypeScript, and SQLite (`better-sqlite3`). It unifies multiple self-improvement domains (Sleep/Waky, Discipline/MAN, Money/Finance Helper, Workouts/Body, Tasks, Schedule, Shop, Telegram Bot Command Center, and Unified Economy) into a single append-only points wallet with levels, ranks, chests, and rewards.

### Directory Structure
```
src/
  core/        Pure TypeScript business logic (zero Electron/DOM deps): ledger, levels, streaks, dates, body, shop, quests, sleep, money, shields, dataExport, botCommands, unifiedEconomy.
  main/        Electron main process: SQLite migrations (001-007), DPAPI secrets, backups, Telegram notifier, TelegramBotHub (2-way long-polling), SleepService, MoneyService, ShieldService, UnifiedEconomyService, DataExportService, IPC handlers.
  preload/     Typed context bridge exposed safely to the renderer as window.life.
  shared/      Cross-boundary TypeScript types and LifeApi interface definitions.
  renderer/    React 19 + Framer Motion user interface (Today, Tasks, Schedule, Sleep, Discipline, Body, Money, Shop, Journey, BotCenter, Connected, Settings).
apps/          Embedded sandboxed apps (Finance Helper, MAN) running in isolated partitions.
```

---

## 2. Recent Implementation Summary (Phases 5 through 9 — v1.0.0)
- **Phase 5 (Body Module)**:
  - Database Migration `005` with `exercises`, `workouts`, and `body_metrics` tables.
  - Multi-exercise workout session logger with custom reps/units, awarding `body.workout_done` (+10 coins, +25 XP) to the wallet.
- **Phase 6 (Daily Rituals, Audio Polish, Telegram Bridge & Packaging)**:
  - **Daily Rituals Hub**: 5 core pillars tracked on Today: Morning Oath (+3), Clean Day (+20), Workout Session (+10), Skincare Routine (+5), and Spending Log (+3).
  - **Desktop Visibility**: Windows desktop shortcut (`Life System.lnk`) and launcher on `C:\Users\victo\Desktop`.
- **Phase 7 (Standalone Sleep & Expense Hub, Streak Shield Economy & Data Portability)**:
  - **Database Migration 006**: Created `sleep_logs` and `expenses` tables.
  - **Standalone Sleep Tracker**: Native sleep check-in with 1-click "I'm Up" (+10 coins) and "Bedtime" (+5 coins).
  - **Standalone Expense Hub**: Native expense tracker with category breakdown and daily budget (+3 coins on first log).
  - **Data Export**: 1-click JSON system snapshot and CSV exports for workouts and expenses in Settings.
- **Phase 8 (Telegram Bot Command Center — v0.9.0)**:
  - **Pure Bot Command Domain Parser (`src/core/botCommands.ts`)**: Parses 11 Telegram command types (`/today`, `/checkin`, `/oath`, `/workout`, `/expense`, `/tasks`, `/done`, `/wake`, `/bed`, `/panic`, `/help`, `/vault`, `/goals`).
  - **Long-Polling Telegram Bot Hub (`src/main/telegramHub.ts`)**: Outbound HTTPS polling (`getUpdates?offset=X&timeout=20`) requiring zero open ports or webhooks. Enforces strict Chat ID whitelist verification before executing any local ledger write.
  - **Desktop Bot Center UI (`src/renderer/src/pages/BotCenter.tsx` & `bots.css`)**: Live polling status, encrypted pairing, interactive Command Codex, multi-bot bridges, and real-time command audit feed.
- **Phase 9 (Grand Unified Rewarding & Financial Ecosystem — v1.0.0)**:
  - **Database Migration 007**: Created `wishlist_goals`, `reward_vault_ledger`, and `chest_loot_drops` tables.
  - **Unified Real-Money Reward Surplus Vault**: Accumulates real surplus cash when finishing days under daily budget. Funds real-world rewards and mega milestones directly.
  - **Coin-to-Real-Money Valuation**: Transparent economic exchange rate (100 coins = 10 MDL, 1 coin = 0.10 MDL) giving tangible real-world value to every habit completed.
  - **Dynamic Multiplier Engine**:
    - Clean discipline streak multiplier (1.1x at 3d, 1.25x at 7d, 1.5x at 14d, 2.0x at 30d).
    - +15% Financial Budget Shield bonus when under budget 3+ consecutive days.
  - **Wishlist Mega Goals System**: Long-term life goals (Kaaba Pilgrimage, Tech Setup, Spa Retreat) with dual progress tracking (coins and real cash), velocity ETA projections, and deposit modals.
  - **Enhanced Mystery Chest Loot Table**: Chests roll Coins Jackpots (60%), free Streak Shields (20%), Reward Vault Cash Boosts (15%), or 24-hour 2x Super Multiplier Shards (5%).
  - **Unified Master Deck in Shop (`Shop.tsx` & `economy.css`)**:
    - 4-metric Command Deck: Coins Wealth, Reward Vault, Monthly Budget Cap, Active Multiplier.
    - Pinned Master Goal showcase with dual progress bars and ETA countdown.
    - 3-tab navigation: Rewards Catalog (with Streak Shields), Wishlist Mega Goals, and Savings Vault & Redemptions Ledger.
    - Celebratory audio fanfare and particle bursts on redemption and goal claims.
- **Testing & Quality Assurance**:
  - **164 tests passing** across 27 test suites (`npm test`).
  - **0 TypeScript compilation errors** (`npm run typecheck`).
  - Production build verified with `electron-vite build`.

---

## 3. Adversarial Code Review & Security Hardening
1. **Chat ID Whitelist Security**: Disallowed any unknown Telegram sender from querying the user's ledger, balances, or executing commands.
2. **DPAPI Credential Encryption**: Primary and secondary bot tokens are encrypted at rest with Windows DPAPI via `safeStorage`.
3. **Surplus Vault Integrity**: Vault withdrawals cannot exceed accumulated surplus; ledger rows are append-only.
4. **Multiplier Math Safety**: All multipliers clamp to valid ranges and round cleanly to avoid fractional coin arithmetic anomalies.
5. **Backwards Compatibility**: Preserved all existing `shop.state()` and IPC contracts while introducing the rich `life.economy` namespace.

---

## 4. Handoff Brief for Claude Code
Life System v1.0.0 is the complete, grand unified life operations and rewarding ecosystem with all money, savings, coins, habits, and Telegram bots operating as one single cohesive platform backed by 164 passing tests. The new `Shop.tsx` and `economy.css` feature the Master Economy Deck, Dream Wishlist, and Mystery Chest loot mechanics. Your objective is visual styling refinement, micro-interactions, and responsive polishing of these components while preserving the clean SQLite and IPC bridges.

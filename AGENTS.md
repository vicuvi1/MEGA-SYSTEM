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

## 2. Recent Implementation Summary (Phases 5 through 10 — v1.1.0)
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
  - **Dynamic Multiplier Engine**: Clean discipline streak multiplier (1.1x at 3d, 1.25x at 7d, 1.5x at 14d, 2.0x at 30d), plus +15% Financial Budget Shield bonus when under budget 3+ consecutive days.
  - **Wishlist Mega Goals System & Mystery Chest Loot Tables**.
- **Phase 10 (Solo Leveling Hunter Awakening Progression System — v1.1.0)**:
  - **30 Comprehensive Hunter Ranks (`src/core/levels.ts`)**: Spans Levels 1 to 150 across E-Rank Weakest Hunter, D-Rank Survivors, C-Rank Strikers, B-Rank Raiders, A-Rank Elite Vanguard, S-Rank Calamity Busters, National Level Hunters, Monarch Candidates, the Shadow Monarch, and Transcendent Sovereigns. Each rank features motivational lore, passive perks, daily quest bonuses, and distinct glowing aura themes.
  - **5-Attribute RPG Matrix (`calculateHunterAttributes`)**: Real-life habits directly power RPG stats on read without database overhead:
    - **STR** (Strength): Workouts logged and reps executed.
    - **AGI** (Agility): Early wake-ups and circadian discipline.
    - **VIT** (Vitality): Sleep quality, total clean days, and staying under daily budget.
    - **INT** (Intelligence): Deep work focus blocks and university study sessions.
    - **SEN** (Perception / Willpower): Current discipline streak and emergency urge crushe protocols.
    - **Combat Power (CP)**: Weighted composite score measuring holistic life power.
  - **Holographic System Status Window (`Journey.tsx` & `hunter.css`)**:
    - Dark obsidian glass and azure cyan holographic neon styling.
    - Player Identity Card ("Player: Victor Barbuta", Title, Grade, Level, and CP).
    - 5-Attribute Matrix with glowing progress bars and subtext descriptors.
    - Active Hunter Rank Lore and Passive Perk Banner.
    - Complete 30-Rank Hunter Awakening Codex with tab filters (All, E-D-C, B-A, S & National, Monarch & Sovereign).
    - Copyable System Status Recap for sharing or journals.
  - **Today Dashboard Hunter Banner (`Today.tsx`)**:
    - Compact status card displaying Grade badge, Title, Level, CP, and STR/INT/SEN stats with a 1-click portal to the Journey Status Window.
- **Testing & Quality Assurance**:
  - **169 tests passing** across 28 test suites (`npm test`).
  - **0 TypeScript compilation errors** (`npm run typecheck`).
  - Production build verified with `electron-vite build`.

---

## 3. Adversarial Code Review & Security Hardening
1. **Chat ID Whitelist Security**: Disallowed any unknown Telegram sender from querying the user's ledger, balances, or executing commands.
2. **DPAPI Credential Encryption**: Primary and secondary bot tokens are encrypted at rest with Windows DPAPI via `safeStorage`.
3. **Surplus Vault Integrity**: Vault withdrawals cannot exceed accumulated surplus; ledger rows are append-only.
4. **Multiplier Math Safety**: All multipliers clamp to valid ranges and round cleanly to avoid fractional coin arithmetic anomalies.
5. **Zero Schema Bloat for RPG Stats**: Derived all 5 Hunter Attributes dynamically from existing transactional tables on read, ensuring instant reactivity to workouts, study, and sleep without migration risk.
6. **Backwards Compatibility**: Preserved all existing `summary.level` and IPC contracts while augmenting with the rich Solo Leveling Hunter engine.

---

## 4. Handoff Brief for Claude Code
Life System v1.1.0 delivers the full Solo Leveling Hunter Awakening Progression System alongside the Grand Unified Rewarding & Financial Ecosystem and Telegram Bot Command Center. The new Holographic Hunter Status Window in `Journey.tsx`, Hunter Dashboard Banner in `Today.tsx`, and `hunter.css` transform real-life habits into an epic RPG leveling journey with 30 described Hunter Ranks and dynamic CP stats. Your objective is visual polish, subtle particle animations, and UI refinements while preserving pure SQLite and domain logic.

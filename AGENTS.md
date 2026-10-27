# AGENTS.md — Agent System & Developer Guide

## 1. Project Overview & Architecture
Life System (`MEGA-SYSTEM`) is an offline-first, local-first gamified habit, task, workout, and life operations hub built on Electron 45, React 19, TypeScript, and SQLite (`better-sqlite3`). It unifies multiple self-improvement domains (Sleep/Waky, Discipline/MAN, Money/Finance Helper, Workouts/Body, Tasks, Schedule, Shop) into a single append-only points wallet with levels, ranks, chests, and rewards.

### Directory Structure
```
src/
  core/        Pure TypeScript business logic (zero Electron/DOM deps): ledger, levels, streaks, dates, body, shop, quests.
  main/        Electron main process: SQLite migrations (001-005), DPAPI secrets, backups, Telegram notifier, IPC handlers.
  preload/     Typed context bridge exposed safely to the renderer as window.life.
  shared/      Cross-boundary TypeScript types and LifeApi interface definitions.
  renderer/    React 19 + Framer Motion user interface.
apps/          Embedded sandboxed apps (Finance Helper, MAN) running in isolated partitions.
```

---

## 2. Recent Implementation Summary (Phases 5 & 6 — v0.7.0)
- **Phase 5 (Body Module)**:
  - Database Migration `005` with `exercises`, `workouts`, and `body_metrics` tables.
  - Multi-exercise workout session logger with custom reps/units, awarding `body.workout_done` (+10 coins, +25 XP) to the wallet.
  - Deleting a workout automatically undoes the ledger reward (`wallet.undo()`).
  - Weight & waist metric tracking with 12-week moving average smoothing for daily water weight swings.
  - Interactive UI with streak tracking, weekly volume, and workout history.
- **Phase 6 (Daily Rituals, Audio Polish, Telegram Bridge & Packaging)**:
  - **Daily Rituals Hub**: Dedicated high-performance daily ritual checklist on Today dashboard tracking the 5 core pillars: Morning Oath (+3), Clean Day (+20), Workout Session (+10), Skincare Routine (+5), and Spending Log (+3). Interactive 1-tap logging with real-time progress bar.
  - **Core Pillar Tiles**: Embedded Body & Training as 4th pillar tile in `AppTiles` alongside Waky, Finance Helper, and MAN.
  - **Audio System Expansion**: Added synthesized `soundFanfare` for level-ups/chests and `soundSuccess` for completed rituals and tasks.
  - **Weekly Recap Export**: One-click markdown summary copy to clipboard in `Journey.tsx`.
  - **Telegram Bridge**: Background `TelegramNotifier` supporting DPAPI token encryption, 08:00 morning kickoff briefings, and 20:30 evening recaps.
  - **Custom Backup Directory**: User-selectable backup folder via native dialog, removing the hard dependency on `G:\My Drive`.
  - **Desktop Visibility**: Windows desktop shortcut (`Life System.lnk`) and standalone launcher (`Launch Life System.cmd`) created on `C:\Users\victo\Desktop`.
- **Testing & Quality Assurance**:
  - 108 tests passing across 16 test suites (`npm test`).
  - 0 TypeScript compilation errors (`npm run typecheck`).
  - Production build verified with `electron-vite build` and `electron-builder`.

---

## 3. Adversarial Code Review & Bug Fixes
During the autonomous audit, the following edge cases and flaws were discovered and fixed:
1. **Unbounded Date Slicing in Workout Streaks**: Fixed `computeWorkoutStats` to guard against future-dated entries inflating streaks.
2. **Malformed JSON Resilience**: Wrapped workout `items_json` parsing in try/catch fallback handlers to protect against corrupted state.
3. **Encryption Availability Fallback**: Hardened `TelegramNotifier` and `SecretStore` to fallback safely when Windows DPAPI is restricted.
4. **Foreign Key Integrity**: Verified and enforced append-only rules for ledger interactions during workout rollbacks.
5. **Backups Method Signatures**: Implemented `setDir` and `runNow` on `Backups` class to ensure complete TypeScript typing parity with `src/main/index.ts`.
6. **Active Daily Rules Propagation**: Added `todayRules` array to `Summary` interface so the UI knows exactly which rules were completed today even after pagination.

---

## 4. Handoff Brief for Claude Code
Life System v0.7.0 has its complete backend, SQLite database migrations, typed IPC bridge, domain business logic, and functional React UI fully implemented and verified with 108 passing tests. The UI is cleanly structured using semantic containers, state hooks, and custom tokens ready for conversion into high-fidelity Tailwind utility classes and visual polish. Your objective is to refine the styling, micro-animations, and visual hierarchy of the views (especially `Body.tsx`, `Today.tsx`, and `Settings.tsx`) while preserving existing component contracts and IPC bridges.

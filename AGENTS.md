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

## 2. Recent Implementation Summary (Phases 5 through 12 — v1.3.0)
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
- **Phase 11 (Visual Motivation Engine, Real-Life Photos & Multi-Currency Engine — v1.2.0)**:
  - **Database Migration 008**: Added `image_url` and `currency` columns to both `rewards` and `wishlist_goals` tables.
  - **High-Res Photo Showcase**: Direct support for image/photo URLs on all rewards and dream goals, complete with card hero banners, live photo preview in modals, template quick-picks (Kaaba trip, MacBook, Spa, Shaver, Tech, Shoes), and Next Reward thumbnail on Today.
  - **Multi-Currency Engine (`convertCurrency` & `formatDualCurrency`)**: Seamless support for LEI (`MDL` / `RON`), `USD ($)`, and `EUR (€)` with instant 1-click currency switcher pills and live dual-currency equivalence display (e.g. `900 MDL (~$50 USD)`).
  - **Real-Life Effort & Grit Equivalence (`calculateEffortEquivalence`)**: Translates abstract coin costs directly into tangible human effort (`Afforded by: ~15 clean days or ~30 workouts`), creating an irresistible psychological motivator.
  - **Smart Coin Calculation Helper**: 1-click `⚡ Calc Coins` button in reward and goal editors that auto-derives coin targets from real-world prices.
- **Phase 12 (Dual AI Oracle & Multi-Model Intelligence Engine — v1.3.0)**:
  - **Pure AI Domain Engine (`src/core/ai.ts` & `src/core/ai.test.ts`)**:
    - Task-based auto-router (`selectModelForTask`) routing `reward_ideas` to ultra-fast models (`gemini-2.5-flash` or `deepseek-chat`) and `performance_report` to deep reasoning models (`deepseek-r1` or `gemini-1.5-pro`).
    - Structured prompt builders (`buildRewardPrompt`, `buildPerformancePrompt`) and resilient JSON markdown block extractors (`parseRewardResponse`, `parsePerformanceResponse`).
    - Popular model registry with official Google Gemini free tier (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`) and OpenRouter models (`deepseek/deepseek-chat`, `deepseek/deepseek-r1`, `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`, `meta-llama/llama-3.3-70b-instruct`).
  - **Backend AI Service (`src/main/aiService.ts` & `src/main/aiService.test.ts`)**:
    - Zero-dependency native `fetch` client for both official Google Gemini REST API and OpenRouter chat completions.
    - Encrypted at-rest key storage in `ai_config.bin` using Windows DPAPI (`safeStorage.encryptString`).
    - Connection tester, AI reward architect synthesizing rewards tailored to user level, coin balance, and savings, plus Solo Leveling tactical performance evaluator.
  - **IPC Bridge & Typing (`src/preload/index.ts`, `src/shared/api.ts`, `src/renderer/src/mock.ts`)**:
    - Full typed context bridge for `window.life.ai` (`config`, `saveConfig`, `test`, `generateRewards`, `performanceReport`, `askCoach`).
  - **UI Integration**:
    - **Settings AI Intelligence Panel (`Settings.tsx`)**: Masked key inputs with reveal toggles, model selector dropdown, active connection test buttons with visual status alerts.
    - **Shop AI Reward Architect (`Shop.tsx`)**: `✨ AI Rewards` button opening an interactive modal where the user can enter an optional prompt and generate 3 custom rewards with 1-click `+ Shop` (add to catalog) or `🎯 Goal` (pin as milestone).
    - **Journey Solo Leveling Strategic Evaluation (`Journey.tsx`)**: `✨ Generate AI Tactical Evaluation` button rendering a holographic System window featuring Grade Rating, Strategic Headline, Executive Summary, Core Strengths, Vulnerability Vectors, Actionable Directives, and a copyable report.
- **Testing & Quality Assurance**:
  - **188 tests passing** across 30 test suites (`npm test`).
  - **0 TypeScript compilation errors** (`npm run typecheck`).
  - Production build verified with `electron-vite build`.

---

## 3. Adversarial Code Review & Security Hardening
1. **Chat ID Whitelist Security**: Disallowed any unknown Telegram sender from querying the user's ledger, balances, or executing commands.
2. **DPAPI Credential Encryption**: Primary and secondary bot tokens, as well as Gemini and OpenRouter AI API keys, are encrypted at rest with Windows DPAPI via `safeStorage`.
3. **Zero-Dependency Native AI Calling**: Both Gemini and OpenRouter utilize native Node/Electron `fetch`, avoiding third-party dependency bloat and vendor lock-in.
4. **Resilient JSON Response Extraction**: AI response parsers handle standard JSON as well as markdown fences (````json ... ````), with fallback heuristic parsers to protect against malformed LLM outputs.
5. **Surplus Vault Integrity**: Vault withdrawals cannot exceed accumulated surplus; ledger rows are append-only.
6. **Multiplier Math Safety**: All multipliers clamp to valid ranges and round cleanly to avoid fractional coin arithmetic anomalies.
7. **Zero Schema Bloat for RPG Stats**: Derived all 5 Hunter Attributes dynamically from existing transactional tables on read, ensuring instant reactivity to workouts, study, and sleep without migration risk.
8. **Robust Image Handling**: Image tags implement silent fallback (`onError`) to prevent broken image icons when offline or when using invalid URLs.
9. **Backwards Compatibility**: Preserved all existing `shop.state()` and IPC contracts while augmenting with `ai:*` handlers.

---

## 4. Handoff Brief for Claude Code
Life System v1.3.0 is a complete, production-ready desktop habit and motivation ecosystem integrating multi-model AI (official free Google Gemini + OpenRouter DeepSeek V3/R1) with the Solo Leveling Hunter Awakening progression and the Unified Rewarding & Financial Engine. The AI Reward Architect in `Shop.tsx` synthesizes realistic dream rewards with HD photos and real-life currency conversions, while `Journey.tsx` compiles executive holographic performance reports, backed by 188 passing tests and encrypted key storage. Your objective is aesthetic refinement, particle effects for AI summoning, and visual design polishing while maintaining zero regressions across the pure domain and SQLite layers.

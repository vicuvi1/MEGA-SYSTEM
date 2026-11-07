# Overview: who it is for, repos, rules

> The owner, the repos, and the project rules.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

## 1. Who I am and what I want


- I'm Victor, a university student (time zone Europe/Chisinau, money in MDL/lei). I'm building one personal system that runs my life: study, a cyber security career (CTFs, Rust, crypto), training, sleep, discipline, money.
- I mainly use the **web app on a laptop** (desktop-first; it must also work on a phone) and **Telegram**.
- The heart of it is **Ben**, my AI coach. Ben talks like a close friend who knows me very well. He is tough love: he gets angry (😤 😠 😡) when I slip, hyped (😎) when I win, and holds me to my promises. He answers what I asked first (1–3 sentences), says a hard thing once and doesn't repeat it, takes a no, and replies in the language I wrote in (English unless I write Romanian or Russian; a fixed language can be picked in Coach → About you).
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

## 7. Rules for you


- Small, focused commits; plain-English messages; one feature at a time.
- Don't redo or undo recent work without a reason; read `git log` first.
- Never put secrets, ids or my real personal data in code, tests, docs or commit messages.
- Points must be honest: a habit pays only for something actually done when it is logged.
- When something is wrong, say so plainly; when it works, show proof (test output, screenshot).
- Ask me questions when a decision is mine to make.

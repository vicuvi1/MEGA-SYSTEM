# Architecture

> Stack, data (Turso + sql.js mirror), the 12 Vercel functions, the bot bundle, pure logic in src/core.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

## 4. Architecture

- **Stack:** TypeScript, React 19, Vite. The web app is plain browser code and **the product**. The Windows desktop app is an Electron shell around the same build (`src/desktop`: `main.ts`, the floating island `island.ts`, `preload.ts`; built with `electron.desktop.config.mts`; the page is served locally from `out/renderer`, a copy of `dist`). `src/main` holds the services the web app runs.

- **Data:** the browser keeps a **sql.js copy (mirror) of the Turso database** (`src/renderer/src/web/mirror.ts`), refreshed live (only changed tables: `tableVersions.ts`), with an offline queue. The services (`src/main/*.ts`: wallet, focus, sleep, discipline, body, shop, weekPlan, progress…) run on that copy via `webServices.ts`. `src/renderer/src/tursoWebBridge.ts` is the web bridge (`life.*`), live.

- **Server = Vercel functions in `api/*.mjs`**: 11 of the 12 the Hobby plan allows (`functionCount.test.ts` fails at 13). Files starting with `_` are helpers, not functions. Extra jobs live inside existing functions.
  - `api/login.mjs`: PIN login, `renew` (sliding session), `signOutAll`, passkeys (`_passkey.mjs`), devices (`_devices.mjs`), `changePin`.
  - `api/db.mjs`: guarded Turso proxy (`_sqlguard.mjs`), the app's daily backup (`{snapshot}`, `_snapshots.mjs`), the database-version check (`_schema.mjs`).
  - `api/coach.mjs`: the app's coach chat (NDJSON stream), `{op:'rhythm'|'undo'}`.
  - `api/telegram.mjs`: Telegram webhook (Ben and the other bots).
  - `api/cron.mjs`: `job=tick` (Ben writes first, and the daily messages by local time), daily jobs `morning|reask|midday|evening|night`, `job=backup`, `job=sport`, `job=health` (phone numbers), `job=plugins`.
  - `api/ai.mjs`: `askModel()`: OpenRouter (pinned DeepSeek flash for quick replies, pinned strong model for plans/reviews, falling back to flash), Gemini as backup and for media; usage and the monthly budget (`_budget.mjs`).
  - `api/google.mjs`, `api/todoist.mjs`, `api/config.mjs` (bot settings without tokens, push subscribe), `api/bot-setup.mjs` (bot health, also `/api/bot-health`), `api/mcp.mjs` (Life System for AI apps over MCP: personal tokens in `sys_mcp_tokens`, OAuth for claude.ai/ChatGPT in `_mcpauth.mjs`; tools in `src/server/mcp.ts`; local bridge `scripts/life-mcp.mjs`).

- **Bot bundle:** server logic is in `src/server/telegramBot.ts`, built into `api/_bot/bot.mjs` with `npm run build:bot` (committed; CI fails if it is stale; Vercel rebuilds it too).

- **Pure logic in `src/core/*.ts`**, tests next to it (`*.test.ts`, vitest). Keep logic pure and tested; UI files only render.

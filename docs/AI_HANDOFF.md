# Life System + Ben: handoff prompt for any AI

Last checked: 2026-11-05. Copy everything below the line into a new AI chat (Claude, ChatGPT, Codex, Gemini…) to continue the work.

---

You are joining an ongoing project as a senior full-stack engineer. Read all of this before you change anything. Ask me before anything destructive (deleting data, force-pushing, rewriting history, rotating keys). The short version of these rules is in `AGENTS.md` at the repo root.

## 1. Who I am and what I want

- I'm Victor, a university student (time zone Europe/Chisinau, money in MDL/lei). I'm building one personal system that runs my life: study, a cyber security career (CTFs, Rust, crypto), training, sleep, discipline, money.
- I mainly use the **web app on a laptop** (desktop-first; it must also work on a phone) and **Telegram**.
- The heart of it is **Ben**, my AI coach. Ben talks like a close friend who knows me very well. He is tough love: he gets angry (😤 😠 😡) when I slip, hyped (😎) when I win, and holds me to my promises. Short replies, numbers first, one push. Always English.
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

## 3. Secrets: names only (values are NOT here on purpose)

Server secrets are **Vercel environment variables** (Vercel → mega-system → Settings → Environment Variables). GitHub Actions secrets are under the repo's Settings → Secrets and variables → Actions. Never write a value into the repo, a log or a chat summary.

| Variable | Where | What it is |
|---|---|---|
| `TURSO_URL` / `TURSO_DATABASE_URL`, `TURSO_TOKEN` / `TURSO_AUTH_TOKEN` | Vercel | Turso database URL and token |
| `SESSION_SECRET` | Vercel | signs app sessions (falls back to a hash of the Turso token) |
| `TELEGRAM_CHAT_ID` | Vercel | my Telegram chat id (only this chat is obeyed) |
| `MEGA_BOT_TOKEN` | Vercel | **Ben's bot** |
| `TELEGRAM_BOT_TOKEN`, `SPORT_BOT_TOKEN`, `FINANCE_BOT_TOKEN`, `MAN_BOT_TOKEN`, `WAKY_BOT_TOKEN` | Vercel | older/specialist bots; `BOTS_NOT_ON_SERVER` lists bots the server should not run |
| `OPENROUTER_API_KEY` | Vercel | main AI. `OPENROUTER_MODEL` / `OPENROUTER_STRONG_MODEL` override the pinned models |
| `GEMINI_API_KEY` | Vercel | backup AI, voice notes and photos |
| `TODOIST_TOKEN` | Vercel | Todoist |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Vercel | Google Calendar/Gmail OAuth (the refresh token is stored in the database) |
| `CRON_SECRET` | Vercel **and** GitHub | signs the timers: Vercel crons, the GitHub tick, the backup workflow |
| `BACKUP_PASSPHRASE` | GitHub | encrypts the weekly off-site backup (keep a copy in your password manager: without it the backup can't be opened) |
| `SPORT_SYNC_KEY` | Vercel | lets Sporty read/write water and workouts (`/api/cron?job=sport`) |
| `LIFE_TZ` | Vercel | time zone (Europe/Chisinau) |
| `APP_URL` | Vercel | public app URL for links in messages |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel | phone push notifications (`scripts/vapid-keys.mjs` makes a pair) |
| `GITHUB_TOKEN`, `NOTION_TOKEN` | Vercel | optional, read-only: the GitHub and notes plugins |
| `AZURE_SIGN_*`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | GitHub | optional: signed Windows installers (`docs/code-signing.md`) |

Bot tokens come from @BotFather. If a token was ever pasted in a chat or screenshot, revoke it there and replace it in Vercel.

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

### Ben's brain (most important files)

| File | What |
|---|---|
| `src/renderer/src/web/botBrain.ts` | persona and prompt, `lifeContext()`, actions (`readAction`), memory, profile, coach log, letters |
| `src/renderer/src/web/webBots.ts` | `think()` (context → model → actions → reply), Telegram handling, buttons, commands, undo (shared by browser and server) |
| `src/renderer/src/web/rhythmBot.ts` | daily rhythm: morning plan, evening review, Sunday review, weekly letter, goal booking |
| `src/renderer/src/web/benDesk.ts` + `BenDesk.tsx` | Ben's desk (`ben_desk`): patterns, energy map, excuses, mood, study topics, stakes, the Sunday call, the month's story |
| `src/renderer/src/CoachFeed.tsx` | the chat feed: cards for Ben's automatic messages, folded updates, the "Now" card |
| `src/core/coachKit.ts`, `coachMind.ts`, `rhythm.ts`, `goalPlan.ts`, `coachImpact.ts`, `coachButtons.ts`, `coachNext.ts` | references and promises, long-term memory, rhythm timing, goal plans, scorecard, buttons, "Do this now" |
| `src/core/benMemory.ts`, `web/memoryStore.ts`, `src/server/memoryVectors.ts`, `memoryJobs.ts` | Ben's memory: his four notes about you (`coach_blocks`: About you, Goals now, How to coach you, People; 600 characters each, always in his prompt; actions `blockadd`/`blockfix`/`blockset`; pinned ones are read only), the change log with undo (`coach_memory_changes`), recall by meaning (Gemini `gemini-embedding-001` embeddings, 768 numbers, in the server-only `sys_mem_vec` table with Turso's vector index; keyword recall when that fails; lookup `recall <what>`), and the nightly tidy-up (03:00–05:00, one small call, ADD/UPDATE/DELETE/NOOP, never touches pinned facts). Shown in Settings → Ben → Ben's notes about you. |

### Pages and features

Today, Calendar, Tasks (Todoist), Goals, Focus, Progress, Reviews (month/year), Coach, Sleep (Waky embedded), **Discipline** (one built-in page; MAN is no longer embedded), Money (Finance Helper embedded), Body (Sport Track embedded), Rewards, **Notebook** (`pages/Notebook.tsx`, synced `notes` table; Ben can write notes too), Settings. Embedded apps live in `src/renderer/public/apps/` and talk to the host by `postMessage` (`LIFE_SYSTEM_BRIDGE`).

### Voice (`src/renderer/src/voice/`, `src/core/voice*.ts`)

Off until switched on in Settings → Voice (saved per device in localStorage `ls.voice`). Everything is free and runs on the device; nothing is in the installer or precached: each part downloads on first use into the browser cache (`life-voice-v1`, `life-voice-models`) and Settings → Voice can delete it.
- **Desktop island** (`IslandVoice.tsx`, engine `voiceEngine.ts`, flow `core/voiceFlow.ts`): "Hey Ben" (sherpa-onnx keyword spotter, WebAssembly, in `voiceEarWorker.ts`; the npm build is patched for workers in `vite.web.mts`, checked by `voice/build.test.ts`; the .wasm starts at 32 MB instead of 512 MB, `shrinkWasmMemory`), the Talk to Ben shortcut and 🎤 are push-to-talk; Silero VAD ends what you said; Moonshine/Whisper (Transformers.js in `voiceAiWorker.ts`, ONNX Runtime's plain wasm) turns it into text; `core/voiceCommands.ts` runs commands through the island's command-bar rules, the rest goes to Ben via `voiceAsk.ts` (BroadcastChannel to the app window → `life.coach.chat`). Ben answers sentence by sentence (system voices, or Kokoro). You can talk over him (barge-in); 8 s follow-up without the wake word. The mic closes entirely when voice is off, the PC is locked/idle (`src/desktop/voice.ts`), or the island is quiet, hidden, in a call or locked. The big-model worker ends after 2 minutes unused. If the wake-word model can't be downloaded, short sounds are checked by speech to text instead (at most 6 a minute).
- **Island: moving, hiding and your own kit (H1, IN34–IN48, IN-SC).** Moving and hiding: pure logic in `core/islandMove.ts` (snap only in a screen's top zone, otherwise it stays where dropped; the pill stays on screen, the window may hang off; the panel slides to fit near an edge; a spot and panel size per screen; hide for 1 h / until tomorrow / until brought back, or tuck into a dot; out of the way when the mouse rushes at it). The window side is in `src/desktop/island.ts` (drag at ~120 Hz with a fixed size, move mode, `Alt+Shift+I` hide shortcut), the tray items in `islandMenu.ts`, the page side in `IslandMoveBits.tsx` / `island-move.css`. Your own tiles, one-tap buttons, profiles (app / Wi-Fi / time), colour sets, a shortcut per tile and SoundCloud stations live in one synced setting `island_kit` (`core/islandTiles.ts`, `core/islandKitExtras.ts`, `core/soundcloud.ts`; read by the app window in `islandKitFeed.ts`, shown by `IslandTiles.tsx`, `IslandExtras.tsx`, `IslandMusic.tsx`). Buttons log through the normal reps / water paths and can be undone. The desktop part (`src/desktop/islandKit.ts`, one `islandKit` IPC channel): tile shortcuts with clash checks, the mini dock window (`/?island=1&dock=1`, `IslandDock.tsx`), the clipboard tray (off by default, memory only, never inside apps on the eyes' private list), the file shelf (paths only, `island-kit.json`). A recipe can show the move-break card (`moveCard`, event `life-island-move-card` in `core/islandMoveCard.ts`; you still confirm). SoundCloud plays through the official embed widget (CSP allows only `w.soundcloud.com` for frames and its `api.js`).
- **Music (MU).** One SoundCloud player per PC: `src/renderer/src/music/engine.ts` (the Widget API, queue, shuffle / repeat, sleep timer with a fade, recently played in localStorage `ls.musicRecent`). On the desktop it lives in the island window (`ScHost` in `IslandMusic.tsx`); the app window's Music page (`pages/Music.tsx`) drives it over the BroadcastChannel `life-music` (`music/remote.ts`); on the website, or with no island answering, it lives in the page (`musicHost.tsx`, mounted in App). The island's Music tab is `IslandMusicTab.tsx` (header ♫, the `music` tile kind, the media row); the pill shows the artwork in a progress ring, an equalizer and (optional) the lyric line; the peek has a mini player. Synced lyrics come from LRCLIB and covers for PC players from the iTunes search (`core/lyrics.ts`); the real waveform from `wave.sndcdn.com`; the colour from a 24×24 canvas sample of the artwork (accent if blocked). Several players: SoundCloud plus every Windows media session (`mediaList` in `core/pcMedia.ts`, pcx op `mediaList`, asked every 3 s only while a Music view is open), with a pin. Synced options in `island_kit.music` (`core/music.ts`: stations, favourites, focus mix, lyrics, lyric on the pill, equalizer mode, pin, "Ben can see what's playing", off by default, which writes `music_now` for `lifeContext()`). The media keys are registered only while the player is loaded (`islandKit` op `mediaKeys`). The equalizer and the "breathing" artwork are drawn, not measured: the audio plays in SoundCloud's cross-origin frame. CSP `connect-src` allows `wave.sndcdn.com`, `lrclib.net`, `itunes.apple.com`. **Starter stations and vibes:** `core/starterStations.ts` lists 8 public SoundCloud label/curator profiles (Lofi beats, Deep focus, Chill electronic, Jazz cafe, Ambient drift, Upbeat workout, Classical study, Evening soul) shown as "Pick a vibe" cards (`music/VibeGrid.tsx`, generated gradient covers) with "Play something for now" (time of day, focus, workout); hidden ones sync in `island_kit.music.hiddenStarters`; one SoundCloud won't play here (error, or no track shown) is marked unavailable on this device (`music/stationHealth.ts`, `ls.musicUnavail`, retried after a week). While it plays the island's panel glows and the pill's equalizer pulses with a simulated beat (`music/IslandMusicFx.tsx`; SoundCloud's audio can't be analysed), and a small "now playing" card shows on the pill when the track changes (`music.nowToast`).
- **Web / phone** (`CoachMic.tsx`): 🎙 push-to-talk on the Coach page (the browser's speech recognition; else on-device speech to text on a strong device with Voice on) and 🔊 read-aloud. No wake word.
- **Licences:** sherpa-onnx, Zipformer KWS, Transformers.js, Kokoro: Apache-2.0; Silero VAD, Moonshine, Whisper, ONNX Runtime: MIT. Kokoro's phonemizer (eSpeak NG) is **GPL-3.0**: never bundled; the worker imports it from jsdelivr at run time (pinned URL, allowed in the CSP's `script-src`). The CSP's `connect-src` allows `huggingface.co`, `*.hf.co`, `cdn.jsdelivr.net` for the downloads.

### Island pages (PL6) and the page API

The opened island has pages (Day, Music, Home, PC, Fun…) with dots on top: swipe or drag sideways, scroll sideways (or Shift + wheel; a plain wheel over the dots), Ctrl+← / Ctrl+→ or `[` `]`. Only the page you see is mounted, so nothing on the others runs or animates. Pages can open by the time of day or the island profile (synced setting, see Widgets). Pure logic: `src/core/widgets/pages.ts`; the pager and the API: `src/renderer/src/widgets/islandPages.tsx`.

To add a page (another builder, e.g. the Music tab), call once at import time:

```tsx
import { registerIslandPage } from './widgets/islandPages'
registerIslandPage({ id: 'music', title: 'Music', icon: '🎵', render: (ctx) => <MyMusicPage snap={ctx.snap} tap={ctx.tap} /> })
```

`id` is lower-case letters, digits or `-`; registering the same id again replaces the page (the built-in `music` page is a placeholder for exactly that). `ctx` = `{ snap, tap, now, day }` (`snap`: the island snapshot; `tap(action)`: send an island action; `day`: the Day page's own content). Optional `order` places a new page before you reorder (Day 0, Music 10, others 50). It returns a function that removes the page.

**System and AI usage pages (desktop only, `src/renderer/src/sysmon/`).** System: CPU per core (os.cpus deltas), GPU, memory, network with a small line, the 5 busiest apps (Close → `pcClose` action → the usual Allow / Deny card, then `taskkill` without /F; never Windows parts or this app: `SYSTEM_PROCS` in `core/sysmon.ts`), drives, temperatures and power only when Windows or LibreHardwareMonitor reports them, battery. The desktop (`src/desktop/sysmon/`, IPC `sysmon`) runs one PowerShell loop only while the page asks (stops after 5 s without a question). AI usage (off by default): Claude Code (`~/.claude/projects/**/*.jsonl`) and Codex (`~/.codex/sessions`) read locally, numbers only, 5-hour blocks like ccusage (`core/aiUsage.ts`, prices in `core/usagePrices.ts`), and Ben's month vs budget from `/api/ai {op:'usage'}`. Optional rings and CPU/RAM on the pill, 70 % / 90 % notices once per window. Settings → Desktop island → System and AI usage (file `sysmon.json` on that PC).

### Widgets, script tiles and the island look (PL1–PL11, LF1–LF2)

- **Widgets** (`widgets/` in the repo, `src/core/widgets/`, `src/renderer/src/widgets/`): one `widget.js` + `manifest.json` (+ `screenshot.png`) per widget, compiled into the app (Vite glob; nothing downloaded at run time). Each runs in an iframe `sandbox="allow-scripts"` only (opaque origin) loading `/widgets/frame.html` (`src/renderer/public/widgets/`: its own CSP, `connect-src 'none'`), gets its code over `postMessage` only after the island checked its sha256 against the hash pinned at install (`registry.ts loadCode`), and talks over a private MessagePort (`bridge.ts`: typed messages, `checkCall` on every call: permission, host allowlist, rate). Permissions (asked once at install, revocable in Settings → Widgets): `read` (the read-only data contract `widgetData`, built from the island snapshot: plan, focus, points, weather, next event, counts; never Ben's messages or task texts), `network` (listed https hosts, made by the desktop main process `src/desktop/widgetNet.ts` after the app window checks again), `add` (task / note, the island asks each time, `ConfirmCard`), `sound`. `vercel.json` has its own header block for `/widgets/*` (framable by the app only); Electron's permission handler gives `/widgets/` nothing. Gallery: `widgets/gallery.json`; after changing a widget run `node scripts/widget-hashes.mjs --write` (a test checks hashes, manifests and screenshots). How to submit one: `widgets/README.md`. `.gitattributes` keeps `widgets/**` LF so hashes match on Windows.
- **Speed budget (PL11)**: `budget.ts`. The island pings each widget every 3 s; late or missing answers and long tasks add strikes; 3 in a minute (or one freeze over 2.5 s) stop the widget and show "slowed down" with Try again. Data goes at the manifest's refresh rate (≥ 15 s), never while hidden; only the visible page is mounted.
- **Script tiles (PL5)**: `scripts.ts`, `scriptRun.ts`, `scriptRunner.ts`. Short JS ("show X when Y") run in a fresh blob Web Worker each time, locked down before the code runs (no fetch/XHR/WebSocket/BroadcastChannel/storage/workers; big buffers, arrays and strings capped), ended after 250 ms (+5 s while the host does a fetch). API: `life.now/hour/minute/weekday/today`, `show(text, icon)`, `notify(text)` (an island peek, at most every 10 min), `addTask(text)` (you confirm), `await fetch(url)` (only hosts you listed). Three timeouts in a minute pause it. Tested with real Node workers.
- **Synced setting `island_widgets`** (`settings.ts`): installed widgets (hash, grants, page, config), pages, scripts, the island look, and the synced layout (PL8: pill order and island look follow you to every PC by a three-way merge in `widgetsFeed.ts syncLayout`; screen positions stay per PC). The app window puts it in the snapshot (`snap.widgets`) and answers `{kind:'widget'}` island actions (`widgetAct`, checked again).
- **Rain and daylight on the pill (LF1/LF2)**: `weatherPill.ts`. From the weather plugin's saved data: pill items "Rain at 17:00" and "Sunset 16:40 · 2 h of light left" (pill items `rain`, `sun`), a peek 30 min before rain, and one daylight nudge on short days.
- **The island look** (`islandLook.tsx/.css`, Settings → Widgets → Island look): shapes Notch (flush with the top edge, round bottom corners; the default for new users, existing set-ups keep the Capsule), Capsule (the floating pill) and Thin bar (also by itself while a window is maximized on the island's screen: the desktop watcher reports `max=`), Open on hover, a pill clock (Simple, Seven-segment, Serif, your colour; redraws once a minute) and eight themes (Dark, Light, One Dark Pro, GitHub Dark, GitHub Light, Dracula, Night Owl, Cyberpunk). The page carousel slides the old page out and the new one in (260 ms, transform/opacity).
- Thanks: the island's look (notch / capsule / bar, the page carousel, the clock styles and themes) is inspired by [BrimDeck](https://github.com/MoFeng2223/BrimDeck) by MoFeng2223 (Apache-2.0). No code was copied.

### Plugins (`src/plugins/`)

Small add-ons, each off until switched on in Settings → Plugins (`plugins_on`). A plugin can add a line to `lifeContext()`, actions, Telegram commands, a file reader, server jobs (morning/tick/evening via `src/plugins/run.ts`) and read-only `mcpTools`. Settings keys: `plugin_<id>`, `plugin_<id>_data`, `plugins_status`. Now: weather, github, gmail, bank (CSV import), health (phone numbers by Shortcut, keys hashed in `sys_health_keys`), notes (Obsidian in the desktop app, Notion optional).

### PC & automation

Settings → PC & automation (all off by default, all free): pause music during focus and what's playing on the island, ActivityWatch / the last hour for Ben (`pc_last_hour`), Ben's PC actions with Allow/Deny on the island (`pc_asks`), phone push by ntfy, n8n webhooks out and `/api/hook` in, Ben's outside MCP tools. Server parts keep their settings in `sys_kv` (`auto:*`). Details: `docs/pc-automation.md`.

### Island nudges (Island 2)

The desktop island's body and day nudges: move breaks with an exercise picker and −/+ count (undo and "I did fewer" reverse Sport Track, the workout and the points), the 20-20-20 eye break and a tidy minute as real countdowns on the pill, posture, a breathing minute, mood faces (saved with Ben's mood check-ins), one good thing a day (Notebook → Good things), a focus check-in halfway through a timer, people to call, "Moved?" after time away, a snooze menu, gentle escalation, learning (a nudge you keep skipping moves to another hour or becomes a dot), a movement ring, Ben's daily challenge and a move streak. Logic: `src/core/islandNudges.ts`; the app window: `src/renderer/src/islandNudgesFeed.ts`; the cards: `IslandNudgeCard.tsx`; settings in Settings → Desktop island → Nudges (synced setting `island_nudges`). Points: `body.move_break` (+3, 5 a day), `body.eye_break` (+1, 3 a day), `body.challenge_done` (once a day), each paid only on a confirmed log and undone with it.

### Database

- Tables: see `src/core/schema.ts` (**append-only**: never edit a shipped migration, add a new one and bump `SCHEMA_VERSION` in `api/_schema.mjs`; a test checks they match). Pages built for an older schema may read but `/api/db` refuses their writes ("A new version is out — please reload"). A migration that MOVES data must run once on the server, never in each browser.
- Server-only tables (`/api/db` refuses them): `sys_auth` (PIN hash, sign-out counter), `sys_login_guard`, `sys_passkeys`, `sys_passkey_chal`, `sys_devices`, `sys_gate` (once-only job slots), `sys_push`, `sys_kv`, `sys_mcp_tokens`, `sys_mem_vec` (Ben's memory embeddings; can always be rebuilt). `cloud_snapshots` is **read-only** from pages.
- Other `sys_*` tables (never copied to devices): `sys_health` (beats and notes), `sys_error_log`, `sys_ben_log`, `sys_table_versions`, `sys_writes`, `sys_cas`.
- `settings` keys (key → JSON), the main ones: `coach_memory`, `coach_blocks`, `coach_memory_changes`, `coach_profile`, `coach_log`, `coach_mind`, `coach_reminders`, `coach_nudges`, `coach_rhythm`, `coach_rhythm_prefs`, `coach_history`, `coach_letters`, `ben_desk`, `goal_booking`, `sport_tracker_json` (the one shared water + reps log; its day turns at 04:00), `ben_workouts`, `app_sync_finance`, `week_plan`, `focus_running`, `block_marks`, `cal_templates`, `today_order`, `notif_settings`, `ai_models` (your model picks), `ai_budget`, `plugins_on`, `plugin_*`, `pin_hash` (offline copy, written by the server only), `data_version`. The full list, with types and defaults, is `src/core/settingsKeys.ts` (a test fails when code uses a key that is not in it).

### Sign-in and security

- The PIN is checked only by the server (`sys_auth`) and changed through `/api/login {changePin}`. Wrong PINs are limited per device and overall.
- Sessions last **14 days** and are renewed while the app is in use (`session.ts renewSession`). A database hiccup is a 503, never a sign-out.
- Passkeys (fingerprint/face) and a device list with "sign this device out" (Settings → General).
- `vercel.json` sends a Content-Security-Policy: strict for the app (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), and a looser one for `/apps/*` (their big inline scripts). The embedded apps run in same-origin iframes WITHOUT `sandbox`: the host injects their theme and data into them, and they keep their own localStorage, which a sandbox (opaque origin) would break. The trade-off: code running inside an embedded app could read the session; keep those apps free of third-party scripts.
- The bots obey only `TELEGRAM_CHAT_ID`.

### Timers (Ben writes first)

- `.github/workflows/tick.yml` calls `/api/cron?job=tick` every 10 minutes (with `CRON_SECRET` and `X-Life-Timer: github`); the open app also calls it every 2 minutes. Twice a month its keepalive job re-enables the scheduled workflows through the GitHub API (GitHub switches them off after 60 days without commits in a public repo).
- The tick sends the daily messages (`morning` 08:30, `reask` 10:00, `midday` 13:00, `evening` 21:30, local time: `src/core/dailyClock.ts`) and the bedtime wind-down; the Vercel crons in `vercel.json` (UTC) are the backup. Both claim the same once-a-day slot (`sys_gate` `daily:<job>`), so nothing goes twice.
- Settings → System health shows "Ben's server" (any tick) and "Ben's timer" (the outside timer only), red after 30 minutes. Optional second pinger: a free cron-job.org or UptimeRobot monitor calling `https://mega-system-ten.vercel.app/api/cron?job=tick` every 10 minutes with the header `Authorization: Bearer <CRON_SECRET>` (and `X-Life-Timer: pinger`).
- **Two alarms (CL4).** The 30-minute warnings run in the tick; the daily Vercel crons (`runDaily` in `api/cron.mjs`) run the same checks (`healthAlarm`), so a dead tick is still reported. The tick answers `health: false` (and `broken: [...]`) when something has been broken 30+ minutes; the GitHub tick workflow then fails, and GitHub emails you. `backup.yml` re-enables `tick.yml` too (each workflow keeps the other on).
- **Optional outside watch: an UptimeRobot keyword monitor.** Monitor type "Keyword", URL `https://mega-system-ten.vercel.app/api/bot-health`, custom header `Authorization: Bearer <CRON_SECRET>`, keyword `"ok":false` with "alert when the keyword EXISTS", every 30 minutes. It emails you when a bot's token is refused or Telegram can't be reached, even if Ben's server is the part that broke.
- **Daily self-check (CL3).** Once a day (`sys_gate` slot `selfcheck`, from the tick or a daily cron) the server checks each bot's Telegram link (right address, no delivery error in 24 h, under 50 waiting; a wrong link is set again), Google's sign-in, the Todoist key, a 1-token AI ping and the month's AI budget (warning at 80 %), a timed database read, today's backup (warning above 3 MB, the limit is 4.5 MB), the restore drill (within 8 days) and the tick/timer beats. Results: `sys_health` `note:selfcheck`, shown in Settings → System health; problems go to Telegram once (the same "warned" list as the 30-minute alerts). Logic: `src/core/selfCheck.ts`, `src/server/selfCheck.ts`.
- **Server calls (CL2).** Every `/api` function counts its calls (and `/api/db` the rows it returns) in memory and adds them to `sys_health` `note:calls:YYYY-MM` every 25 calls or 2 minutes; System health shows the month and the rate per hour. An idle open tab asks about 70 times an hour (data every 90 s, the tick and outside apps every 10 minutes; nothing while hidden).
- **Desktop at night (CL5, CL8, CL9).** A downloaded update installs at 04:00 when nobody has used the PC for 30 minutes and no focus timer runs (or at once when the website says this version is too old to save); a ready update keeps looking for newer ones. A window frozen 30 s is restarted; a dead island window is made again; at 04:00 windows over 300 MB reload. The website reloads a hidden tab at 04:00 after 3 days, or when it holds over 250 MB.
- **Soak test (CL12).** `npm run soak` (`e2e/soak.mjs`, needs `npm run build:web`) runs the real app on the fake server with a fake clock across nights: memory, listeners, calls per idle hour, offline and a server outage, a database version bump, the day turning at 04:00. `-- --short` for a quick run, `--months=24` to seed two years of history. The server side: `src/server/castle.test.ts` runs 144 ticks.

### Backups

- The server makes the daily `cloud_snapshots` row (gzipped, `gz:` + base64; 30 kept) and once a week test-restores the newest into a throwaway database (`restoreDrill.ts`). The app may add today's through `/api/db {snapshot}` but can never change or delete one. The desktop app also writes daily files to the PC and Google Drive.
- **Off-site:** `.github/workflows/backup.yml` runs every Monday: it downloads the newest backup (`/api/cron?job=backup`, `CRON_SECRET`), encrypts it with `BACKUP_PASSPHRASE` and keeps it 90 days as a workflow artifact (public repo: artifacts are downloadable by any signed-in GitHub user, which is why they are encrypted).
- **Restore an off-site copy:** download the artifact (Actions → Off-site backup → a run → Artifacts), unzip it, then
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in life-backup-YYYY-MM-DD.json.gz.enc -pass pass:'<passphrase>' | gunzip > backup.json`
  and load `backup.json` in Settings → Backups & data → "Restore from Backup File".

### Cost watch

- Each cold server start downloads the whole database into memory; the rows it read are counted per month (`sys_health` `note:coldreads:YYYY-MM`) and shown in System health (warns near Turso's free monthly reads). A `/tmp` cache was not added: on Vercel each function has its own instances and a warm instance already keeps its copy in memory.
- `ai_usage`: calls older than 90 days are rolled up into one row per month, model and kind (`calls` column) once a day; `bot_seen_updates` keeps 14 days (pruned by the server and the app). The ledger and focus history are kept whole: they are the honest record of points; they are small (one row per action).

## 5. How to work

```bash
npm ci                              # Node 22 (.nvmrc, engines)
npx tsc --noEmit -p tsconfig.json   # typecheck
npx vitest run                      # all tests must pass (~900)
npm run build:web                   # web app
npm run build:bot                   # server bundle api/_bot/bot.mjs (commit it!)
npm run smoke                       # the real app on fake data (e2e/smoke.mjs + e2e/server.mjs)
bash scripts/ship.sh <message-file> # typecheck, tests, bundle, commit, push
```

- Only push to `main` when typecheck and **all** tests pass. A push deploys straight to production.
- After pushing, check the Vercel deployment is READY, then `/api/cron?job=tick` should return `{"ok":true,…}`.
- Commit with the owner's git identity as configured on the machine (never write a personal email into the repo). Before pushing: `git fetch origin main && git rebase origin/main`. Never force-push.
- Local testing: a fake Turso is in `src/renderer/src/web/fakeTurso.ts`; the bot bundle exports `coachChat`, `runTick`, `handleTelegramUpdate`, `coachRhythm`, `coachUndo`, `sportShared` for end-to-end tests with a fake model.
- Check UI changes at desktop width (1280–1440 px) first, then phone (390 px).

### Motion & sound budget

The app should feel alive but stay light on the PC and the battery.
`src/renderer/src/motionBudget.test.ts` reads every stylesheet and enforces the CSS rules.

- **Animate only `transform` and `opacity`.** No keyframes on width, height, margins, `box-shadow`, `filter`, `background(-position)`. A glow, ring or flash is drawn once (a shadow or tint on `::after`) and only its opacity or scale moves (`fx-breathe`, `fx-flash`, `fx-ping` in `motion.css`). Exceptions sit in the test's `EXCEPTIONS` list with a reason (today: SVG `stroke-dashoffset` for the drawn tick and chart lines).
- **Progress bars move by transform:** `.pbar` + `barFill(fraction)` (`motionKit.tsx`): a full-width pill slid by `translateX` inside a clipped track. Never transition `width`.
- **No `transition: all`**: name the properties. No transitions on layout properties. No `will-change` on width/height.
- **UI motion takes 400 ms or less** (presses, toasts, page switch, bursts, count-ups). Looping effects are for "something is live right now" only.
- **Nothing animates while hidden:** `html.doc-hidden` pauses every CSS animation; JS motion uses `requestAnimationFrame` (stops by itself in a hidden window), never a fast `setInterval`. The desktop app window is throttled in the tray (`backgroundThrottling: true`); the desktop sends `island:tick` every 15 s so the island stays fresh.
- **Reduce motion:** one `@media (prefers-reduced-motion: reduce)` block in `motion.css`, plus `<MotionConfig reducedMotion="user">`. JS effects check `reducedMotion()`.
- **Framer:** the app uses `m.` components under `<LazyMotion strict>` (`MotionRoot`); its animation code loads after the first paint. No `motion.` components, no `layout`/`layoutId` in the app (that needs the big bundle): only the desktop island window uses full framer. The PIN screen uses no framer.
- **Blur:** `backdrop-filter` blur 12 px at most, no `saturate()`.
- **Success moments:** `celebrate(el, kind)` in `fx.ts` (one shared canvas, ~12 dots, under 400 ms). `feedback(kind)` / `onFeedback()` is the one hook for the matching sound.
- **Sound:** one `AudioContext` per page, owned by `soundKit.ts`; making one anywhere else fails the test. The island's own sounds (open, close, page, tap, hover, done, level up, alert, error) are notes in `core/islandSound.ts`, played by `islandSounds.ts` through `soundKit.playVoices` (never before the first gesture): Settings → Sound → Island sounds Off / Subtle / Full and a Sound check; ducked while music plays, silent in a call (and in focus if you want), rate-limited.

## 6. Reliability (how the system protects itself)

- **Checks before shipping:** `.github/workflows/ci.yml` (tsc, vitest, bundle up to date, build, smoke test under the real CSP). Vercel's `vercel-build` runs tests + tsc, so a red commit never goes live. The Windows release (`release.yml`) runs the same smoke test and opens the app on Windows before publishing.
- **System health:** beats in `sys_health`, errors in `sys_error_log` (`systemHealth.ts`), checks in `src/core/health.ts`. Ben warns on Telegram after 30 min broken, says when fixed, Sunday report. Settings → System health.
- **Desktop crash net:** two crashes in 3 minutes offer reload / save a backup / previous version.
- **Dependencies:** `.github/dependabot.yml`, monthly grouped PRs; CI tests them. Electron and sql.js majors are ignored there on purpose: see `docs/PLAN.md` (quarterly Electron task).
- **Signed installers:** `docs/code-signing.md`.

## 7. Rules for you

- Small, focused commits; plain-English messages; one feature at a time.
- Don't redo or undo recent work without a reason; read `git log` first.
- Never put secrets, ids or my real personal data in code, tests, docs or commit messages.
- Points must be honest: a habit pays only for something actually done when it is logged.
- When something is wrong, say so plainly; when it works, show proof (test output, screenshot).
- Ask me questions when a decision is mine to make.

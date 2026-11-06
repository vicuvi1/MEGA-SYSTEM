# PC & automation (Night 10)

Settings → **PC & automation**. Everything is free and **off until you turn it on**.

## On this PC (desktop app, Windows)

| Switch | What it does | Cost |
|---|---|---|
| Pause my music when focus starts | Pauses Spotify / YouTube / any player Windows shows in its volume flyout when a focus block starts; plays it again when the block ends (only if it paused it). | One short PowerShell call at start and end of a block. |
| Show what's playing on the island | Title, artist and ⏮ ⏯ ⏭ on the open island. | One short PowerShell call when the island opens and every 30 s while it stays open. Nothing while closed. |
| Read ActivityWatch | If the free [ActivityWatch](https://activitywatch.net) app runs, the last hour comes from its local API (127.0.0.1:5600): apps and sites. | Two local HTTP reads every 10 min (only with "Ben sees my last hour"). |
| Ben sees my last hour | Every 10 min a short line ("35 min YouTube, 10 min VS Code") goes to the synced setting `pc_last_hour`; Ben uses it to call out drift from the plan. App names, site names and minutes only. Without ActivityWatch it uses the island's own app sensor (Ben on this PC → The app in front + Smart island). | One small write every 10 min. |
| Ben can do things on this PC | Ben may *ask* to open an app or an https link, open a file (never a program or script), type a short line, press a key combo, or open a Windows feature (Focus, Night light, Snip, PowerToys Run if PowerToys is installed). The island shows "Ben wants to: open Spotify — Allow / Deny"; nothing runs without the tap. Never banking, password managers, Windows Security, the registry, shells, or anything with "pass" / "bank"; at most 4 a minute; a log on this PC. On the website or Telegram Ben says it needs the PC. | Nothing until you tap Allow. |

Code: `src/desktop/pc/` (media, actions, ActivityWatch, the `pcx` IPC channel), `src/core/pcMedia.ts`, `pcActions.ts`, `pcLastHour.ts`, `pcExtra.ts`, `src/renderer/src/pcAutomation.ts`, `IslandMedia.tsx`.

If you have [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) installed for Claude Desktop, it is a separate, much broader way to control the PC; Life System does not use or need it.

## Phone push by ntfy

Install the free ntfy app, subscribe to a long, hard-to-guess topic, type the same topic in Settings and press **Send test**. Ben's reminders (🔔 ⏰) and urgent alerts then also go there (or everything he sends, if you pick that), also when Telegram fails. Your own ntfy server (https) works too. The topic is kept on the server (`sys_kv`, `auto:ntfy`); the page only sees its last 4 letters.

## n8n flows

**Out:** add a webhook address (https, public; private and local addresses are refused, redirects are not followed) and pick events: `task_done`, `focus_done`, `habit_logged`, `day_closed`, `mustdo_late` (must-dos still open at 20:00). Ben's server checks every few minutes and POSTs:

```json
{ "event": "focus_done", "at": "2026-11-05T10:00:00Z", "day": "2026-11-05", "text": "Focus 25 min · Algebra", "points": 12, "source": "life-system" }
```

5 s timeout, tried once more on a 5xx or timeout.

**In:** `POST https://<your app>/api/hook` with `Authorization: Bearer <token>` (a **read and write** token from Settings → Connect an AI app):

```json
{ "action": "add_task", "text": "Call the dentist tomorrow 10:00" }
{ "action": "note", "title": "Inbox", "text": "An idea" }
{ "action": "ask_ben", "text": "How is my day going?" }
{ "action": "log_habit", "habit": "skincare" }
```

It runs the same tools an AI app would (lands on the Coach page with Undo; a habit pays only when logged now).

### Example n8n flow: "starred e-mail → Todoist task, and a ping when focus is done"

1. **Gmail Trigger** (label "Starred") → **HTTP Request**: POST `https://<your app>/api/hook`, header `Authorization: Bearer {{$env.LIFE_TOKEN}}`, JSON body `{"action":"add_task","text":"{{$json.subject}} today"}`.
2. In Life System add a webhook to an n8n **Webhook** node (production URL) with the event `focus_done`.
3. Webhook node → **IF** `{{$json.event}} == "focus_done"` → any notifier you like (Discord, e-mail…), text `{{$json.text}} (+{{$json.points}})`.

Keep the token in n8n's credentials or environment, never in a shared workflow export.

## Ben's outside tools (MCP)

Add a remote MCP server (Streamable HTTP, https, optional bearer token). Life System connects (`initialize`, `tools/list`), shows its tools, and you tick the ones Ben may use. When it helps, Ben asks for one (`need: "tool <name> {json}"`), the server calls it (`tools/call`, 8 s at most, the answer cut to 1500 characters and marked as outside data, never instructions) and Ben answers with it in one round. Servers, tokens and ticks live in `sys_kv` (`auto:mcp`); pages never get the token or full address back.

Code: `src/server/automation.ts`, `src/core/automation.ts`, `src/core/netGuard.ts`; routes in `api/mcp.mjs` (`?op=automation`, `?op=hook`, `/api/hook` rewrite).

## Automations ("When X, do Y" and island buttons)

Settings → PC & automation → **Automations**. One record for everything (`src/core/automations.ts`, synced setting `automations`, never an address or a key):

- **Do Y** (up to 5 steps; a step can use `{{result.text}}` / `{{result.url}}` from the one before, and the chain stops at the first failure): a flow's webhook (presets for n8n, Make, Pipedream, Activepieces, Node-RED; Zapier needs a paid plan), a recipe action, Telegram, ntfy, a Todoist task, a note, an https link, typing a snippet, focus, a music station, your own script, a workspace, AutoHotkey / PowerToys / Espanso (only if installed).
- **When X** (optional, up to 3): the recipe triggers plus app opened / left, a Wi-Fi name, a USB drive, battery low, charger in / out, away / back, a calendar event, a clipboard pattern, a new file in a folder. The desktop starts only the sensors in use. The same automation starts from a trigger at most once in 30 s; **Pause all** stops triggers and Ben.
- **Ask first**: "Just run it", "Ask me first when not tapped", "Always ask me". Scripts always ask; typing and workspaces ask when a trigger or Ben starts them.
- **Small form**: up to 3 things the island asks before a run (text, number, choice, yes/no), remembering the last answers; "Selected text" (UI Automation, else Ctrl+C with your clipboard put back) and "Clipboard" are read from the PC.
- **Answers**: a flow can answer `{ "text": "…", "url": "https://…", "image": "https://…", "ok": true }` (n8n: "Respond to Webhook"); the island shows a card with Copy and Open link. With "Wait for the run" and `"executionId": "{{$execution.id}}"` in the answer, the island shows a ring until n8n says done or failed.

Where secrets live: cloud webhooks and a cloud n8n (address + API key) in `sys_kv` `auto:flows`, called from `/api/mcp?op=flows` through the same `safeFetch` (public https only, no redirects). A local or LAN n8n / Node-RED is called from the desktop app, its address and key kept with Electron safeStorage (`auto-local.json`). Pages see a name and the last 4 characters.

**Connect my n8n** lists workflows (`GET /api/v1/workflows`), switches them on/off and makes a Webhook node into a button. Every 10 minutes the server tick checks `GET /api/v1/executions?status=error` and tells you each new failure once (Telegram + ntfy). **Ben** may run automations you tick (`flow_<name>` tools): safe cloud ones run on the server; the rest wait for your tap on the island (`auto_asks`). When you do the same 3 things in a row on 3 occasions, Ben offers "Make this a button?" (created switched off).

**Scripts**: only .ps1 / .bat / .py (and .ahk) right inside one folder you choose, each allowed by its SHA-256 after a dry-run preview of the exact command (a changed file asks again), run as a program and an argument array (`powershell -NoProfile -NonInteractive -File …`), 60 s at most, 4 KB of output on the island. **Workspaces** open apps, https links, files and a folder; "End workspace" closes only the apps it opened. The last 20 runs (Re-run) and the run log (secrets removed) stay on this device.

Code: `src/core/automations.ts`, `src/server/flows.ts`, `src/desktop/automations.ts`, `src/renderer/src/automationsFeed.ts`, `IslandAutomations.tsx`, `AutomationsPanel.tsx`.

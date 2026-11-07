# Plugins and PC automation

> Optional plugins and PC automation settings.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

### Plugins (`src/plugins/`)


Small add-ons, each off until switched on in Settings → Plugins (`plugins_on`). A plugin can add a line to `lifeContext()`, actions, Telegram commands, a file reader, server jobs (morning/tick/evening via `src/plugins/run.ts`) and read-only `mcpTools`. Settings keys: `plugin_<id>`, `plugin_<id>_data`, `plugins_status`. Now: weather, github, gmail, bank (CSV import), health (phone numbers by Shortcut, keys hashed in `sys_health_keys`), notes (Obsidian in the desktop app, Notion optional).

### PC & automation


Settings → PC & automation (all off by default, all free): pause music during focus and what's playing on the island, ActivityWatch / the last hour for Ben (`pc_last_hour`), Ben's PC actions with Allow/Deny on the island (`pc_asks`), phone push by ntfy, n8n webhooks out and `/api/hook` in, Ben's outside MCP tools. Server parts keep their settings in `sys_kv` (`auto:*`). Details: `docs/pc-automation.md`.

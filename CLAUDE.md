@AGENTS.md

## Claude Code specifics
- **Session start:** read `docs/harness/progress.md`, then run `bash scripts/init.sh`. Never build on a red baseline.
- **Agents:** route by task using [`docs/harness/model-routing.md`](docs/harness/model-routing.md). Project agents live in `.claude/agents/`:
  - `status-checker` (Haiku)
  - `builder` (Sonnet)
  - `architect` (Opus)

  Brief builders with [`docs/harness/brief-template.md`](docs/harness/brief-template.md): goal, owned files, acceptance, tests. Nothing else.
- **Shipping:** the `ship` skill (`.claude/skills/ship/`) holds the verify → commit → rebase → push → report steps. Invoke it instead of repeating them in briefs.
- **Parallel builders:** at most 2–3 at once, and only with non-overlapping files. These hotspot files get one owner at a time:
  - `webBots.ts`, `telegramBot.ts`
  - `DesktopIsland.tsx`, `IslandFeed.tsx`
  - `e2e/smoke.mjs`, `api/_bot/bot.mjs`
- **Keep the main context small:**
  - Ask for ≤250-word reports.
  - Look at no more than 1–2 screenshots per feature.
  - Use `gh api … --jq` instead of large MCP listings.
  - Start a fresh session at each milestone, with the handoff in `docs/harness/session-handoff.md`.

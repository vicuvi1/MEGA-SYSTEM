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
- **Cost rules (owner, Nov 2026):**
  - Batches of 2–4 features, shipped as soon as each is green; no 15-feature briefs.
  - Use `builder` (Sonnet) for UI, tests and routine work. Use `architect` (Opus) only for sync, the planner, security, data models or a hard root cause.
  - Don't re-run the full smoke if the builder already ran it on the same base; re-run only after a rebase that changed things or a conflict.
  - When a test depends on page height or timing, keep ≥10% headroom up front: the Windows release is slower and its fonts are taller.
  - Start a fresh session after each shipped milestone (handoff in `docs/harness/session-handoff.md`).

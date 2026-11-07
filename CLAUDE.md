# CLAUDE.md

Claude Code reads this file first. The rules live in **[AGENTS.md](AGENTS.md)** (short) and
**[docs/AI_HANDOFF.md](docs/AI_HANDOFF.md)** (full). Read both before you change anything.

## Start of every session
1. Read `docs/harness/progress.md` (where things stand) and `docs/harness/feature_list.json`
   (what works, how it is checked).
2. Run `bash scripts/init.sh`. If it fails, fix that first: never build on a red baseline.
3. Pick **one** item. Mark it `in_progress` in `feature_list.json` (only one at a time).

## End of every session
1. Go through `docs/harness/clean-state-checklist.md`.
2. Add a session entry to `docs/harness/progress.md`, and write
   `docs/harness/session-handoff.md` if the work isn't finished.
3. If you made a choice that a later session might undo by accident, add it to
   `docs/DECISIONS.md`.

## Definition of done
A change is done only when **all** of these are true:
- `npx tsc --noEmit -p tsconfig.json` is clean, and `npx vitest run` passes.
- `npm run smoke` passes, with a step that covers the change when it changes the UI.
- `npm run build:bot` was run, and `api/_bot/bot.mjs` is committed, if bot code changed.
- The feature's entry in `feature_list.json` says `passing`, with its evidence filled in.
- Commit messages and UI text are in plain English. There are no secrets and no real personal data.

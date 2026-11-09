# Session handoffs

## When to start a fresh session
Start a new Claude Code session, rather than continuing a long one, when any of these is true:
- a milestone is done (a pick list landed, a release is published);
- the conversation is long and has been summarized more than once;
- you are switching to an unrelated area.

A running conversation can't be reset in place, and nothing here does that automatically.

**How:** first write the coordinator handoff below into this file and add a 5–8 line entry to
[progress.md](progress.md). Commit them. Then open a new session and say:
"Read CLAUDE.md, then docs/harness/session-handoff.md, and continue."
Running background agents keep running. The new session sees their commits on `main`.

## Coordinator handoff (overwrite each time, keep it under ~15 lines)
```
Milestone:   <what this stretch of work is>
Completed:   <commits/features landed, one line each>
Active:      <agents still running: area, worktree, what they own>
Blockers:    <anything failing or waiting on the user>
Next action: <the single next step>
Files:       <the 3–6 files/docs the next session needs first>
```

### Current handoff (2026-11-09)
```
Milestone:   food + training + body composition plans, Custom Center, island v2, quick add — all on main (b022da9)
Completed:   see progress.md; full smoke green on b022da9
Active:      none
Blockers:    owner: which scale app (Xiaomi Home EU or Mi Fitness) for Phase 2; GEMINI_API_KEY must be set in Vercel for photo logging
Next action: scale Phase 2 sync (tools/scale-sync + docs/scale-sync.md) or the UI clean-up pick list
Files:       docs/INDEX.md, docs/areas/sport.md, docs/areas/custom.md, docs/areas/island.md, docs/harness/progress.md
```

## Builder report format (≤ ~250 words)
What changed for the user · files touched · checks run with results · commit hash · risks or
what wasn't possible · screenshot paths. No full logs, no long file lists.

## Commands
- **Start:** `bash scripts/init.sh`.
- **Release status:** `bash scripts/release-status.sh`, and `fail` for the ✗ lines.
- **One smoke area:** `SMOKE_ONLY="<words>" npm run smoke`. Add `SMOKE_FULL=1` to see the whole error.
- **Token use:** `python3 scripts/measure-usage.py`.

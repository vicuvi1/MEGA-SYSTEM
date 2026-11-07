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

### Current handoff (2026-11-07, evening)
```
Milestone:   Sport Track → real strength coach (owner's goal: get much, much stronger)
Completed:   bug round, island alive + game time, plan/Todoist sync, Coach readability, sport levels/coach/forecasts/programs (aa5dbb4, 8b29dd5); full smoke green on 8b29dd5
Active:      one builder (worktree) on sport: big level hero on Today, auto-switch to harder variations,
             Too easy / Too hard, effort rating, "best set" placement (owner does ~50 push-ups in one set),
             new default Strength mode (5–8 reps, 3–5 sets, 2–3 min rest, next variation at 3×8)
Blockers:    none known. New worktrees lack some node_modules files: symlink /home/user/MEGA-SYSTEM/node_modules
Next action: check that builder's commit on main (git log), run SMOKE_ONLY="Sport Track" npm run smoke, then release status
Files:       docs/INDEX.md, docs/areas/sport.md, docs/harness/progress.md, docs/harness/feature_list.json
```

## Builder report format (≤ ~250 words)
What changed for the user · files touched · checks run with results · commit hash · risks or
what wasn't possible · screenshot paths. No full logs, no long file lists.

## Commands
- **Start:** `bash scripts/init.sh`.
- **Release status:** `bash scripts/release-status.sh`, and `fail` for the ✗ lines.
- **One smoke area:** `SMOKE_ONLY="<words>" npm run smoke`. Add `SMOKE_FULL=1` to see the whole error.
- **Token use:** `python3 scripts/measure-usage.py`.

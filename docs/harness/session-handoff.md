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

### Current handoff (2026-11-07, final)
```
Milestone:   Sport back to SIMPLE (0a1bb20): own routine restored, Simple mode default, Harder/Easier per exercise; coach features behind "Coach mode" (off)
OWNER RULE:  Sport must stay simple — his exercises (push-ups, press/abs, sit-ups, squats) + a Harder button. Coach mode stays OFF. Don't add complexity to Sport Today.
Active:      none
Blockers:    "Sport Track onboarding" smoke step passes only on retry (stale synced copy resets coachMode) — fix
             Squats added on the onboarding day might have been hidden by the restore — check and offer to re-add
Next action: check the user's Sport Today shows his exercises; fix the coachMode sync race; full smoke on main
Files:       docs/INDEX.md, docs/areas/sport.md, src/core/sportSimple.ts
```

## Builder report format (≤ ~250 words)
What changed for the user · files touched · checks run with results · commit hash · risks or
what wasn't possible · screenshot paths. No full logs, no long file lists.

## Commands
- **Start:** `bash scripts/init.sh`.
- **Release status:** `bash scripts/release-status.sh`, and `fail` for the ✗ lines.
- **One smoke area:** `SMOKE_ONLY="<words>" npm run smoke`. Add `SMOKE_FULL=1` to see the whole error.
- **Token use:** `python3 scripts/measure-usage.py`.

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
Active:      none. Training phase 1 shipped (d5efdd3): Sport Track opens on Training (src/renderer/src/training/, core/sportTrain.ts).
Blockers:    <anything failing or waiting on the user>
Next action: Training phase 2 in small batches: equipment + home-only mode; exercise library with chains; workout builder; PRs + readiness; switch Body -> Today coach Start to the new workout flow. Mockups were images 28-31 in the old session (dark cards, lime accents).
Files:       <the 3–6 files/docs the next session needs first>
```

### Current handoff (2026-11-10, evening)
```
Milestone:   Study Time 2, food photos (Drive, paste from AI, gallery, scores), island click-through, Ben short night; release v1.4.1441 green
Completed:   see progress.md (2026-11-10 entry)
Active:      architect "Tracker uses the real progressive program" (worktree agent-a5743df7…): Sport Track Tracker Today -> sets x reps at ladder steps from trainWeek/trainLadders, double progression; owns sport/index.html, src/core/sport*.ts, sportkit.js, body/training. Ship it when it reports (full smoke + release).
Blockers:    owner: Connect Google Drive in Photo Locker; which scale app (Xiaomi Home / Mi Fitness); real AI / Open Food Facts / Drive only tested with fakes
Next action: ship the Tracker branch; then small batches only (2-4 features), see "Cost rules" in CLAUDE.md
Files:       docs/INDEX.md, docs/areas/sport.md, docs/areas/food.md, docs/areas/focus.md (Study Time), docs/harness/progress.md
```

## Builder report format (≤ ~250 words)
What changed for the user · files touched · checks run with results · commit hash · risks or
what wasn't possible · screenshot paths. No full logs, no long file lists.

## Commands
- **Start:** `bash scripts/init.sh`.
- **Release status:** `bash scripts/release-status.sh`, and `fail` for the ✗ lines.
- **One smoke area:** `SMOKE_ONLY="<words>" npm run smoke`. Add `SMOKE_FULL=1` to see the whole error.
- **Token use:** `python3 scripts/measure-usage.py`.

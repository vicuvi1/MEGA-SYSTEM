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
Milestone:   Money for life and business (all 5 phases) + data safety + phone payments; release v1.4.1460 green (6c0a43d)
Completed:   phase 1 trust (reconcile, export, tested totals); 2 Personal/Business/Both books, Business view, Pay yourself; 3 taxes (individual entrepreneur profile) + receipts + accountant Excel; 4 long view; 5 To sort card, learned categories, bills to confirm; data safety (chunked cloud backup, PC backups, undo to before X, docs/RECOVERY.md); phone payments (/api/cron?job=pay, pk_ keys, MacroDroid)
Active:      none.
Blockers:    owner: change PIN; BACKUP_PASSPHRASE + CRON_SECRET in a password manager; confirm 2026 tax exemption in Taxes (29,700 vs 27,000, marked "check"); attach one receipt with real Drive; set up MacroDroid (Settings > Phone payments); send 2-3 real maib / Google Wallet notification texts (card numbers blurred). Known: refunds count as income; calendar.test.ts fails outside UTC (module off).
Next action: round-2 fix pick list (artifact EfdmeVe1Pj71CbWzHBnC3w) waits for the owner's picks; then long-term batch (AI model names in config + fallback, Electron/Node 24, DST/year-rollover clock test, calendar.test outside UTC).
Files:       docs/areas/finance.md, docs/design/money/money-v2-plan.md, docs/RECOVERY.md, src/core/payNotify.ts, src/core/moneyToSort.ts
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

# Progress log

Every session reads this first and adds one entry at the end. Newest entry on top.
Keep it short and true: anything written here is what the next session will trust.

## Current verified state (keep to 5–8 lines)
- **Milestone:** Life boost picks + context-efficiency Phase 1 (docs/INDEX.md, docs/areas/, routing, ship skill).
- **Landed:** sleep care d36923c · seasons dca47bd · focus boost c8d389e · body 46c63ec · career 2cf9ced. All 41 Life boost picks done. Last green release v1.4.1366.
- **Active:** Sport Track smoke-step fix (builder). Docs: all handoff sections are now in docs/areas/ (career.md, focus.md, sport.md Body).
- **Blocker:** the "Sport Track Today" smoke step is flaky on the Windows runner (1 retry; root cause: page reload after a logged workout).
- **Next:** confirm the release → land the Sport smoke fix → run the model comparison tasks.
- **Verify:** `bash scripts/init.sh` · `npm run smoke` · `bash scripts/release-status.sh`.

## Session record

### 2026-11-07: Ben 2 and Sport Track v3
- **Goal:** Ben 2 (41 picks) and the Sport Track muscle-growth system.
- **Completed:**
  - speed and plan-from-now;
  - pushes;
  - understanding and memory;
  - plan editing with Google/Todoist sync;
  - chat tools and voice;
  - Sport v3 (photos, sets, levels, Telegram import);
  - the simpler Today Now tab.
- **Verification run:** typecheck, vitest (about 2,440 tests) and the full smoke run, then a green
  release build.
- **Evidence:** release v1.4.1366, and screenshots kept outside the repo.
- **Commits:** 4623dbe, 8854e86, 1eeca0b, 3ecce58, d6b991d, a0a1853, a09fabb, plus smoke fixes up to a30ac75.
- **Known risks:**
  - The Sport smoke step is flaky on Windows.
  - Telegram ±30 buttons don't use the pin rules yet (assigned to the focus-loop builder).
- **Next best action:** land the five Life boost builders, then run one full smoke pass on `main`.

<!-- Template for a new entry:
### YYYY-MM-DD: short title
- Goal:
- Completed:
- Verification run:
- Evidence recorded:
- Commits:
- Known risks:
- Next best action:
-->

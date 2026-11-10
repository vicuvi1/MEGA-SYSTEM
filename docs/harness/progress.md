# Progress log

Every session reads this first and adds one entry at the end. Newest entry on top.
Keep it short and true: anything written here is what the next session will trust.

## Current verified state (keep to 5–8 lines)
- **Milestone:** AI coach (Today card, ramp-up, Sunday review, check-in, nudges ≤3/day, chat with Apply, safety rules), Growth tab + growth levels, Photo Locker (Google Drive), Goal Ladder, Todoist audit, island sound + simpler Day page, finance donut, multi-photo food — all on main; Windows release v1.4.1428 green (eddc11f).
- **Safeguards:** unit tests also run on Windows in CI; ship steps check the Windows release first; "Desktop updates" health alert; flaky checks fixed at the root (docs/areas/workflow.md).
- **Known gaps:** real AI replies/photo/scale reads and Google Drive untried (fakes only); owner must enable the Drive API + drive.file scope; Today → Now is ~1.65 screens on Sun/Mon (limit 1.75).
- **Next:** scale Phase 2 sync once the owner says Xiaomi Home or Mi Fitness; Telegram versions of the Goal Ladder reviews; UI clean-up pick list.
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

### 2026-11-10: Study Time, food photos, island and release safeguards
- Shipped: island clicks pass through (only the pill takes clicks); Ben answers a short night in code in ~1 s and really lightens the plan; Sport Track metrics look kept, app-wide restyle rolled back (owner keeps the old sidebar).
- Shipped: Study Time 1+2 (two halves, pomodoro, pause/switch, quick add, Todoist blocks, stats, island ring + notices); lost-set sync race fixed (editedAt); idle server calls cut (soak green).
- Shipped: food photos via Telegram -> Photo Locker -> Drive, precise estimates, repeat-meal tiles, Paste from AI (LIFE-FOOD v1 prompt), meal score, gallery, charts, island notice, AI cost meter.
- Rule: desktop only for now (AGENTS.md). Release v1.4.1441 green.
- Lessons: Windows fails tests Linux passes (fonts taller, slower): keep >=10% height headroom, mark DOM rows instead of counting them, never leave the page clock moved.
- Next: Tracker -> real progressive program (agent running); keep batches small and cheap.

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

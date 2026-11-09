# Progress log

Every session reads this first and adds one entry at the end. Newest entry on top.
Keep it short and true: anything written here is what the next session will trust.

## Current verified state (keep to 5–8 lines)
- **Milestone:** food (saved meals, standard day, AI photo logging in app and Telegram, meal reminders, one weekly calorie check), training (split, Today card, fast logging, roadmap, recovery, progress, warnings), body composition (log sheet, scale screenshot import, dashboard), Custom Center + island v2, quick add (Alt+Space) — landed 2026-11-08/09; full smoke green on b022da9.
- **Active:** none.
- **Known gaps:** real Gemini/Claude photo and Xiaomi screenshot reads not tried yet (fakes only); Windows-only parts (global shortcut, island drop zone, wallpaper) not tried on a real PC; seeded standard day = 2,332 kcal (owner adds an item or enters height/age); intermittent smoke steps: Desktop island (v2), Sport Track Today, "no uncaught page errors".
- **Next:** scale Phase 2 (SmartScaleConnect on the owner's server → /api/cron?job=health with a health key, docs/scale-sync.md) once the owner says Xiaomi Home or Mi Fitness; UI clean-up pick list (toasts under the phone nav, sticky tabs over titles, 17-item sidebar, one shared style).
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

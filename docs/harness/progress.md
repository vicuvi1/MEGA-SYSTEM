# Progress log

Every session reads this first and adds one entry at the end. Newest entry on top.
Keep it short and true: anything written here is what the next session will trust.

## Current verified state
- **Repository root:** `vicuvi1/MEGA-SYSTEM`. Every push to `main` deploys the website (Vercel) and
  builds the Windows app (`.github/workflows/release.yml`).
- **Start:** `bash scripts/init.sh`, then `npm run web` for the website, or `npm run dev` for the desktop app.
- **Verify:** `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run smoke`.
- **Latest desktop release:** see https://github.com/vicuvi1/MEGA-SYSTEM/releases/latest.
- **Highest priority unfinished work:** the "Life boost" picks (focus loop, food and training, sleep,
  career and money, seasons). See `feature_list.json` for the items still `in_progress`.
- **Known flaky check:** the smoke step "Sport Track Today" can time out on the slow Windows runner
  while it waits for the rest ring after a set. It has one retry (`{ retries: 1 }`). Find the real
  cause before adding more retries.

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

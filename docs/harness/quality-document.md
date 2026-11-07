# Quality snapshot

This document grades the health of the codebase over time. The rubric grades one session; this
grades the whole project. Add a new dated snapshot every few weeks and never edit old ones, so
trends stay visible.

The grades run from A to D:
- **A:** solid, well covered and easy for an agent to work on.
- **B:** good, with small gaps.
- **C:** works, but is fragile or hard to change.
- **D:** risky.

## Snapshot 2026-11-07

### Product domains
| Domain | Verification | Agent legibility | Test stability | Key gaps |
|---|---|---|---|---|
| Today (Now, plan, timeline) | A | B | A | DayFlow is large; the plan editor and the timeline share layout code |
| Ben (chat, brain, pushes, memory) | A | C | B | Many modules (webBots, botBrain, ben*.ts); quality tests use stub models only |
| Day planner and plan sync | A | B | A | Telegram ±30 buttons bypass the pin rules |
| Desktop island | A | C | B | DesktopIsland.tsx is very large; Windows-only behaviour isn't testable in CI |
| Sport Track (embedded) | B | C | **C** | A single big index.html; the smoke step is flaky on Windows |
| Money (embedded Finance Helper) | B | C | A | Plain JS app; logic is tested through a separate test file |
| Goals | A | B | A | Five goal kinds are stored partly in settings (`goal_meta:*`) |
| Rewards and points | A | B | A | Honest-points rules are spread across shop, sleep and discipline |
| Sleep (Waky) and Discipline | B | B | A | Waky is an embedded app with its own data paths |
| Calendar, Todoist and Google sync | B | B | B | Depends on external APIs; covered by fakes in `e2e/server.mjs` |
| Telegram bots | A | C | A | The server bundle (`api/_bot/bot.mjs`) must be rebuilt by hand |

### Architectural layers
| Layer | Boundary enforcement | Agent legibility |
|---|---|---|
| `src/core` (pure logic) | A: no DOM or Electron, well tested | A |
| `src/main` (services on the browser DB copy) | B | B |
| `src/renderer/src/web` (data layer, mirror, bots) | B: the sync rules are subtle (desktop outbox, mirror) | C |
| `src/renderer/src` (React UI) | B | C: several very large components |
| `src/desktop` (Electron shell, island) | B: narrow IPC, trusted-origin checks | B |
| `api/` (Vercel functions) | A: 12-function limit, SQL guard, PIN on the server | B |
| `src/renderer/public/apps/*` (embedded apps) | C: an iframe boundary with message passing, big single files | C |

### What to improve next
1. Find the real cause of the flaky Sport Track smoke step (the page reloads after a workout is logged).
2. Split the very large components: DesktopIsland, DayFlow and the sport index.html.
3. Send Telegram plan buttons through planEdit/planSync.

# Decisions

Choices that a later session could easily undo by accident. Each entry gives the decision, why it
was made, and what it rules out. Newest entries go on top. Don't reverse one without writing a new
entry that says why.

### Generated bundles are marked generated (2026-11-07)
- **Decision:** `api/_bot/bot.mjs` and `sportkit.js` are still committed, but `.gitattributes` marks them `linguist-generated -diff`.
- **Why:** their diffs flooded reviews and AI context. Rebuild them, never hand-merge them.
- **What stays the same:** the deploy, and CI's freshness check (`git diff --exit-code` still fails when they're stale).

### Area docs over the big handoff (2026-11-07)
- **Decision:** agents read `docs/INDEX.md` plus one `docs/areas/*.md` file. New documentation goes into the area file.
- **Why:** the 94 KB `AI_HANDOFF.md` was read in full by most agents.
- **Rules out:** appending new sections to `AI_HANDOFF.md`. It stays as the historical reference.

### Smoke steps may retry once, but only on purpose (2026-11-07)
- **Decision:** `step(name, fn, { retries: 1 })` is allowed for steps that drive a whole embedded
  app. A failure prints its "waiting for …" line.
- **Why:** the Windows release runner is slow, and the Sport Track page reloads after a logged
  workout. Before this, releases were blocked for hours.
- **Rules out:** retries as a default. Every retried step needs a known cause, written in
  `docs/harness/progress.md`.

### The smoke test runs on a fixed clock (2026-11-06)
- **Decision:** the e2e clock is pinned (Friday 08:30, `E2E_NOW`), and tests pin their own clocks
  with fake timers.
- **Why:** tests that passed in the morning and failed at night blocked releases.
- **Rules out:** using `new Date()` in tests without pinning the clock.

### Points are always honest
- **Decision:** points are paid only for things actually done and logged at the time. Imports,
  back-dated logs, badges, levels and "auto" habits pay nothing extra.
- **Why:** the points wallet only works if it can be trusted (see `src/main/sleep.ts` and
  `src/main/discipline.ts`).
- **Rules out:** paying for taps that don't prove the action, such as tapping an auto habit.

### A day plan starts from now, and today's asks stay today (2026-11-07)
- **Decision:** plans start at now rounded up to the next 5 minutes, plus 5. Tasks the user asks
  for today are placed first; older, lower-priority tasks move to tomorrow instead.
- **Why:** this was the owner's explicit request.

### Plan blocks have their own Google event ids (2026-11-07)
- **Decision:** a plan block's calendar event id is `planEventId(day, blockId)`; every writer (approval, plan editor, other devices) uses it, and a create with an existing id updates that event.
- **Why:** two writers made every block twice. Dedupe by a stable key, not by timing.
- **Rules out:** creating plan events without the id, or a clean-up that touches events not marked as made by Life System.

### One thing = one block in the day plan (2026-11-08)
- **Decision:** the plan is cleaned by `core/planDedupe.ts` (in `packDay` and at the end of `propose`). Same thing = same id, else the same normalized title (case, punctuation, emoji, a length like "(20 min)" ignored; the words before ":" count when 2+ words). What wins: a pinned/approved block, then a calendar event still ahead, then the loose copy. Only the plan changes: no task, event or point is touched.
- **Why:** the owner saw the same task as a must-do, a block and a calendar event, and every task of a group block listed three times.
- **Rules out:** matching on a single-word heading ("University: …" vs a class), treating different numbers ("chapter 3" vs "chapter 4") as one, or deleting a task or event to remove a copy.

### The repo is public: no personal data, ever
- **Decision:** use made-up data in code, tests, docs and screenshots. Personal profile notes live
  only in the private database (Settings → Ben).
- **Rules out:** committing real numbers from exports, chats or screenshots. Importers parse files
  locally in the browser.

### The plan re-plans by itself, but only its drafts (2026-11-08)
- **Decision:** when the day changes, `core/planAuto.ts` moves only the draft blocks the change hits (late and not started, or now on an event or an overrun block); approved, pinned, ticked and calendar blocks and events never move. Remote changes are merged first, then the re-plan runs; it never writes to Google or Todoist. At most once in 2 minutes, 5 a day, never while editing, refused if it would undo the last run. Default on; Settings → "Re-plan by itself".
- **Why:** the owner wants a work planner that keeps up with the day without asking, and a plan he can trust: no churn, no surprises in his calendar.
- **Rules out:** re-packing the whole remaining day automatically (the manual "Re-plan from now" does that), moving anything already in the calendar by itself, or re-adding a block the user removed.

### Every task of the day has a place or a stated reason (2026-11-08)
- **Decision:** `core/planAudit.ts` runs after a plan is built or edited: a task the plan lost goes back on today's list; what has no room shows as one plain line with "Move to tomorrow". Block "why" lines come only from data the plan or Todoist holds.
- **Why:** a task silently missing from the plan breaks trust in the whole plan.
- **Rules out:** dropping a task without a reason on the card, or a "why" line made up by the model.

### At most 12 Vercel functions (Hobby plan)
- **Decision:** new server features are added as ops on existing functions or as `vercel.json`
  rewrites.
- **Rules out:** new files in `api/`.

### Security rules that must hold
- **Decision:**
  - `/api/db` refuses the server-only `sys_*` tables and ATTACH/PRAGMA.
  - Pages can only read `cloud_snapshots`.
  - The PIN lives only on the server and is changed through `/api/login {changePin}`.
  - The bots obey only the owner's chat ids.
  - A database hiccup is a 503, never a sign-out.
- **Rules out:** relaxing `api/_sqlguard.mjs` for convenience.

### The schema is append-only
- **Decision:** `src/core/schema.ts` only grows. Each migration bumps `SCHEMA_VERSION` in
  `api/_schema.mjs`, and a test checks this. Prefer synced settings for small new data.

### Original art only
- **Decision:** wallpapers, demos and avatars are drawn for the app, or come from public-domain
  sources with a NOTICE file (Sport photos: Free Exercise DB, Unlicense).
- **Rules out:** franchise characters, logos or hot-linked images.

### Desktop writes save locally first and upload right after (2026-11-06)
- **Decision:** a desktop write saves to the local copy and returns. The upload runs next in line,
  and catch-up is skipped when the copy was checked in the last 15 seconds.
- **Why:** island taps were slow because they waited on the internet twice.

### Health alerts need a sustained failure (2026-11-07)
- **Decision:** a part is "broken" only after 3 failed calls in a row (a refused key at once) and
  30 minutes from the first; the next OK clears it. Capped tries the caller retries itself don't count.
- **Why:** one timed-out AI call followed by silence became "Failing since 34 min ago".
- **Rules out:** alerting on a single error, or counting the chat's own planned fallbacks as outages.

### Ben states only what his data holds (2026-11-07)
- **Decision:** every model reply passes `src/core/benGround.ts`: times, events and progress claims
  that aren't in his context or your message are taken out. "What now?" is answered in code.
- **Why:** he told you about a "meeting" at 19:50 that didn't exist.


### Todoist edits wait for Todoist's answer (2026-11-08)
- **Decision:** every task edit in the app goes through one queue (`core/todoSync.ts`): only the changed
  fields are sent, "today"/"tomorrow" are sent as your own date, your edit is shown over any list read
  until Todoist confirms, and a failed save is kept (also across a reload) and retried, with a visible
  "Couldn't save to Todoist. Retry" on the row. Priority maps in one place (`toApiPriority`: P1 = 4).
- **Why:** edits looked saved but a refresh brought the old value back, some callers (Ben's quick
  commands, the island) had no way to edit at all, and failures only flashed a toast.
- **Rules out:** writing a task edit straight to `/api/todoist` from a page, reverting a failed save
  silently, or sending date words for Todoist to read in its own time zone.

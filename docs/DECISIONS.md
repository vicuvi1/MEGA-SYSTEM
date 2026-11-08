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

### Time limits are hard; deadlines say when they don't fit (2026-11-08)
- **Decision:** your limits (`plan_limits`: most work a day, off time, protected blocks, a cap per kind) are never broken by the packer, the audit or the automatic re-plan; only draft blocks the planner made are trimmed or go back on the list, pinned/approved/ticked/calendar blocks stay. Deadlines are planned backward into sessions (`core/planDeadlines.ts`) of 25–90 min, one per deadline a day, ids from goal + day; what doesn't fit is reported plainly ("Not enough room before Friday 20 Nov: 3h short"). The week plan (`plan_week`) is a weekday template (heavy/normal/light, gym); a light day caps work at 2h; changing it re-plans only today's draft and the days ahead.
- **Why:** the owner wants a work planner he can trust with time he protects: a limit squeezed silently to fit a deadline breaks that trust, and a deadline that can't be met is better known early.
- **Rules out:** breaking a limit to fit more work, cramming a deadline into one day, a second session block of the same deadline on a day, changing an approved plan or a past day because the week changed, energy or mood questions in the planner.

### The planner learns only from real numbers, and the check pays nothing (2026-11-08)
- **Decision:** the end-of-day check (`core/planReview.ts`) keeps one record per plan block in the synced setting `plan_review` (no new table): Done goes through the plan's usual tick (Todoist closes the task; points only from that path), Tomorrow through the usual Move to tomorrow (the block stays on today's plan), Drop is only noted. Learned task times (`core/taskTimes.ts`) use only Done blocks with a focus-timer or typed number, compared with the planner's plain guess (never with an already-learned length): median of the last 9, at least 3, bounded 0.5x–2.5x; a Todoist duration or a length you told Ben always wins. The plan score (`core/planScore.ts`) is 50% minutes done, 30% blocks in their time, 20% not slipped; it rates the plan, not effort.
- **Why:** the owner wants a work planner that learns from what really happened without guessing or rewarding a review; a learned length that chased its own output would drift, and a guessed "done in the planned time" would teach the planner nothing true.
- **Rules out:** points for reviewing or for the score, learning from blocks with no real number, energy or mood questions, deleting a task or event when a block is dropped or slipped.

### One rescue per late block, drafts only; Telegram edits the same plan (2026-11-08)
- **Decision:** a work block 30 min late and not started gets ONE rescue push (`core/planRescue.ts`): built only from the existing rules (the automatic re-plan for drafts in the way, Too much today for what no longer fits, inside `plan_limits`), on the one push channel with one key in `ben_pushes`, at most once per block and 2 a day, never in a meeting, quiet hours or while a timer runs; Accept moves only drafts and has one Undo. Telegram's plan buttons (Too much today, Move to tomorrow, the end-of-day check, a quick-add for today, a rescue's Accept) change today's plan in `coach_rhythm` directly (`web/planShared.ts`, version bumped, one Undo slot `planUndo`), so the app card takes the change on its next look; the Telegram text is the app card's (`core/tgPlanText.ts`, cleaned by planDedupe).
- **Why:** the owner wants a work planner that catches a slipping day without nagging and that works the same from the phone as from the PC; a second copy of the plan or a different rule set on Telegram would show different plans in two places.
- **Rules out:** more than one rescue for a block, a rescue that moves approved, pinned or calendar blocks or breaks a limit, a separate Telegram plan or plan logic, energy or mood questions, points for a rescue.

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

### Health alerts: once a day per problem, with the fix (2026-11-08)
- **Decision:** each kind of problem (AI, server, outside timer, Telegram, Google, Todoist, backup…)
  is told on Telegram at most once per local day, all broken kinds in one message with "What to do"
  and a "Mute for 7 days" button; the daily self-check and the 30-minute checks share one list
  (`alertKey`: "sc:ai" is "ai"). "Working again" only for a kind that was warned about, and only
  after it stayed OK for an hour. Muted kinds don't fail the GitHub tick run either.
- **Why:** a GitHub timer that runs every 3–6 h flapped "broken / working again / broken", and two
  checkers warned about the same thing (6:59 PM, 8:35 AM twice, 11:10 AM).
- **Rules out:** a warning per detection, a recovery message for a part nobody was warned about, or
  putting a secret value in an alert (header names only).

### Background AI calls: short thinking cap, one quick retry (2026-11-08)
- **Decision:** in the tick the thinking model gets at most `BACKGROUND_THINK_MS` (28 s), the quick model
  then gets one retry after a 1 s wait through the fastest provider (not for Ben's chat, which retries
  itself). A call never made because the tick's 50 s were used up is not an AI failure. The self-check
  ping asks the quick model with thinking off (5 tokens, 8 s then 12 s).
- **Why:** the thinking model took the first 35 s, the quick model got ~12 s and timed out too, and later
  calls in the same tick failed at once: three "failures" in one tick made "Ben's AI: Failing".

### Move breaks and water are real cards, even in Calm (2026-11-08)
- **Decision:** the island's real move break and water card (`isBodyCard`, `core/islandCalm.ts`) come
  as the full card in Calm and Balanced and stay 3 min or until answered, then wait as a dot with a
  few words under the line. The move break no longer starts as a dot. Everything else in Calm stays
  the slim line or a dot.
- **Why:** with default settings the owner sat an hour at the PC and saw only a thin green line: the
  break started as a dot, Calm made its peek a 5 s line, and the waiting dot hid the water card.
- **Rules out:** making Balanced or Lively the default, or turning more kinds into cards in Calm.
  Spam is held by the existing governor (30-min gap, 3 different cards an hour, calls, focus,
  classes, quiet hours, bedtime) and `firstSight` (no card shown twice).

### The Coach chat is in time order with one live plan card (2026-11-08)
- **Decision:** the chat is always drawn oldest first by message time (`core/coachOrder.ts`); a reply
  stays under its question and the answer being written stays last. Only the newest message from
  today with a plan card shows it live; older ones are one "Plan updated" line. "See the plan" scrolls
  to that card, or posts the card as a message at that moment. Nothing is ever pinned under the newest
  messages. Simple data questions (sleep average, money earned, habits, today's tasks) are answered in
  code from the data (`core/benAsk.ts`), and every answer shows how long it took.
- **Why:** the owner saw the morning's plan card drawn below the afternoon's questions (a card
  appended after all messages) and a second partial plan card higher up; "how much did I earn this
  month" took about 17 s on the thinking model.
- **Rules out:** a plan card (or any card) rendered after the message list; more than one live plan
  card; sending simple data questions to the model when the data answers them.


### Food counter: numbers in body_log, details in a capped setting, no image AI (2026-11-08)
- **Decision:** a meal is two rows in the one body log (`protein:food`, `kcal:food`, ids `<meal>-p` / `<meal>-k`) and its foods in the synced setting `food_log` (45 days, 400 meals, 20 stars). Protein stays ONE number (`proteinOfDay` of every `protein:*` row). The app never calls an AI for food: it copies a prompt and parses the pasted reply with code. Goals are lean (2.0 g/kg; maintenance +150 kcal on a training day, +0 on a rest day).
- **Why:** body_log already merges across devices by row id and feeds the ring, the weekly report and "why it stalled"; a new table would need a schema bump and a bot bundle rebuild. The owner wants no image-AI cost and no fat gain.
- **Rules out:** a second protein total, a kcal or meal table without a migration plan, a paid vision call, or a bulk-sized surplus by default.

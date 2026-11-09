# Decisions

Choices that a later session could easily undo by accident. Each entry gives the decision, why it
was made, and what it rules out. Newest entries go on top. Don't reverse one without writing a new
entry that says why.

### Seasons are the 12-week quarter of the goal ladder; goals are scored on actions (2026-11-09)
- **Decision:** a Season is now 12 weeks (`SEASON_WEEKS = 12`, field `weeks`) and IS the quarter of the goal ladder (`core/goalLadder.ts`). A season saved before has no `weeks` and is read as 8 weeks (`LEGACY_WEEKS`), so one in progress keeps its end date, boss day and 8 one-week chapters; new seasons have 6 chapters of 2 weeks (two a month, so a chapter never splits a monthly milestone). The ladder holds at most 3 critical goals (`MAX_ACTIVE`); the rest are "Not now". A goal's traffic light and weekly score come only from ACTIONS counted from existing logs (workouts, protein days, weigh-ins, sessions, hard sets, focus hours, applications, money saved, sleep); results (weight, levels, totals) are shown but never colour it. Setting goals and doing the Sunday/monthly reviews pay no points and send no pushes. The quarter's study steps go to the planner as one more deadline goal planned in the room real deadlines leave, as drafts only, and only after the owner confirmed the study goal (milestones or weekly hours): an untouched template never changes the day plan. The ladder lives in one synced setting `goal_ladder`; the six templates carry no personal numbers.
- **Why:** the owner chose a 12-week quarter with 1–3 critical goals and wanted the Goals page, the weekly top 3 and the Season connected, not a fourth system; scoring results (the scale) would punish honest effort and invite gaming.
- **Rules out:** a separate quarter object next to the Season, changing an old season's length, a 4th active goal, scoring a goal on its result, points or pushes for goals and reviews, the ladder approving or booking blocks by itself, personal numbers in the templates.

### Several photos of one meal: one request, each photo counts; Telegram albums meet in sys_kv as file ids (2026-11-09)
- **Decision:** up to 6 photos of one meal go to the AI in ONE vision request (`images`, numbered "Photo n"), with a prompt rule to list each food once; one review, one meal. Each photo counts toward the 50 a day; an "Add another photo" re-read on Telegram counts only the new photos (`opts.counted`, in-process only). On Telegram, album parts and added photos are collected in server-only `sys_kv` rows that hold Telegram file ids (never the picture): the first album part to insert the lead row waits about 2 s, takes the parts and makes the one call; the rows go after the read, on Save/Cancel, and after 10 minutes at most. No new table, no new `api/` file, no schema change.
- **Why:** one call lets the model see the whole meal and not count the same food twice across photos; Vercel functions are stateless and album parts can land in different calls at once, so only an atomic database row can elect one reader; a file id is a reference, not the image, so the "no photo stored" rule still holds.
- **Rules out:** one vision call per photo of a meal, merging separate answers in code, keeping album parts in memory between requests, storing photo bytes (or base64) anywhere, a new table or function for this, and a page-supplied "already counted" number.

### One calorie suggestion for food and body; one target band; scale screenshots share the photo op (2026-11-09)
- **Decision:** there is ONE calorie suggestion (`core/foodAdjust.ts`), shown by one component (`body/FoodAdjustCard.tsx`) on Food and on Progress. It reads weekly averages of the first morning weigh-in from `body_comp` (fallback `body_metrics`), needs 3+ weigh-ins a week, and uses the one band +0.25…+0.5 kg a week (`TARGET_BAND`; `bodyProgress.ts` `LEAN_ZONE` points at it). Rules: under +0.1 kg a week 2 weeks running → +200 kcal; over +0.6 kg a week AND waist up more than 1 cm in 2 weeks → −150/−200; else on track. Accept changes `food_goals.kcalAdj` (±600) and records `{day, delta, after, reason}` in `food_goals.adjLog`. Scale screenshots go through the same `/api/ai` op (`kind:'scale'`), the same 50-a-day counter and budget, a hand-written validator (`core/scaleRead.ts`), a review, then `body_comp` with source `screenshot`; the picture is never stored. This replaces the weight-check numbers in "Food goals are slow muscle gain" below (2 weigh-ins, +0.5 kg, waist +0.5 cm).
- **Why:** Food and Progress used different bands (+0.1…+0.25 vs +0.25…+0.5) and different data (body_metrics vs body_comp), so they could disagree; the owner asked for one system.
- **Rules out:** a second suggestion card or rule set, a second band, a silent kcal change, a new api/ function or a separate counter for screenshots, storing scale pictures.

### Food photos are read by AI on the server, checked in code, saved only after the owner's look (2026-11-09)
- **Decision:** replaces the "no image AI" part of "Food counter: numbers in body_log…" below. Body → Food has "Snap a meal": the page shrinks the photo (1024 px, JPEG) and sends it to `/api/ai {op:'foodPhoto'}` (no new function; provider code in `api/_vision.mjs`, Gemini by default, Claude with `VISION_PROVIDER=claude`). The answer is JSON only and is checked by `core/foodVision.ts` (clamped numbers, totals added up again, a matched saved food uses the owner's own numbers × qty). A review screen shows every food; nothing is saved before "Save meal", and saving goes through the food counter's `addFoodMeal`. At most 50 photos a day (server counter in `sys_kv`, the owner's day) plus the monthly AI budget; over either, the copy-prompt way is offered. The photo is never stored or logged. No points.
- **Why:** the owner gives up logging when it is slow; copy → paste in another app → paste back was the slow part. Code checks keep the one protein number honest; the review keeps the owner in charge.
- **Rules out:** saving an AI answer without the review, trusting the AI's totals, storing or logging meal photos, a second food store, a new `api/` file, a vision key in the page, points for food.

### The island gets the Custom Center as one built view; the wallpaper runs one fixed script (2026-11-08)
- **Decision:** the app window builds `snap.center` (`core/islandCenter.ts`) and the island only draws it; the island window loads `core/islandCenterCard.ts`, never `core/custom/*`. Center looks reach the island only through `setLookSource` + `looksChanged()`, and only the parts changed from the Center's defaults. Island taps on Center widgets are one action `{kind: 'center'}` answered with the Center page's own runner, so counters go through `counterRoute` (custom counters pay nothing). Custom reminders run last in the island's alert chain and only through `reminderGate` (12 a day, the rule's cap, the 15-min gap). The Windows wallpaper is off by default and is set by one fixed PowerShell script whose picture path comes in the `LS_WALLPAPER` environment variable, through `execFile` with no shell, after `validImagePath`; only pictures you picked (sent from this device's IndexedDB into the app's folder, or a folder you picked with the Windows dialog); your old wallpaper comes back when switched off.
- **Why:** one owner of the data and the pay rules, an untouched Center keeps today's island, and no user text can ever become a command.
- **Rules out:** the island reading the set-up or logging by itself; new points for Center taps or reminders; a custom reminder outside the gate or over the caps; building a shell command from a path; downloading wallpapers; a native module for the wallpaper.

### Quick add: one router, existing writes, ids from the start (2026-11-08)
- **Decision:** every quick-add line goes through `core/quickRoute.ts` to an EXISTING write (water, body-log reps, food counter, Todoist quick add, focus, notes, habit tap, the bot's money rules); quick add has no store and pays no points. The toast shows before the write (`core/quickQueue.ts`); each line carries its id from the first try, retries reuse it, and only id-safe routes are replayed after a reload (others show "Not sure it saved"). Log words like "yesterday" are refused. The desktop's global-shortcut window only sends lines; the app window writes them.
- **Why:** the owner found adding things slow; a second log or a quick-add-only points rule would drift from Sport Track, Food and Habits, and an optimistic retry without a fixed id would count twice.
- **Rules out:** writing from the quick-add window, a quick-add table or setting for the logs, back-dated quick logs, auto-retrying a task/focus/note after a reload, or a global shortcut that is Ctrl+Alt+<key> or one the island owns.

### Custom Center is data only, and counters log through the real logs (2026-11-08)
- **Decision:** the Custom Center set-up (`custom_setup`) is plain, versioned JSON cleaned by `core/custom/validate.ts`; migrations step one version at a time (`migrate.ts`) and a set-up from a newer app is never overwritten. Actions are a closed list of steps that call the app's own operations (focus timer, music station, island quiet, Do Not Disturb, a mode, a page, a counter): no code, no shell, no links. A counter that tracks water or reps writes only to the existing logs (water log, Sport Track reps + workout log), so their own rules decide any points; a purely custom counter pays nothing. Uploaded pictures and sounds stay in this device's IndexedDB, referenced by `local:<id>`, and are dropped from exports. Custom reminders pass `reminderGate` (call, focus, quiet, bedtime, gap, caps).
- **Why:** imports and synced data must never become a way to run code, and points must stay honest.
- **Rules out:** script steps, URLs or webhooks in actions; a second water or reps counter; points paid by a counter, action or reminder; pictures or sounds in the synced setting.

### Food from Telegram is previewed first; one food push a day (2026-11-08)
- **Decision:** a pasted AI reply on Telegram always becomes a preview (Save / Edit grams / Cancel) and is saved only through the food counter's own `addFoodMeal`, so it is the same data as Body → Food. Ben sends at most ONE food push a day (`food:` keys in `ben_pushes`): the evening protein nudge or the dinner reminder, on the one push channel, never in a meeting, quiet hours or after bed, with "Mute food nudges for 7 days". The Sunday food report rides in the weekly message. Food pays no points.
- **Why:** an AI's guess saved without a look would put wrong numbers in the one protein number that the ring, the weekly report and "why it stalled" all read; the owner wants food help, not a nag.
- **Rules out:** saving a pasted reply directly, a second food store or Telegram-only meal format, more than one food push a day, food pushes that ignore the push rules, points for logging food.

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

### Todoist's newer change wins; a task that moved away is not a done task (2026-11-09)
- **Decision:** a waiting app edit keeps only what Todoist hasn't changed itself since (`reconcilePatch`):
  a field Todoist changed after your edit keeps Todoist's value, a task done or deleted there drops the
  edit. A plan task missing from today's list is looked up (change check, else `{op:'lookup'}`): only a
  really done one (a recurring one done today included) is ticked; moved to another day or deleted, it
  leaves the plan (its block too unless pinned; an approved block's event is cleared, Todoist is not
  written back); not known → left alone. Linked must-dos follow Todoist the same way and a must-do done in
  Todoist is ticked without the must-do coins (`FocusService.followTodoist`; the Todoist task pays by its
  own rule).
- **Why:** a task moved to tomorrow in Todoist was ticked as done in the plan (and its block stayed), a
  failed edit could hide a newer Todoist change forever, and due times with a fixed time zone were read
  as UTC.
- **Rules out:** treating "not on today's list" as done, guessing when Todoist doesn't answer, sending a
  Todoist rename or a "clear time" back for a task that moved itself, or paying the must-do for a task
  ticked in Todoist.

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


### Food goals are slow muscle gain; one-tap logging writes the same meals (2026-11-09)
- **Decision:** the food goals are slow muscle gain: 1.8 g/kg protein, maintenance +350 kcal once a weight and the owner's own height and age are known, else a fixed 2,700 kcal / 125 g; the weekly weight and waist check suggests +200 or −150…−200 kcal (Apply, within ±600). The move from "lean" runs once (`food_goals.gainV`) and keeps every saved value that is not an old app default. Saved foods, saved meals and the standard day live in the synced setting `food_saved`; every tap becomes a normal food-counter meal through `addFoodMeal` (source 'saved'), so Undo, the one protein number and the week all stay one system. Meals carry a `source`; old meals read as 'manual' and are never rewritten. The owner's real height and age are not in code.
- **Why:** the owner ate about 1,000–1,300 kcal and 45–60 g protein a day and was not growing; the lean plan (+150 / +0) kept him under-fed, and logging had to take one tap.
- **Rules out:** a second store or meal format for saved meals, points for food, rewriting old meals, putting the owner's body data in code, or a weight-check change applied without a tap. (This replaces "a bulk-sized surplus by default" in the 2026-11-08 food decision: +350 is a slow gain, not a bulk.)

### Food counter: numbers in body_log, details in a capped setting, no image AI (2026-11-08; image AI part replaced 2026-11-09, see "Food photos")
- **Decision:** a meal is two rows in the one body log (`protein:food`, `kcal:food`, ids `<meal>-p` / `<meal>-k`) and its foods in the synced setting `food_log` (45 days, 400 meals, 20 stars). Protein stays ONE number (`proteinOfDay` of every `protein:*` row). The app never calls an AI for food: it copies a prompt and parses the pasted reply with code. Goals are lean (2.0 g/kg; maintenance +150 kcal on a training day, +0 on a rest day).
- **Why:** body_log already merges across devices by row id and feeds the ring, the weekly report and "why it stalled"; a new table would need a schema bump and a bot bundle rebuild. The owner wants no image-AI cost and no fat gain.
- **Rules out:** a second protein total, a kcal or meal table without a migration plan, a paid vision call, or a bulk-sized surplus by default.

### Body has one food system and a one-line-per-tab shell (2026-11-08)
- **Decision:** Body → Metrics & Workouts shows food only through the food counter (Food tab, and its
  rings on Today); the old protein card is not on Body. `pages/Body.tsx` renders each tab as one
  component, and all Body tabs share `body/body-theme.css`. "Rest day" is decided in one place
  (`core/readinessDay.ts` `dayState`) and is never shown after a workout today unless you tapped it.
- **Why:** the owner saw two protein counters ("Protein 0/120" twice) and "Rest day" next to "You
  trained today"; three builders work on the Body tabs in parallel.
- **Rules out:** a second protein or water counter on Body, a rest-day label computed per card, or
  tab contents written inline in `pages/Body.tsx`.

### Island reminders may play sound without a click; eye breaks on by default (2026-11-08)
- **Decision:** the island window runs with `autoplayPolicy: 'no-user-gesture-required'`. Body
  reminders (water, eye break, move break, screen break) open as the full card in every mode and play
  their own sound once, decided by `reminderPlan` (`core/islandReminderSound.ts`) after the usual gates.
  Eye breaks are on by default; a saved "Peek for → Eye breaks" off from before `PEEK_FOR_V` 2 is read
  as on once, and a choice saved after that is kept.
- **Why:** the owner got no real sound and only faint lines for eye and water reminders. In Calm every
  click passes through the island, so Chromium never unlocked its audio; eye breaks were off twice.
- **Rules out:** relying on a user gesture for island audio; playing a reminder sound when the card
  waits as a dot, in a call, focus, class, quiet hours or after bed; ringing the same card twice.

### Island looks come from one adapter; island buttons use the existing actions (2026-11-08)
- **Decision:** the island reads every look and widget switch through `src/renderer/src/island/lookAdapter.ts`
  (types and cleaning in `core/islandLooks.ts`); the Custom Center plugs in with one `setLookSource` call.
  Instant buttons, counters and the drop zone send only the existing `reps`, `water`, `start`, `clipSave`
  and `undo` actions.
- **Why:** the Custom Center is built in parallel, and island taps must keep the same pay rules, caps and
  Undo as everywhere else.
- **Rules out:** the island importing `src/core/custom/*` directly, an island-only way to log reps or water,
  or new points for island taps.

### A reward bought with points is never real spending (2026-11-08)
- **Decision:** redeeming a reward spends points only. Nothing goes to Finance Helper and nothing counts
  against the fun budget unless the owner turns on "I paid real money" in the buy sheet and types the
  amount (`paid` defaults to 0 in `Shop.redeem` and `life.shop.redeem`). A reward's `realCost` is only a
  price guide. Old `life-reward-…` records leave Finance only through the owner's Remove tap.
- **Why:** a 15 lei "hour of gaming" bought with points showed up in Finance as real spending and Ben
  counted it in today's money; the owner: "that's not physical money".
- **Rules out:** defaulting `paid` to the real cost, sending a points buy to Finance Helper, or deleting
  reward records from Finance without the owner's confirm.

### Body Training keeps its week, ladders, levels and sessions inside Sport Track's state (2026-11-09)
- **Decision:** the weekly split (`trainWeek`, versioned `v: 1`), edited ladders (`trainLadders`), levels
  (`trainLevels`) and the session log (`trainLog`) live in Sport Track's state and sync with it
  (`sport_tracker_json`); `mergeTrain` (core/trainLog.ts) joins sessions by id and takes the newer edit for
  the rest. Sets stay in the one set log (`sets[day][exerciseId]`) with optional `rir`, `feel`, `session`.
  The split is the default schedule on the Training tab; the program builder stays for moves, sets and
  equipment. Moves the library has no demo for are in `TRAIN_MOVES` (how-to text, no art) and their Sport
  Track exercises carry `move: 't:<id>'`, which `moveOf` never guesses from the name.
- **Why:** a new synced setting key needs its own API, web bridge and desktop handler (files outside the
  Body area); the sport state already syncs, merges sets by id and is what every Sport view reads. The
  `t:` tag stops "Wall handstand press" from counting as push-ups in Sport Track's levels.
- **Rules out:** a second set store, new points for sets, levels or level-ups (a finished session pays only
  the usual "Workout done", once a day), adding the extra moves to `MOVES` without real demos.


### Training warnings stay calm and act only through existing settings (2026-11-09)
- **Decision:** recovery, the streak and the warnings are pure rules over data already saved (Sport
  Track's sets, the training log, the food counter's kcal, `body_comp`), read only. The two new pieces of
  state, `trainLighter` (a 7-day lighter week) and `trainWarnDismiss` (hidden for a week), live in Sport
  Track's state next to the other training fields. A lighter week changes the dose only through the usual
  dose setting (`bodyPlus.setDose('light')`, once a day, never over a pick you made that day). Dots are
  small and soft; the streak is never broken by a rest day.
- **Why:** no new table, setting key or API file; one place decides today's dose; the owner wants guidance,
  not alarms.
- **Rules out:** points for streaks or recovery, red alarm banners, writing food or body data from
  Training, or a second dose store.

### Smart-scale weigh-ins live in body_comp; body_metrics stays the day's weight (2026-11-09)
- **Decision:** each weigh-in is a row in its own table `body_comp` (migration 023), id made from the
  dedupe key (time to the minute in UTC + weight to 0.1 kg), later `updated_at` wins. Every write also
  sets that day's `body_metrics.weight` to the first morning weigh-in and the waist to the newest given,
  but never replaces a weight that came from elsewhere that day and never touches other days. The
  headline is the weekly average (3+ weigh-ins a week); fat and muscle are shown only smoothed and
  labeled as estimates. Body logs pay no points.
- **Why:** a scale gives many numbers several times a day, too much for a setting or `body_log`'s
  integer amounts, and the same weigh-in will arrive twice (typed now, synced later). Everything that
  already reads `body_metrics` (weight trend, protein and food goals, Telegram) keeps working unchanged.
- **Rules out:** writing scale data into `body_log` or a setting, a random id for a weigh-in, daily
  weight as the headline number, or red alarms on body numbers.


### Telegram meal photos use the website's vision call, in-process, and are never kept (2026-11-09)
- **Decision:** a meal photo sent to the bot is read by the same `foodPhoto` function as
  `/api/ai {op:'foodPhoto'}` (api/telegram.mjs hands it to the bot as `env.foodPhoto`), so the
  50-photos-a-day counter, the monthly AI budget and the `core/foodVision.ts` check are shared. The
  photo lives only in memory for that one request: never in the database, a setting, a log or a reply.
  Only the owner's chats get a download or a vision call. Meal reminders share the one food mute and
  the one push log (`meal:<day>:<kind>`, max 3 a day).
- **Why:** one limit and one validator for every way of sending a photo; a second path would double
  the AI spend and drift from the website's numbers. A stored photo would be private data in a synced
  database for no gain (only the foods you save matter).
- **Rules out:** a separate vision prompt or provider for Telegram, a new `api/` file for it, caching
  or saving photos, or meal reminders with their own mute or their own dedupe store.

### Every island notification that drops down rings; dots stay silent; the Day page has one of each (2026-11-09)
- **Decision:** one rule (`core/islandCardSound.ts cardSoundPlan`) decides the sound for every island
  alert that peeks (slim line or card): once, at the Island reminders volume (not the app's main volume
  or Sounds switch), with a switch per kind; a dot never rings; every skip is written to the island log.
  The island may start audio without a click (`allowEagerAudio`, plus the `autoplay-policy` switch);
  if its audio won't run, the app window plays the sound, a system beep only without one. The Day page
  shows one Today list, one quick row (water, push-ups, focus) and the owner's Custom Center widgets,
  which replace the matching built-in control; everything else sits behind More (not drawn until opened).
- **Why:** the owner heard nothing for most notifications even after the autoplay change: the real
  causes were ~5 % loudness, a bell waiting for a click, an unawaited resume and no log of skips. The
  Day page repeated the to-do list and water in up to five places and felt slow.
- **Rules out:** per-surface sound rules (a second bell when the panel is open), notification sounds
  tied to the app's main volume, built-in water / push-up / focus buttons next to a widget that does the
  same, and putting new cards on the Day page outside More without removing a repeat.

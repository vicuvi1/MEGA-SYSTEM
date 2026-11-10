# Focus boost

> Push ladder, "why I'm stalling" fixes, launch kits, session goal and verdict, workout-only music,
> morning countdown, Dojo mode and win music. Written from commit c8d389e (it had no handoff section).
> Start at [`docs/INDEX.md`](../INDEX.md).

- **Code:** pure logic in `src/core/` and the UI in `src/renderer/src/boost/`. Synced settings are `focus_boost` and `focus_log`. No schema change. Settings live in Settings → Ben → **Focus boost** (three panels: Focus boost, Launch kits, Win music). Tests: `src/core/pushLadder.test.ts` and `src/core/focusBoost.test.ts`.
- **Push ladder** (`pushLadder.ts`, island side in `boost/boostFeed.ts`):
  - Three steps, each with its own sound (Settings → Sound): a soft chime, then a sharp alarm, then a horn plus Ben's voice line plus a Telegram message.
  - It starts on PC-coach drift, or when a focus block started 12+ min ago with no timer. It resets the moment you start.
  - The area push level sets the pace: Soft stops at step 2, Normal climbs every 8 min, Hard every 5. Quiet hours and meetings hold it.
  - The step-3 stake (Ben's 25 min / 50 pts deal) only happens on a tap.
  - An explicit Skip never starts a ladder; it opens the stalling question.
- **Why I'm stalling** (`stallFix.ts`):
  - Shown after "10 min later" or Skip on the push card, the island or Telegram (callback `sl|…`).
  - Fixes: tired → a 10-min light timer · unclear → 5 min to write the next step · too big → Ben's break-down · boring → boring-task music plus the pinned reward · scared → a 5-min start.
  - Reasons are logged. Tired and boring also go to Ben's desk excuses.
- **Launch kits** (`launchKit.ts`, `boost/launch.ts`):
  - Each kit is matched by kind of work or by words in the block title.
  - On desktop, it opens through the checked "workspace" call in `src/desktop/automations.ts`. "Close on end" closes only the apps the kit opened.
  - On the website, kits can only open links, and browser tabs can't be closed.
- **Session goal and verdict** (`sessionGoal.ts`, `boost/FocusBoost.tsx`):
  - When any timer starts, it asks for a one-line goal. At the end it asks Done / Half / Not.
  - The verdict is saved as a block result that `benLearn.ts` reads. Insights shows "Finished work". Points never change.
- **Workout-only music** (`musicOnly.ts`, `boost/musicGate.ts`): a chip per station on the Music page cycles any time / workout only / boring only. The island player pauses marked music outside its timer.
- **Morning countdown** (`morningLaunch.ts`): after the wake-up or the morning brief, the island shows water → push-ups → the first must-do within 2 min, with its kit. Water and push-ups are logged only when tapped.
- **Dojo mode** (`dojo.ts`, `boost/Dojo.tsx`):
  - Three scenes from the wallpaper art, a breathing ink ring timer and an optional rain or hum sound.
  - It ends with a bow. It respects reduced motion, Esc leaves, and the timer keeps running.
- **Win music** (`winMoments.ts`, `boost/wins.ts`):
  - Off by default. Clips are 10–30 s, at most once per 10 min.
  - Never during meetings, quiet hours or music that is already playing.
  - Hooked to level-ups, finished Sport Track workouts and goal milestones.
  - It also listens for `life-win` with kind `season`/`boss`, but the Season page doesn't send that event yet.
- **Telegram plan buttons:** −30/+30 go through `planEdit`. A pinned block answers "📌 pinned, unpin it in the app".

### Study Time (2026-11-10, desktop first)
A time tracker in the style of Focus To-Do: **Plan → Study Time** (sidebar and Ctrl+K). Pure rules in `src/core/studyTime.ts` (tested), the database side in `src/main/studyTime.ts` (`StudyService`, tested; outside the bot bundle), the page in `pages/StudyTime.tsx` + `study/`, the island in `studyTimeIslandFeed.ts`.
- **One timer.** A block runs as the focus timer (`focus_running` gets `blockId`, `open`, `breakMin`); a break is the timer's pause, so it never counts as study and every other timer view (Today, peek, Focus boost's goal and verdict) keeps working. A second start is refused. The running timer is the stored start time, so a reload or restart loses nothing.
- **Blocks** (synced setting `study_blocks`): name, category (with a colour), up to 6 tags, an optional planned length (none: an open stopwatch up to 4 h), quick (on top and on the island), a day (Today / Tomorrow / any day), done, and an optional linked Todoist task (linked by id, never copied; the timer then carries the task, so the usual "Done?" works). An empty store gets three made-up starter blocks once. Filters: Today (no day, or due), Tomorrow, This week (to Sunday), All, Completed, and each category and tag with its total time.
- **Sessions** stay `focus_sessions` rows (Insights, Ben and the week report see them). What Study Time adds per session (block id, break minutes, source `timer` / `manual` / `fixed`) is the synced setting `study_log`, keyed by the session's start time (at most 3000, 400 days). No schema change.
- **Caps and the overnight rule:** a stop counts at most planned + 30 min, never past 4 h (the focus timer's own rule). A timer that ran past that cap, or into a new app day (04:00) with over an hour on it, shows "Still running since …?": you give the real end time (saved on the day it began, capped, **no points**) or drop it.
- **Points:** a normal Stop pays like any focus timer (live time). Typed-in sessions (Sessions tab, last 14 days) and a forgotten timer put right pay nothing; changing the minutes or day of a paid session gives its points back and makes it a typed one; removing a session takes back what it paid.
- **Stats:** Day / Week (from Monday) / Month / Custom (at most a year). The donut (the shared `Donut.tsx`, also Money's "Where money goes") groups by category, tag (a session with two tags counts under both) or block; tap a part or row to see it in the middle; the change is against the same length before. Also: studied, sessions, average session, breaks (apart), streak and best streak, against plan (sessions of blocks with a planned length), best day, a bar per day, top 5 blocks.
- **Reminders:** at the planned length and when a break with a length ends, the app shows a note (`StudyAlarm`, `alarmDue`, once each) and plays `focusEnd` only when there is no island. On the desktop the island rings: the planned end is the timer's usual time's-up card, a break end is "Break's over" (kind `over`: ▶ Back to it, +5 min, Stop & log).
- **Island:** while a block runs, the pill, the bubble and the panel's timer count **up** (time studied; on a break with a length, the break's time left). The panel's timer card has Stop & log and ☕ 5 / ☕ 10 (▶ Back to it on a break). With nothing running, the timer slot shows your quick blocks (one tap starts one) and today's minutes (`studyTime` in the snapshot; action `studyTime` with op `start` / `break` / `back` / `stop`). A plain Stop on a study block goes through Study Time so its break minutes are kept; a Stop from the bot or Today logs the session without them.
- On the website the page works the same on the same data; the in-app timer bar never dims the Study Time page.
- Smoke: "Study Time: start a block → …" (start, counts up, survives a reload, a break holds the clock, back, stop, donut by category and tag, the session listed, each tab ≤ 1.575 screens) and "Study Time on the island: …".

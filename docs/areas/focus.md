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

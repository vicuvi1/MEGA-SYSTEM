# Sport Track redesign v2: audit and plan

The current state is release v1.4.1445. Nothing in the code has been changed yet; this is the plan for review.

## 1. What exists today (audit)

| Area | What is there |
|---|---|
| UI | `src/renderer/src/training/`: 11 components (SportDashboard 496 lines, SportWorkout 436, GrowthView 313, SportProgress 312, SportExercises 229, WorkoutFlow 218, SwapSheet, GearView, MovePic, SportMenu, SportMore). Styles are spread over **4 CSS files** (`sport-track`, `sport-batch-b`, `training-home`, `sport-menu`). |
| Engine | `core/trainLadders.ts` (6 ladders, **all linear**), `trainLog.ts` (double progression: 2 sessions at the top of the range, no Hard set, no "form broke" set, then you choose Apply or Keep), `trainGear.ts`, `trainSwap.ts`, `trainReadiness.ts`, `trainProgress.ts`, `growthCheck.ts`. |
| Old engine, still live | `sportLadders`, `sportProgress`, `sportProgram` and more drive the Classic tracker. That is **a second progression system**. |
| Media | `apps/sport/photos/`: **28 moves × 2 still frames** (480×384 WebP, Free Exercise DB, Unlicense). Models, backgrounds and framing differ between moves. Every other move is a drawn mannequin (`sportDraw.ts`). **No video.** |
| Data | Sets per day and exercise (reps, effort, `form: 'off'`), training log, ladder levels with history, gear in the synced sport state, food logs, body log. **All of it is kept.** |

## 2. The 10 biggest UX problems

1. **Weak exercise media.** Two still photos cross-faded is not a demonstration. Models and framing vary between moves, and about half the moves fall back to a mannequin. Nothing shows tempo or range of motion.
2. **The workout is not a focused mode.** It is a section of a page, with navigation and other cards around it. There is no clear "set 2 of 4, move 3 of 5" progress through the whole session.
3. **Controls are too small for a tired person.** Reps go in a small number box, and the effort taps are small chips. There is no single giant "Set done" action.
4. **No pause, repeat or playback speed** for the demo, so you can't slow down to check form.
5. **Progress paths are linear only.** Real calisthenics branches. For example, push splits into decline → archer and into pseudo-planche, and legs splits into pistol and shrimp. There are no alternate or side moves at the same level.
6. **Progression ignores discomfort and recovery.** There is only a "form broke" flag, with no "pain/discomfort" input, and readiness never holds back a promotion. Undoing a promotion is hidden.
7. **Household objects carry no safety warnings at the moment of use.** Chair dips, door-towel rows and bed decline push-ups need a stability check: a chair against a wall, a door that closes toward you and is locked, and so on.
8. **Dashboard clutter and repetition.** The XP level ring, the coach box, the path, This week, three tiles and the roadmap compete with each other. The XP level looks like it controls progression, but it does not.
9. **Inconsistent visual system.** There are 4 CSS files with separate spacing and type scales, a mix of empty-state styles and different card paddings. There is too much empty space on some cards and cramped text on others.
10. **Two progression engines.** The Classic tracker and the new engine can disagree about "your level", which is confusing and costly to maintain.

## 3. Design system (Phase A)

- **Colour.** Life tokens: ground `#0c100d`, surface `#151b17`, raised `#1b221d`, line `#222a24`, text `#eef3ec`, muted `#a6b2a8` (≥ 4.5:1 on surface), lime accent `#c6f432` used for one primary action per view, success `#9fd36b`, warn `#f0b35a`, danger `#ff8a7a`.
- **Type.** Space Grotesk for numbers and headings, Inter for body text.
  - Scale: 13 / 15 / 17 / 20 / 26 / 34 / 56 / 96 (the giant rep and timer digits).
  - Muted text is never below 13 px.
- **Spacing.** 4-point grid, using 8 / 12 / 16 / 24 / 32. Cards have 24 px padding and a 20 px radius, controls a 14 px radius.
- **Controls.** Primary buttons are at least 56 px tall in workout mode and at least 44 px elsewhere. Every icon button has a label.
- **Components.** All shared:
  - `ExerciseMedia` (video, photo frames or "no verified demo yet"; 16:10 aspect ratio, skeleton while loading, error fallback, honours reduced motion);
  - `SetStepper` (big − / reps / +);
  - `EffortPicker` (Easy / OK / Hard, with "reps in reserve" text);
  - `FormCheck` (good / form broke / pain);
  - `RestTimer`;
  - `SessionRail` (the progress of the whole session);
  - `PathGraph` (a branching node graph);
  - `UnlockCard` (checks, plus Apply / Later / Undo);
  - `SafetyNote`.
- **One stylesheet,** `sport.css` with tokens. The old 4 files are merged into it.

## 4. Component architecture

```
SportTrack (shell, tabs: Today · Workout · Exercises · Progress · Body & Food)
├─ TodayView          today's session card, unlock card, week strip, readiness, food mini
├─ WorkoutMode        full-window focus mode (Esc = pause, never loses data)
│   ├─ SessionRail    moves × sets, current one highlighted
│   ├─ ExerciseMedia  large, with play / pause / repeat / speed 0.5×–1×
│   ├─ SetPanel       set N of M, target, SetStepper, EffortPicker, FormCheck, big "Set done"
│   ├─ RestTimer      ring + −15 / +30 / Skip, sound at 0
│   ├─ SwapPanel      easier · harder · alternate (same muscles, your gear), with SafetyNote
│   └─ CompleteView   actual vs target per move, PRs, one recommended adjustment (Apply / Later)
├─ ExercisesView      PathGraph per skill (branches) + ExerciseDetail (media, how-to, gear, PRs, prerequisites)
└─ ProgressView       path progress, strength trend, PRs, Am I growing
engine (core/, pure, tested): trainLadders → becomes a graph (nodes + edges: harder / easier / alternate),
trainLog (progression decision), trainSafety (warnings per gear), trainMedia (media lookup + licence)
```

## 5. Adaptive progression rules (Priority 3)

- **Promotion is offered, never applied by itself,** only when all of these are true:
  - the last 2 qualifying sessions are at the top of the rep range on every working set;
  - effort is Easy or OK, which means 1 or more reps in reserve;
  - no "form broke" set and no "pain" flag;
  - at least 2 sessions in the last 14 days;
  - readiness is not low today. If it is, the offer waits.
- **Hold** when effort was Hard or reps were in the middle of the range. The aim becomes +1 rep on the lowest set.
- **Step down** when the bottom of the range is missed twice, or after a pain flag. A pain flag also suggests an alternate move, never a harder one.
- **After 10 or more days off:** about 70 % volume, ramping back up.
- **Accept, postpone (asked again after the next session) or undo** at any time. Undo restores the previous step and keeps every logged set.
- **XP and level** stay rewards only. They never decide a step.

## 6. Exercise media plan (honest)

- **Today:** 28 moves have 2 public-domain still frames, and the rest have none.
- **Proposed tiers,** shown with a small source tag on each demo:
  1. **Video** for the 15–20 core moves you actually do. Two honest sources:
     - **(a)** you record yourself once, 6–8 s loops in good light, in your own room with your own furniture, so the stability is real. The app supports this with a "Record demo" flow.
     - **(b)** properly licensed stock or open-licence clips that we have checked one by one. Paid stock needs your approval.
  2. **Photo frames:** the existing Free Exercise DB pairs, re-cropped to one 16:10 framing.
  3. **"No verified demo yet":** a clear empty state with written how-to steps. Never an AI image dressed up as technique.
- Every media item stores its source, its licence and "verified by". `ExerciseMedia` shows the source tag.

## 7. Phases

- **A.** This document plus the Workout screen visual (canvas). **← for your review now**
- **B.** Build WorkoutMode only, with the real components and the real engine.
- **C.** Run the app and take real 1920 and 1280 screenshots.
- **D.** Compare them with the approved visual, fix the differences, and take the screenshots again.
- **E.** Exercises (branching PathGraph and detail) and Progress, in the same system.
- **F.** Functional tests (progression, persistence, gear and safety), small-window layouts, the full smoke run and the Windows release.

## 8. Decisions needed from you

1. **Video source:** record your own (best and free), licensed stock (cost), or photos for now?
2. Should the **Classic tracker** be retired after its history is migrated, so there is one engine?
3. Should the **XP level ring** stay on Today, or move to Progress only?

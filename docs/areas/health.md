# Healthy day, sleep care and My life

> Nudge rules across surfaces, healthy day ring, My life, sleep care, desk, grooming.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

### Your healthy day (HD)


One set of rules makes the body nudges from every surface (island cards, Ben's Telegram rhythm, your reminders) work as one day. Logic: `src/core/healthyDay.ts` (the governor, the Healthy day ring, the evening line, the weekly card, wind-down mode, reminders) and `src/core/dayNudges.ts` (the island's chain, in one order); the app window runs it in `IslandFeed.tsx`; the island draws it in `IslandHealth.tsx`. `src/core/healthyDay.sim.test.ts` simulates a whole made-up weekday minute by minute and prints the timeline.

- **The rules.** No two nudges about the same thing within 30 min on any surface. Nothing during a call, a focus timer or a class (an event you go to); water and move breaks wait and come right after ("Done sitting through that: stand up and stretch?"). At most 3 interruptions an hour; more wait as a dot. Ben's Telegram message shows on the island only as a dot (it already reached you). From bedtime − 60 min only bed things (wind-down, the late nudge, one good thing). After you log bed: nothing but reminders you set. Quiet hours, the island's quiet mode, the daily caps, Calm/Off motion and the sound settings still apply.

- **Shared between surfaces.** The island writes when it showed water or wind-down into the synced `island_nudges` day (`lastAt.water`, `lastAt.bed`): Telegram's water nudge waits 90 min after the island's card and its wind-down message is skipped if the island just showed one. Water logged anywhere restarts the island's 90-minute water timer. The rhythm (`dueRhythm`) holds water and training during a class, a meeting or focus, and sends nothing after bed. The morning part of the quiet hours ends once you log the wake-up, so the plan comes at once.

- **Timeline of the simulated weekday** (bed target 23:00): 06:40 wake-up on Telegram → 06:50 the plan (Telegram; on the island only a dot) → 07:30 one morning card with last night's bedtime and "Up at 06:40" (no "I'm up") → class 08:00–09:30 silent → 09:30 the held-back move break → water and move breaks spaced through the long sitting stretch → lunch, "Moved?" → call 13:00–13:45 and focus 14:00–14:50 silent, a stretch right after each → the slump: posture, breathing, tidy, water → 18:00 "call mom" on the island and Telegram once, Done → 20:10 water goal reached, no more water, the Healthy day bonus → 21:00 Ben's review with the body line → 22:00 wind-down (island dims, countdown, calm music) → 23:30 "Still up?" and 00:00 a firmer one, then nothing → 00:40 bed → only your 00:45 reminder.

- **Healthy day ring** (Day page card and a small ring on the pill): water goal, 3 move breaks, 3 screen breaks (eye, calm, tidy, a walk after time away) and in bed on time last night (15 min grace). A streak of days with all four, and `body.healthy_day` (+5, once a day) paid only when all four are really logged; an undo the same day takes it back. The evening review on Telegram carries "Body today: …"; on Sundays the island shows "Your body this week" and Ben's weekly review adds it (water average, moves, breaks, bedtime consistency).

- **My life (Settings → Ben → My life, `core/lifeFit.ts`, synced `life_fit`).** Bedtime and wake time are the sleep targets (bedtime default 23:30), plus the latest bedtime (the late-night nudges fire there, then 30 min later). A work window (days, from–to, "I usually really work 1–3 h") is partly busy for the planner (`dayPacker.ts withWork`): never deep focus there, only the Quick tasks block; a model plan that breaks it falls back to the packer (`workClash`). "Short shift tonight" / "no work tonight" (Ben's chat, Telegram, the buttons on Today and the island's Day page) frees the window for that app day only (`readShift`, `saveTonight`). How hard Ben pushes: Gentle / Firm / Push (default Push) sets his tone and, within the existing caps, his daily Telegram messages and the island's interruptions an hour (`pushStyle`). Ben's prompt gets one MY LIFE line.

### Sleep care, desk and grooming (BD4–BD6, BD11, BD12, BD15)


Pure logic in `src/core/sleepCare.ts` (morning light, caffeine curfew, sleep debt), `afterShift.ts`, `deskMobility.ts`, `eyeCare.ts`, `grooming.ts` (tests: `sleepCare.test.ts`, `afterShift.test.ts`, `deskCare.test.ts`, `sleepCareChain.test.ts`). Data in the synced settings `sleep_care` and `grooming` (`src/renderer/src/web/careStore.ts`, `life.care` from `web/careApi.ts`); the island gets it through `careFeed.ts` into the one chain (`dayNudges.ts` `care`). Screenshots: `CARE_SHOTS=<dir> node e2e/careShots.mjs` (`E2E_CARE_DEMO=1` on the e2e server).

- **Morning light:** after the wake-up (or sunrise, if later) for 3 h, one island card: 10 min outside, 15 when cloudy, 20 when overcast or rainy (the weather plugin now saves the morning's cloud cover). Tapped done by you; also on Sleep → Points & stats.

- **Caffeine curfew:** a coffee log (☕ on Sleep, "coffee" / "2 coffees" / "☕" on Telegram and in Ben's chat, never an expense) and a last-caffeine time 8–10 h before bed (default 9.5: 14:00 for 23:30). A soft island card at the curfew on a coffee day, and right after a late cup.

- **After-shift wind-down:** when My life's work window ends within an hour of bedtime or later, the wind-down starts at the shift's end: 20 min, the island dim and warm (`afterShift` in the snapshot), a checklist (teeth, skin, alarm, phone away; teeth and skin also tick Grooming's night steps), "No new CTF tabs" first if the PC sees a CTF. The bedtime wind-down and the PC coach's bedtime guard stay quiet during the shift, the late nudges count from lights out, the evening shutdown comes at the shift's end, and Telegram's wind-down message is skipped that night.

- **Sleep debt:** the last 7 nights against your need (default 8 h, set on Sleep), never below 0; when behind, one 20-min nap before 15:00 and bed 15–60 min earlier on the next evening without work. On Sleep and in Ben's prompt (`careContext`). (Waky's own app has a debt card against its own goal; this one uses your need.)

- **Desk drill:** the posture nudge offers a 60-s drill (chin tucks, doorway chest stretch, hip-flexor stretch, wall angels) drawn with Sport Track's figure engine (none of the four is a Sport Track move, so no photos). Logged only on "✓ Done" at the end (`mobility` tally, no points).

- **Eye care:** eye breaks every 25/20/15/12 min by today's screen time on this PC, "blink and look far" (the pill blinks), a screen check every third break, and after sunset the warm-screen (Night light) tip until you tap it on. Points unchanged (`body.eye_break`).

- **Grooming:** the Skincare tile is now Grooming: a tap opens morning and night steps (SPF only on sunny days), weekly nails and a haircut every 3–5 weeks. It pays `face.routine_done` once (`groom:<day>`), only when every step is ticked; an untick takes it back.

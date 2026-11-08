# Custom Center

> Build and customise your own stuff: widgets, where they sit, actions, reminder rules, modes with schedules, looks, templates and a set-up file.
> Start at [`docs/INDEX.md`](../INDEX.md). Decision: "Custom Center is data only…" in [`DECISIONS.md`](../DECISIONS.md).

## Where things are
- **Pure logic:** `src/core/custom/` (tests in `custom.test.ts`, clock pinned).
  - `model.ts`: the types, the defaults and the limits.
  - `validate.ts`: `cleanSetup`, `cleanState`, `cleanLooks`, etc.
  - `migrate.ts`: versioned steps. `CUSTOM_VERSION` is 2: version 1 had no modes, so its single layout becomes the "Everyday" mode.
  - `modes.ts`: `activeMode`, `scheduledMode`, `nextModeChange`.
  - `reminders.ts`: `nextFire`, `reminderGate`, `noteFired`.
  - `counters.ts`: `counterRoute`, `localCount`, `toggleCheck`.
  - `layout.ts`: `activeLayout`, `widgetState`, `placeWidget`, `nudgeWidget`.
  - `actions.ts`: `planAction`, `runSummary`.
  - `templates.ts` and `exportImport.ts`.
  - `index.ts`: re-exports everything, plus `readSetup(raw)`.
- **Page:** `pages/CustomCenter.tsx`. It has tabs Build · Actions · Reminders · Modes · Looks · Templates · Export. It is in the sidebar under Life, and Settings → Look → Appearance has an "Open Custom Center" button.
- **Renderer parts:** `src/renderer/src/custom/`.
  - `customStore.ts`: one shared copy. Changes show at once and are saved in order. An undo stack holds up to 20 changes.
  - `runner.ts`: counter taps and action runs.
  - `LayoutBoard.tsx`: drag and drop, keyboard, and tap-to-place.
  - `views.tsx`: static drawings of a widget card and the pill.
  - `localFiles.ts`: pictures and sounds in IndexedDB.
  - `CustomBackground.tsx` + `customBg.css`: the app background.
- **Data:** two synced settings, both in `settingsKeys.ts`. Reached through `life.custom.get/save/saveState` (`tursoWebBridge.ts`).
  - `custom_setup`: the set-up, versioned, at most 48 KB. A set-up saved by a newer app is refused and never overwritten.
  - `custom_state`: today's numbers for custom counters and checklists, and when each reminder rule last fired.

## Rules
- **Honest points.** A counter routes each tap through `counterRoute`, and no route ever pays points by itself (`routePays` is always false).
  - `water` goes to `addWater`, the one water log.
  - `reps` goes to Sport Track's checklist (`updateSport`, logged to `body_log`) and its usual `logWorkout`. Any points come from that path's own rules, as with the Daily Quest banner.
  - `none` only changes `custom_state` and pays nothing.
  - Undo reverses the same path.
- **Actions** are a closed list of steps: focus, stopFocus, music, quiet, dnd, mode, open (closed list of pages), count.
  - Focus, quiet, Do Not Disturb and open pages go through `runSafe` (`smartIsland.ts`). That logs them in the island log with its 10-minute Undo.
  - Music uses the music station event. Mode and count are handled here.
  - Quiet and Do Not Disturb are desktop only. On the website they are skipped and the run says so.
  - The run's result line stays on the Actions tab with its own Undo.
- **Reminders.** `reminderGate` refuses or holds a reminder for any of these: rule off, the rule's daily cap reached, the day cap for all your reminders reached (12), between bedtime and wake time, in a call or meeting, a focus timer running, quiet on, or less than the gap since the last interruption (15 min).
  - `nextFire` handles "every N min" (from your last one or from when you sat at the PC, inside a window and on chosen days) and "at HH:MM" (still due later that day if the gate held it back).
  - Phase 1 only shows the next time on the page. The island will call the gate.
- **Modes.**
  - A schedule window has weekdays, a start and an optional end. An end before the start runs past midnight. No end means it lasts until the next window starts (24 h at most).
  - When windows overlap, the one that started last wins. With no window on, the base mode is used.
  - A mode you tap holds until a scheduled window starts after your tap, or until its `until`.
  - Each mode carries its own layout, look overrides, background, Windows wallpaper (stored for a later desktop phase) and reminder ids.
- **Templates** (Study, Gym, Night, Gaming) add a copy as a new mode, with fresh ids and a countdown 30 days out. Nothing of yours is replaced.
- **Export and import.**
  - The file looks like `{kind: "life-system/custom-setup", version, exportedAt, setup}`. `local:` picture and sound ids are removed.
  - Import refuses, with one plain sentence, a file that is empty, too big (200 KB), not JSON, not a set-up, from a newer version, or empty of usable parts.
  - Import replaces your set-up. Undo brings yours back.
- **App background.** It sits at z-index −1, above the Settings wallpaper when both are on, and sets `html.has-cbg`.
  - Choices: none, a gradient (2–3 colours and an angle, optional slow drift) or a picture kept on this device.
  - A page-coloured shade keeps text readable: at most 40 % shows through (`MAX_SHOW_THROUGH`, the same as the wallpaper).
  - The drift moves by transform only. It never runs with reduced motion and pauses while the window is hidden.

## For the island rebuild (phase 2)
- Read `custom_setup` with `readSetup(raw)`. Then:
  - `activeLayout(setup, now)` gives `{ mode, why, pill, island, home, looks, background, reminders, desktopWallpaper }`.
  - `widgetState(widget, { setup, state, real, now })` gives `{ value, sub, progress, done, color, icon, title }`. `real` holds `waterMl`, `reps` by exercise and a running `focus`.
  - `reminderGate(rule, todayCount, ctx)` and `nextFire(rule, now, fireInput(state, id, now, activeSince))` decide when a custom reminder may show.
- `Looks` holds what the island should apply:
  - `island {size, shape, radius}`;
  - `motion {style, speed, bounce, events{open, notify, celebrate}}`;
  - `colors {accent, glow, blur ≤ 12, theme}`;
  - `font {family, numbers}`;
  - `clock {style, h24, seconds, date, zone2}`;
  - `celebrate`;
  - `sounds {pack, volume, kinds, files (local ids)}`.
- Only the app background and the page preview use the looks today. The island itself does not apply them yet.

## Tests
- Unit: `src/core/custom/custom.test.ts` covers validation, migration, the mode scheduler, reminder next times and gates, counter routing (no points), layout, templates, and an export and import round trip with rejections.
- Smoke: the step "Custom Center" builds a counter, places it by drag and keyboard, taps it, runs and undoes an action, applies Study, checks the reminder's next time, exports and re-imports, refuses a broken file, switches mode by one tap, and checks there is no sideways scroll at 1280 and 390 px.

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
  - The page shows the next time; the desktop island fires them (see below).
- **Modes.**
  - A schedule window has weekdays, a start and an optional end. An end before the start runs past midnight. No end means it lasts until the next window starts (24 h at most).
  - When windows overlap, the one that started last wins. With no window on, the base mode is used.
  - A mode you tap holds until a scheduled window starts after your tap, or until its `until`.
  - Each mode carries its own layout, look overrides, background, Windows wallpaper (a picture and an evening picture) and reminder ids.
- **Templates** (Study, Gym, Night, Gaming) add a copy as a new mode, with fresh ids and a countdown 30 days out. Nothing of yours is replaced.
- **Export and import.**
  - The file looks like `{kind: "life-system/custom-setup", version, exportedAt, setup}`. `local:` picture and sound ids are removed.
  - Import refuses, with one plain sentence, a file that is empty, too big (200 KB), not JSON, not a set-up, from a newer version, or empty of usable parts.
  - Import replaces your set-up. Undo brings yours back.
- **App background.** It sits at z-index −1, above the Settings wallpaper when both are on, and sets `html.has-cbg`.
  - Choices: none, a gradient (2–3 colours and an angle, optional slow drift) or a picture kept on this device.
  - A page-coloured shade keeps text readable: at most 40 % shows through (`MAX_SHOW_THROUGH`, the same as the wallpaper).
  - The drift moves by transform only. It never runs with reduced motion and pauses while the window is hidden.

## On the desktop island (phase 3)
- **One view in the snapshot.** The app window (`renderer/src/custom/centerFeed.ts`, called from `IslandFeed.tsx`) builds `snap.center` with `centerIslandView` (`core/islandCenter.ts`): the mode on now, the other modes, the looks as island looks, and the pill and open-island widgets as ready cards. A set-up never saved and with no widgets sends nothing, so the island stays as it was.
- **Looks.** `centerLooksToIsland` turns only the parts you changed from the Center's defaults into island looks. The island plugs them in with `setLookSource` and calls `looksChanged()` on every change (`island/centerLook.ts`). Applied: size, corners, spot (top left / centre / right, once per change, a later drag still wins), open island size (never past the screen), motion, accent, glow, blur, font, numbers (Digital = monospace), clock, celebration, sound pack and volume per kind, your own sounds. The island shape and theme stay in Settings → Widgets → Island look.
- **Widgets.** The pill shows up to 3 chips while nothing live is on (a timer, music, a meeting soon come first). A tap on a counter chip adds its first step. The open island's Day page has the mode chips and your cards: counters with their + buttons and a scroll-to-number counter, checklists to tick, a timer that starts its focus block, countdowns, rings and the clock. The hover peek repeats your pill counters with their buttons.
- **Taps.** One island action `{kind: 'center'}` (count, check, mode, timer, remind). The app window answers with the Center page's own runner: counters go through `counterRoute` (water log, Sport Track reps + workout log, or only `custom_state`, which pays nothing). Counter taps show at once and have the usual Undo.
- **Reminders.** `centerReminderTick` runs last in the island's alert chain, so it only fires when nothing more important shows. Only rules of the mode on now, when `nextFire` says due (or an "In 10 min" came round), and only through `reminderGate`: a call or class, a focus timer, quiet time, bedtime, 15 min since the last card, the rule's cap and 12 a day. A fired rule is noted at once (`noteFired`). Its card (`custom:<rule>:<time>`) opens as a real card in Calm too, stays 3 min, rings once with your reminder sound (or the reminder bell) unless hushed, and has Done (adds its counter amount if set) and In 10 min.
- **Modes.** A schedule change is caught by one timer to `nextModeChange`; a tap goes through at once. The island swaps widgets, looks and sounds with a short glow (opacity only; none with reduced motion).
- **Windows wallpaper (desktop, Windows only, off by default).** Modes tab → "Change my Windows wallpaper". Each mode: a picture, an optional evening picture (20:00–06:00), or a folder on this PC to rotate (every 15 min to once a day). See `docs/desktop.md`.
- **Names.** No two widgets with the same name in one mode's layout: `cleanSetup` gives the later one " 2" (`uniqueLayoutNames`). The Study template's ring is "Study progress", the Gym ring "Push-up goal".

## Tests
- Unit: `src/core/custom/custom.test.ts` covers validation, migration, the mode scheduler, reminder next times and gates, counter routing (no points), layout, templates, and an export and import round trip with rejections.
- Unit: `src/core/islandCenter.test.ts` covers the looks on the island, the view per mode, counter routing and the instant change, reminder firing with gates and caps; `src/desktop/wallpaper.test.ts` the wallpaper paths and command (a fake execFile).
- Smoke: "Desktop island Custom Center" (counter chip logs, size and corners resize the pill, a mode switch swaps the widgets, a reminder card rings once). The step "Custom Center" builds a counter, places it by drag and keyboard, taps it, runs and undoes an action, applies Study, checks the reminder's next time, exports and re-imports, refuses a broken file, switches mode by one tap, checks the Study widgets have their own names, changes the island size, corners, spot and open width, and checks there is no sideways scroll at 1280 and 390 px.

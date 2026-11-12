# How to work

> Commands, the smoke test clock, UI rules (Select, PageTabs, zoom, wallpaper), the motion and sound budget.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

## 5. How to work


```bash
npm ci                              # Node 22 (.nvmrc, engines)
npx tsc --noEmit -p tsconfig.json   # typecheck
npx vitest run                      # all tests must pass (~900)
npm run build:web                   # web app
npm run build:bot                   # server bundle api/_bot/bot.mjs (commit it!)
npm run smoke                       # the real app on fake data (e2e/smoke.mjs + e2e/server.mjs)
bash scripts/ship.sh <message-file> # typecheck, tests, bundle, commit, push
```

- The smoke test runs on a fixed clock: today at 08:30 local time, in the browser and the fake server (`E2E_NOW=14:00 npm run smoke` tries another time). A step that needs a certain hour sets it itself (`atTime` in `e2e/smoke.mjs`); never hand a page the real `Date.now()` from the test (use `fakeNow()`). Unit tests that depend on the hour pin it with `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(...)`.
- Only push to `main` when typecheck and **all** tests pass. A push deploys straight to production.
- After pushing, check the Vercel deployment is READY, then `/api/cron?job=tick` with `Authorization: Bearer <CRON_SECRET>` should return `{"ok":true,…}` (without it: 401).
- Commit with the owner's git identity as configured on the machine (never write a personal email into the repo). Before pushing: `git fetch origin main && git rebase origin/main`. Never force-push.
- Local testing: a fake Turso is in `src/renderer/src/web/fakeTurso.ts`; the bot bundle exports `coachChat`, `runTick`, `handleTelegramUpdate`, `coachRhythm`, `coachUndo`, `sportShared` for end-to-end tests with a fake model.
- Check UI changes at desktop width (1280–1440 px) first, then phone (390 px).

- **Drop-downs:** use `Select` (`src/renderer/src/Select.tsx`), not a plain `<select>`: same children (`<option>`, `<optgroup>`) and `onChange(e)` with `e.target.value`, keyboard and screen-reader friendly, its list placed on screen. A plain `<select>`'s system list came out white with faint text on Windows, so the leftovers (island window, embedded apps) get solid option colours (`select.css`, `island.css`, `EmbedHost.tsx`). The smoke test checks option contrast in dark and light.

- **Page tabs (no long scrolling):** long pages use one switch, `PageTabs` + `TabPanel` + `usePageTab` (`src/renderer/src/PageTabs.tsx`, pure parts in `core/pageTabs.ts`): segmented, sticky at the top, a sliding highlight (transform only), small counts, ←/→ on the switch and 1–9 on the page, the last tab kept per device (`ls.tab.<page>`), deep links (`openTab(page, tab)`, `?page=today&tab=body`, Ctrl+K entries in `TAB_LINKS`). Every panel stays mounted; only the chosen one shows. Today: Now · Plan · Tasks · Body · Week (+ Day on screens under 1100 px; "Your day" stays on the right otherwise); one `DayFlow` draws the rest of today's tasks into the Tasks tab through a portal. Also Insights, Goals, Money, Discipline, Music, Rewards, and long Settings sections (`tabs` on a `SettingsGroup`, cards picked by their heading; Desktop & island gets a jump bar, `jump`). The smoke test clicks every tab at 1280×720 and checks it fits about one screen.

- **Zoom:** `core/zoom.ts` (steps 67–200 %). Desktop: `src/desktop/zoom.ts` (Ctrl + / - / 0, Ctrl + wheel, isolated so the island never zooms, saved per screen in `zoom.json`). Website: Settings → Look scales the page with CSS zoom (`zoom.tsx`, `ls.zoom`, capped so the page stays at least 1024 px wide); the old "Text size" is where it starts.

- **Wallpaper:** Settings → Look → Wallpaper. 24 original SVG pictures in groups (anime style, samurai, space saga, cyberpunk, nature, minimal) drawn from code by `scripts/wallpapers/build.mjs` into `src/renderer/src/wallpaper/art/` (no franchise names, characters, ships or logos; keep it that way, the repo is public), plus "Your own picture" (made small on the device, synced). The choice is the synced setting `look_wallpaper` (cleaned by `core/wallpaper.ts cleanWallpaper`), the picture `look_wallpaper_photo`. `WallpaperLayer.tsx` draws it behind the app (z-index -1) with a page-coloured shade: at most 40 % of the picture reaches the text (`MAX_SHOW_THROUGH`, tested for AA). Strength, blur, shade, Everywhere / Only on Today, Match light and dark, and Gentle motion (off by default; a slow drift and rain, stars, petals, snow or leaves, never with reduced motion, paused while hidden).

- **Ben's face** (`BenBubble.tsx`) tucks into the right edge while you scroll down or while a button or box sits under it; pages keep room for it at the bottom (`.content.has-bb`).

- **"Backup missed"** in the top bar means this device's attempt at today's cloud backup failed (`life_snapshot_error`); it clears itself once today's backup is in the cloud (the server makes one every day too). Hover says why; a click opens Settings → Backups & data.

### Motion & sound budget


The app should feel alive but stay light on the PC and the battery.
`src/renderer/src/motionBudget.test.ts` reads every stylesheet and enforces the CSS rules.

- **Animate only `transform` and `opacity`.** No keyframes on width, height, margins, `box-shadow`, `filter`, `background(-position)`. A glow, ring or flash is drawn once (a shadow or tint on `::after`) and only its opacity or scale moves (`fx-breathe`, `fx-flash`, `fx-ping` in `motion.css`). Exceptions sit in the test's `EXCEPTIONS` list with a reason (today: SVG `stroke-dashoffset` for the drawn tick and chart lines).

- **Progress bars move by transform:** `.pbar` + `barFill(fraction)` (`motionKit.tsx`): a full-width pill slid by `translateX` inside a clipped track. Never transition `width`.

- **No `transition: all`**: name the properties. No transitions on layout properties. No `will-change` on width/height.

- **Toasts stay calm** (`core/toastQueue.ts`, shown by `ui.tsx`): at most 2 at a time; a new note replaces the older note, a new error the older error; Undo toasts merge ("2 changes", one Undo that undoes both, newest first); an error never pushes an Undo toast away.
- **UI motion takes 400 ms or less** (presses, toasts, page switch, bursts, count-ups). Looping effects are for "something is live right now" only.

- **Nothing animates while hidden:** `html.doc-hidden` pauses every CSS animation; JS motion uses `requestAnimationFrame` (stops by itself in a hidden window), never a fast `setInterval`. The desktop app window is throttled in the tray (`backgroundThrottling: true`); the desktop sends `island:tick` every 15 s so the island stays fresh.

- **Reduce motion:** one `@media (prefers-reduced-motion: reduce)` block in `motion.css`, plus `<MotionConfig reducedMotion="user">`. JS effects check `reducedMotion()`.

- **Framer:** the app uses `m.` components under `<LazyMotion strict>` (`MotionRoot`); its animation code loads after the first paint. No `motion.` components, no `layout`/`layoutId` in the app (that needs the big bundle): only the desktop island window uses full framer. The PIN screen uses no framer.

- **Blur:** `backdrop-filter` blur 12 px at most, no `saturate()`.

- **Success moments:** `celebrate(el, kind)` in `fx.ts` (one shared canvas, ~12 dots, under 400 ms). `feedback(kind)` / `onFeedback()` is the one hook for the matching sound.

- **Sound:** one `AudioContext` per page, owned by `soundKit.ts`; making one anywhere else fails the test. The island's own sounds (open, close, page, tap, hover, done, level up, alert, error) are notes in `core/islandSound.ts`, played by `islandSounds.ts` through `soundKit.playVoices` (never before the first gesture): Settings → Sound → Island sounds Off / Subtle / Full and a Sound check; ducked while music plays, silent in a call (and in focus if you want), rate-limited. **Which sound for what** (`core/soundMoments.ts`): Ben, your reminders, water, move break, eye break, timer ends, meeting soon, done, points, bedtime, error each have their own synthesized sound (distinct defaults, 12 to pick from or None, ▶ preview in Settings → Sound); the app's sounds, toasts and the island's peeks and its done/alert/error notes follow the pick. Telegram keeps its own sound.

## Quick add from anywhere (one key, one line)

- **Where:** Ctrl+Space or the Log button in the app and on the website (`quick/QuickHost.tsx`, mounted in `App.tsx`; it replaced `QuickCommandBar`). On the Windows desktop also a **global shortcut**, Alt+Space by default, Ctrl+Shift+Space when another app holds it (Settings → Quick add; `src/desktop/quickWin.ts`, `quickKeys.ts`). Never a Ctrl+Alt combo (AltGr) and never one the island owns.
- **What a line means** (`core/quickRoute.ts`, pure): reps ("50 pushups", "pushups 50", "+50" = the default counter, typos ok), water ("500 ml", "water 2" = glasses), `task …` (the planner's `quickAdd.ts`), food (`ate …`, `foodWords.ts`), `focus 25`, `note …`, `done <habit>` (your own habits only, never automatic ones), money lines ("45 lunch") through the bot's rules (`capture.ts`). Anything else becomes a task only after a second Enter. Tab cycles the other readings, Up repeats the last lines, Esc closes. A preview chip always says what Enter does.
- **Honest points:** every route uses the existing write (`addWater`, the body log rows Sport Track uses, `food.add`, `todoist.quickAdd`, `focus.start`, `notes.save`, `extras.tapHabit`), so points and streaks follow their own rules; quick add pays nothing itself. "yesterday", "2 hours ago" and the like on a log are refused: no back-dating.
- **Instant save, sync later** (`core/quickQueue.ts`, pure): Enter closes the box and the toast shows at once (listeners hear it before `submit` returns; tested < 100 ms with a slow fake DB). The write runs right after through the mirror (desktop: local first; web: offline queue). Each line has an id from the start (`qa-<id>` body-log rows, `fd-<id>` meals, which the writes ignore when they see it twice), so a retry never counts twice. A failed write shows "Will sync" and retries with backoff (2 s, 5 s, 15 s, 60 s); waiting lines are kept in `localStorage` (`ls.quickQueue`) and after a reload sent again when safe (reps, water, food, habit) or shown as "Not sure it saved" (task, focus, note, money). Undo for 5 s; Undo while the write is on its way takes it back when it lands. The water ring moves at once (`life-water-optimistic`), then reads the log's real sum.
- **Desktop window:** made hidden at start (so it opens in well under 150 ms), centered near the top third of the screen the mouse is on, always on top. It never opens the data: it sends the line to the app window (the one owner of the local database, running in the tray), which reads it again with its own fresh context and saves it; the answer comes back as a small toast at the bottom (shown without taking the keyboard). Blur or Esc hides the box.
- **Try on Windows:** press Alt+Space over another app, type "50 pushups", Enter (the box hides, a toast with Undo shows at the bottom); press Undo; type "water 2"; type "buy milk" (asks for a second Enter); run PowerToys Run (it also wants Alt+Space) and check Settings → Quick add says Ctrl+Shift+Space works instead.

- **Reproduce a slow-runner failure (2026-11-10):** `SMOKE_CPU=6 SMOKE_ONLY="Sport Track|Body training" npm run smoke` runs the page 6 times slower (CDP CPU throttling) and only the named steps (`|` separates several). The Windows release 434 failures came back this way: Body training lost a set (a sync race, see [data-sync.md](data-sync.md)) and Sport Track onboarding failed its first try (see [sport.md](sport.md)).
- **Flaky checks fixed (root causes, 2026-11-09):**
  - Smoke "no uncaught page errors … reading 'App'": `main.tsx` swallows `vite:preloadError` (it reloads once a minute), and Vite then resolves the failed `import('./App')` to `undefined`, so `({ App })` threw. The imports now retry once and render nothing if the module is still missing. The smoke prints the error's URL and stack, and a "preload failed" note.
  - `healthKeys.test.ts`: the "wrong key" was the real key with its last character set to `x`; the random key ends in `x` 1 time in 64, so it passed as the right key. It now picks a different character (not load related).
  - Island v2: the split-pill check read the music half while it still said "Lofi · Paused"; it waits for the track name. The `.di-shape` measurements wait for the shape to stand still (`still()` in `e2e/smoke.mjs`).
  - Island Custom Center: a real mouse arriving on the pill made the island swap in its hover view between press and release, so the tap was lost under load. The step now presses and releases the chip with pointer events at its settled place.
  - Sport Track Today: celebrations chain (record, then level-up) and one with buttons never closes by itself, so closing "the" popup once raced the next one. `shut()` closes whatever is open until a frame passes with none.
  - `foodBen.server.test.ts` "fast": the no-model-call check is the `calls` assertion; the 500 ms wall-clock guard became a 10 s hang guard.

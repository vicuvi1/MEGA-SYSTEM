# Decisions

Choices that a later session could easily undo by accident. Each entry gives the decision, why it
was made, and what it rules out. Newest entries go on top. Don't reverse one without writing a new
entry that says why.

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

### The repo is public: no personal data, ever
- **Decision:** use made-up data in code, tests, docs and screenshots. Personal profile notes live
  only in the private database (Settings → Ben).
- **Rules out:** committing real numbers from exports, chats or screenshots. Importers parse files
  locally in the browser.

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

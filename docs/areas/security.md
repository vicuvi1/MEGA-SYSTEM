# Security and secrets

> Secret names (no values), sign-in, PIN, sessions, passkeys, CSP, bot chat ids.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

## 3. Secrets: names only (values are NOT here on purpose)


Server secrets are **Vercel environment variables** (Vercel → mega-system → Settings → Environment Variables). GitHub Actions secrets are under the repo's Settings → Secrets and variables → Actions. Never write a value into the repo, a log or a chat summary.

| Variable | Where | What it is |
|---|---|---|
| `TURSO_URL` / `TURSO_DATABASE_URL`, `TURSO_TOKEN` / `TURSO_AUTH_TOKEN` | Vercel | Turso database URL and token |
| `SESSION_SECRET` | Vercel | signs app sessions (falls back to a hash of the Turso token) |
| `TELEGRAM_CHAT_ID` | Vercel | my Telegram chat id (only this chat is obeyed) |
| `MEGA_BOT_TOKEN` | Vercel | **Ben's bot** |
| `TELEGRAM_BOT_TOKEN`, `SPORT_BOT_TOKEN`, `FINANCE_BOT_TOKEN`, `MAN_BOT_TOKEN`, `WAKY_BOT_TOKEN` | Vercel | older/specialist bots; `BOTS_NOT_ON_SERVER` lists bots the server should not run |
| `OPENROUTER_API_KEY` | Vercel | main AI. `OPENROUTER_MODEL` / `OPENROUTER_STRONG_MODEL` override the pinned models |
| `GEMINI_API_KEY` | Vercel | backup AI, voice notes and photos |
| `VISION_PROVIDER` | Vercel | optional: who reads food photos, `gemini` (default) or `claude` |
| `VISION_MODEL` | Vercel | optional: the model id for food photos (default `gemini-3.5-flash`, or `claude-haiku-4-5` with Claude) |
| `ANTHROPIC_API_KEY` | Vercel | only with `VISION_PROVIDER=claude`: reads food photos |
| `TODOIST_TOKEN` | Vercel | Todoist |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Vercel | Google Calendar/Gmail/Drive OAuth (the refresh token is stored sealed in the database) |
| `CRON_SECRET` | Vercel **and** GitHub | signs the timers: Vercel crons, the GitHub tick, the backup workflow |
| `BACKUP_PASSPHRASE` | GitHub | encrypts the weekly off-site backup (keep a copy in your password manager: without it the backup can't be opened) |
| `SPORT_SYNC_KEY` | Vercel | lets Sporty read/write water and workouts (`/api/cron?job=sport`) |
| `LIFE_TZ` | Vercel | time zone (Europe/Chisinau) |
| `APP_URL` | Vercel | public app URL for links in messages |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel | phone push notifications (`scripts/vapid-keys.mjs` makes a pair) |
| `GITHUB_TOKEN`, `NOTION_TOKEN` | Vercel | optional, read-only: the GitHub and notes plugins |
| `AZURE_SIGN_*`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | GitHub | optional: signed Windows installers (`docs/code-signing.md`) |

Bot tokens come from @BotFather. If a token was ever pasted in a chat or screenshot, revoke it there and replace it in Vercel.

### Sign-in and security


- The PIN is checked only by the server (`sys_auth`) and changed through `/api/login {changePin}`. Wrong PINs are limited per device (5 tries, then a doubling wait up to a day) and overall (20, then up to 15 minutes), counted before the check so parallel guesses can't slip through.
- The PIN hash is **never** in `settings` (any signed-in page can read settings, and a 4-digit PIN falls from its hash in minutes). `authState` deletes an old `settings.pin_hash` (idempotent, and bumps `data_version` once so devices drop their copy); `/api/db` refuses any statement naming `pin_hash` in its SQL or arguments (`_sqlguard.mjs SECRET_KEYS`). Offline unlock uses each device's own copy in local storage (`webAuth.ts localPinStore`), saved after the server accepted the PIN and never synced; a device with no copy must be online once (never the 2007 default). Only the dev/test direct-Turso mode keeps the PIN in settings.
- The backups are read-only from pages: `cloud_snapshots` and `cloud_snapshot_parts` (`READ_ONLY_TABLES`). The app adds today's backup only through `/api/db {snapshotPart}` (each part checked against its SHA-256) and `{snapshot}` (the manifest; refused until every part is in and matches); a complete day never changes. `POST /api/cron?job=offsite` (CRON_SECRET only) records the weekly off-site copy. `BACKUP_PASSPHRASE` must also be kept in the owner's password manager (docs/RECOVERY.md).
- `/api/db` refuses every `sys_*` table except the app's own sync and health tables (`PAGE_SYS_TABLES`: `sys_cas`, `sys_writes`, `sys_writes_at`, `sys_table_versions`, `sys_health`, `sys_error_log`, `sys_ben_log`), and `pragma_*` table functions, `dbstat` and `sqlite_dbpage`. `sqlite_master` stays readable (the app copies the schema from it; the schema is this public repo).
- Every handler checks a session with `requireSession` (401 to enter the PIN, 503 when the database can't be reached), never `sessionOk(...).catch(() => false)`.
- `/api/cron?job=tick` runs only for the app's session or `CRON_SECRET` (the GitHub timer and the optional pinger send it); the `X-Life-Timer` header alone proves nothing.
- Web push (`api/_push.mjs PUSHABLE`) wakes a phone only for bell entries that passed the daily budget (`budget:<slot>:<day>`, at most 4 a day), or for any unread one when the owner switched the budget off.
- The server's URL guard (`core/netGuard.ts`) refuses private IPv4 hidden in IPv6 (`::7f00:1`, `::ffff:…`, `::169.254.169.254`, 6to4, NAT64, Teredo). The Google sign-in state is compared in constant time.
- Sessions last **14 days** and are renewed while the app is in use (`session.ts renewSession`). A database hiccup is a 503, never a sign-out.
- Passkeys (fingerprint/face) and a device list with "sign this device out" (Settings → General).
- `vercel.json` sends a Content-Security-Policy: strict for the app (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), and a looser one for `/apps/*` (their big inline scripts). The embedded apps run in same-origin iframes WITHOUT `sandbox`: the host injects their theme and data into them, and they keep their own localStorage, which a sandbox (opaque origin) would break. The trade-off: code running inside an embedded app could read the session; keep those apps free of third-party scripts.
- The bots obey only `TELEGRAM_CHAT_ID`.
- **Phone payment keys** (`/api/cron?job=pay`, `api/_health.mjs`): their own key kind. Keys start with `pk_` and live in `sys_pay_keys`, which holds only a salted SHA-256 hash, checked in constant time. Each key has a name per phone and can be removed. Health keys (`hk_`, `sys_health_keys`) and payment keys can never stand in for each other. Limits:
  - body at most 4 KB (413);
  - 30 requests a minute per IP and 30 payments per 10 minutes per key, kept in memory (429);
  - fields must be strings, with length caps (400).

  Answers: 401 without a valid key, 503 on a database hiccup (never 401). The answer never repeats the key or the notification text. Signed-in ops (`list`, `new`, `drop`, `test`) need a session. The server keeps no log of the text: only the item in `money_tosort`, with at most 200 characters of raw text, cleared once sorted.

### Google Drive (Photo Locker)
- Scope: only `https://www.googleapis.com/auth/drive.file` (the app sees only files and folders it made), added by "Connect Google Drive" on top of the calendar (incremental consent). Never the full `drive` scope. Details: [vault.md](vault.md).
- `/api/google {op:'driveToken'}` (session required) hands the device a short-lived key (at most 1 hour) asked from Google for `drive.file` alone; a key with any other scope is refused. The key is kept in the page's memory only, never logged, never stored, never in an error. The refresh token never leaves the server.
- Files go device to Google directly; CSP `connect-src` allows `https://www.googleapis.com`.
- Photo Locker files are **not encrypted** (the owner's choice, said plainly in the UI).

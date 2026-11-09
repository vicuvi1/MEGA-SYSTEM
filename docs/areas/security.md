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


- The PIN is checked only by the server (`sys_auth`) and changed through `/api/login {changePin}`. Wrong PINs are limited per device and overall.
- Sessions last **14 days** and are renewed while the app is in use (`session.ts renewSession`). A database hiccup is a 503, never a sign-out.
- Passkeys (fingerprint/face) and a device list with "sign this device out" (Settings → General).
- `vercel.json` sends a Content-Security-Policy: strict for the app (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), and a looser one for `/apps/*` (their big inline scripts). The embedded apps run in same-origin iframes WITHOUT `sandbox`: the host injects their theme and data into them, and they keep their own localStorage, which a sandbox (opaque origin) would break. The trade-off: code running inside an embedded app could read the session; keep those apps free of third-party scripts.
- The bots obey only `TELEGRAM_CHAT_ID`.

### Google Drive (Photo Locker)
- Scope: only `https://www.googleapis.com/auth/drive.file` (the app sees only files and folders it made), added by "Connect Google Drive" on top of the calendar (incremental consent). Never the full `drive` scope. Details: [vault.md](vault.md).
- `/api/google {op:'driveToken'}` (session required) hands the device a short-lived key (at most 1 hour) asked from Google for `drive.file` alone; a key with any other scope is refused. The key is kept in the page's memory only, never logged, never stored, never in an error. The refresh token never leaves the server.
- Files go device to Google directly; CSP `connect-src` allows `https://www.googleapis.com`.
- Photo Locker files are **not encrypted** (the owner's choice, said plainly in the UI).

# Web app server (Vercel)

The web app (Vercel project `life-os`) never holds the Turso or Telegram keys.
They live in the project's Environment Variables, and three small functions
in `api/` use them:

- `POST /api/login {pin}` checks the PIN against `settings.pin_hash` in Turso
  (same scrypt format as the desktop; 2007 only while no PIN is set) and
  returns a 30-day session. After 5 wrong PINs it makes you wait, 1 minute
  and doubling up to a day (counted in Turso, so on every device).
- `POST /api/db` (session required) passes a Turso pipeline request on with
  the server's key.
- `GET /api/config` (session required) gives the app its bot tokens.

## Environment variables (Vercel → life-os → Settings → Environment Variables)

| Name | Value |
| --- | --- |
| `TURSO_URL` | `https://life-os-vicuvi1.aws-eu-central-1.turso.io` |
| `TURSO_TOKEN` | a Turso database token (read/write) |
| `TELEGRAM_BOT_TOKEN` | the main (Sport) bot token from BotFather |
| `TELEGRAM_CHAT_ID` | your Telegram chat id |
| `FINANCE_BOT_TOKEN` | optional: the Finance bot token |
| `MAN_BOT_TOKEN` | optional: the MAN bot token |
| `SESSION_SECRET` | optional: any long random text (default: derived from `TURSO_TOKEN`) |

Changing `TURSO_TOKEN` (or `SESSION_SECRET`) logs every device out; they
log in again with the PIN. After changing variables, redeploy.

For local development without the server, set `turso_url` and
`turso_token` in the browser's localStorage.

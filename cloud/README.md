# Life System — 24/7 Mobile Cloudflare Worker & Sync Buffer

This serverless worker runs **24/7 on Cloudflare's Global Edge Network for free** ($0/month). It receives messages from your Telegram bot on your phone, buffers all events for 7 days in Cloudflare KV, and auto-syncs with your PC desktop app whenever you launch it.

---

## 🚀 3-Minute Quick Setup

### Step 1: Create a KV Namespace
In the `cloud/` directory, run:
```bash
npx wrangler kv:namespace create LIFE_SYNC_KV
```
Copy the generated `id = "..."` into `cloud/wrangler.toml`.

### Step 2: Set your Secrets
Edit `cloud/wrangler.toml` or set them via CLI:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your token from @BotFather

npx wrangler secret put SYNC_SECRET_TOKEN
# Enter any strong password/secret (e.g. victor_sync_secret_2026)
```

### Step 3: Deploy to Cloudflare
```bash
npx wrangler deploy
```
Cloudflare will give you a public URL, for example:
`https://life-system-sync.yourname.workers.dev`

### Step 4: Link your Telegram Bot Webhook
Open your browser or run this curl command (replace `<BOT_TOKEN>` and `<WORKER_URL>`):
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>/webhook
```
You will see: `{"ok":true,"result":true,"description":"Webhook was set"}`.

### Step 5: Configure PC Desktop App
1. Open **Life System** on your PC.
2. Go to **Settings** $\rightarrow$ **24/7 Mobile Cloud Sync & Telegram Buffer**.
3. Paste:
   - **Sync URL**: `https://life-system-sync.yourname.workers.dev`
   - **Secret Key**: `victor_sync_secret_2026`
4. Click **Test Connection** $\rightarrow$ "Connected (Online)".
5. You're done! Now whenever you text your bot from your phone, it saves your streak and auto-syncs to PC!

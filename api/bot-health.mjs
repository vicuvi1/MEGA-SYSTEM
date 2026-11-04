// GET /api/bot-health: for each bot in the server's settings, what Telegram
// says about it (name, webhook or not, messages waiting, last error). Reads
// nothing from the chats and shows no tokens; still, only you (a session or
// the CRON_SECRET) may ask.
import { bearer, config, cronSecretOk, send, sessionOk } from './_lib.mjs'

const BOTS = ['MEGA_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SPORT_BOT_TOKEN', 'FINANCE_BOT_TOKEN', 'MAN_BOT_TOKEN']

async function check(token) {
  const call = async (method) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(8000) })
    return res.json()
  }
  try {
    const [me, hook] = await Promise.all([call('getMe'), call('getWebhookInfo')])
    const h = hook?.result ?? {}
    return {
      bot: me?.result?.username ? '@' + me.result.username : null,
      name: me?.result?.first_name ?? null,
      ok: !!me?.ok,
      error: me?.ok ? null : me?.description ?? 'no answer',
      webhook: h.url ? new URL(h.url).host : null,
      waiting: h.pending_update_count ?? null,
      lastError: h.last_error_message ?? null,
      lastErrorAt: h.last_error_date ? new Date(h.last_error_date * 1000).toISOString() : null
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export default async function handler(req, res) {
  if (!cronSecretOk(req) && !(await sessionOk(config(), bearer(req)).catch(() => false))) return send(res, 401, { error: 'Not allowed' })
  const out = {}
  const seen = new Map()
  for (const name of BOTS) {
    const token = (process.env[name] || '').trim()
    if (!token) {
      out[name] = 'not set'
      continue
    }
    const id = token.split(':')[0]
    if (seen.has(id)) {
      out[name] = `same bot as ${seen.get(id)}`
      continue
    }
    seen.set(id, name)
    out[name] = await check(token)
  }
  send(res, 200, out)
}

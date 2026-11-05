// GET /api/config (Bearer session): the bot settings to start from. Tokens
// never leave the server: each one is replaced by "on-server" (the server's
// bots answer every message; the page only needs to know they exist).
import { bearer, botDefaults, config, send, requireSession } from './_lib.mjs'

export const SERVER_TOKEN = 'on-server'

export function publicBots(bots) {
  const out = {}
  for (const [k, v] of Object.entries(bots)) out[k] = /Token$/.test(k) ? (v ? SERVER_TOKEN : '') : v
  return out
}

export default async function handler(req, res) {
  const cfg = config()
  if (!(await requireSession(res, cfg, bearer(req)))) return
  send(res, 200, { bots: publicBots(botDefaults()) })
}

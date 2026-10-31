// GET /api/config (Bearer session): the bot settings to start from.
import { bearer, botDefaults, config, send, sessionOk } from './_lib.mjs'

export default async function handler(req, res) {
  const cfg = config()
  if (!sessionOk(cfg, bearer(req))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  send(res, 200, { bots: botDefaults() })
}

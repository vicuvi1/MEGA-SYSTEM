// GET /api/google-callback?code&state: where Google sends you back after
// signing in. Saves the sealed refresh token and returns to the app.
import { config, getSetting, setSetting } from './_lib.mjs'
import { GOOGLE_SETTING, exchangeCode, keepGooglePrefs } from './_bot/bot.mjs'
import { googleEnv, redirectUri, stateOk } from './google.mjs'

const back = (res, q) => {
  res.statusCode = 302
  res.setHeader('Location', `/?google=${q}`)
  res.end()
}

export default async function handler(req, res) {
  const cfg = config()
  const url = new URL(req.url, 'http://x')
  const env = googleEnv(cfg)
  if (url.searchParams.get('error')) return back(res, 'cancelled')
  if (!env || !cfg.ok) return back(res, 'not-configured')
  if (!stateOk(cfg, url.searchParams.get('state'))) return back(res, 'expired')
  try {
    const stored = await exchangeCode(env, redirectUri(req), String(url.searchParams.get('code') || ''))
    // Connecting Gmail later keeps the calendars you picked.
    await setSetting(cfg, GOOGLE_SETTING, JSON.stringify(keepGooglePrefs(await getSetting(cfg, GOOGLE_SETTING).catch(() => null), stored)))
    back(res, 'connected')
  } catch (e) {
    console.error('google callback:', e)
    back(res, 'failed')
  }
}

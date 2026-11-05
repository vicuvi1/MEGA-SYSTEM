// POST /api/google (session required) {op, ...}: your Google Calendar for
// the app. The sign-in's refresh token stays sealed in the database; only
// this server opens it (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Vercel).
//   status                 → {configured, connected, email, calendars?, on, target}
//   connect {gmail?}       → {url}            open it to sign in with Google (gmail: also read-only Gmail)
//   events {from, to}      → {events}         ISO times, the shown calendars
//   create {title, start, end, description?, calendarId?} → {event}
//   move {calendarId, id, start, end} · remove {calendarId, id}
//   setCalendars {on, target} · disconnect
import { randomBytes } from "node:crypto"
import { bearer, config, getSetting, readBody, send, requireSession, setSetting, sign } from './_lib.mjs'
import { GMAIL_READ_SCOPE, GOOGLE_SETTING, authUrl, createCalendarApi } from './_bot/bot.mjs'

export function googleEnv(cfg, env = process.env) {
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim()
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim()
  return clientId && clientSecret ? { clientId, clientSecret, secret: cfg.secret } : null
}

export const redirectUri = (req, env = process.env) => (env.GOOGLE_REDIRECT_URI || `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/google-callback`).trim()

/** A sign-in "state" the callback can trust: time, nonce and the server's signature. */
export function makeState(cfg, now = Date.now()) {
  const data = `${now}.${randomBytes(8).toString('hex')}`
  return `${data}.${sign(cfg.secret, 'google:' + data)}`
}
export function stateOk(cfg, state, now = Date.now()) {
  const [ts, nonce, sig] = String(state || '').split('.')
  if (!ts || !nonce || !sig) return false
  if (now - Number(ts) > 15 * 60_000) return false
  return sign(cfg.secret, `google:${ts}.${nonce}`) === sig
}

async function stored(cfg) {
  try {
    return JSON.parse((await getSetting(cfg, GOOGLE_SETTING)) || 'null')
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!(await requireSession(res, cfg, bearer(req)))) return
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  const env = googleEnv(cfg)
  const op = body?.op
  if (op === 'connect') {
    if (!env) return send(res, 200, { error: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first' })
    return send(res, 200, { url: authUrl(env, redirectUri(req), makeState(cfg), body.gmail ? [GMAIL_READ_SCOPE] : []) })
  }
  const st = await stored(cfg)
  if (op === 'status') {
    if (!env || !st?.enc) return send(res, 200, { configured: !!env, connected: false })
    try {
      const cals = await createCalendarApi(env, st).calendars()
      return send(res, 200, { configured: true, connected: true, email: st.email ?? null, calendars: cals, on: st.on ?? [], target: st.target ?? null, gmail: (st.scopes ?? []).includes(GMAIL_READ_SCOPE) })
    } catch (e) {
      return send(res, 200, { configured: true, connected: false, email: st.email ?? null, error: e.message })
    }
  }
  if (op === 'disconnect') {
    await setSetting(cfg, GOOGLE_SETTING, 'null')
    return send(res, 200, { ok: true })
  }
  if (!env || !st?.enc) return send(res, 200, { connected: false, events: [] })
  if (op === 'setCalendars') {
    const next = { ...st, on: Array.isArray(body.on) ? body.on.map(String) : st.on, target: body.target ? String(body.target) : st.target ?? null }
    await setSetting(cfg, GOOGLE_SETTING, JSON.stringify(next))
    return send(res, 200, { ok: true })
  }
  const api = createCalendarApi(env, st)
  try {
    switch (op) {
      case 'events':
        return send(res, 200, { connected: true, events: await api.events(String(body.from), String(body.to)) })
      case 'create':
        return send(res, 200, { event: await api.create({ title: String(body.title || 'Focus').slice(0, 200), start: String(body.start), end: String(body.end), description: body.description ? String(body.description).slice(0, 2000) : undefined, calendarId: body.calendarId ? String(body.calendarId) : undefined, recurrence: Array.isArray(body.recurrence) ? body.recurrence.map(String) : undefined, timeZone: process.env.LIFE_TZ || undefined, reminder: Number.isFinite(body.reminder) ? Number(body.reminder) : undefined }) })
      case 'update':
        await api.update(String(body.calendarId), String(body.id), {
          title: body.title != null ? String(body.title).slice(0, 200) : undefined,
          start: body.start ? String(body.start) : undefined,
          end: body.end ? String(body.end) : undefined,
          description: body.description != null ? String(body.description).slice(0, 4000) : undefined,
          colorId: body.colorId === undefined ? undefined : body.colorId ? String(body.colorId) : null,
          recurrence: body.recurrence === undefined ? undefined : Array.isArray(body.recurrence) ? body.recurrence.map(String) : null,
          moveTo: body.moveTo ? String(body.moveTo) : undefined,
          scope: body.scope === 'all' ? 'all' : 'one',
          recurringEventId: body.recurringEventId ? String(body.recurringEventId) : null,
          timeZone: process.env.LIFE_TZ || undefined,
          reminder: body.reminder === undefined ? undefined : Number.isFinite(body.reminder) ? Number(body.reminder) : null
        })
        return send(res, 200, { ok: true })
      case 'move':
        await api.move(String(body.calendarId), String(body.id), String(body.start), String(body.end))
        return send(res, 200, { ok: true })
      case 'remove':
        await api.remove(String(body.calendarId), String(body.id))
        return send(res, 200, { ok: true })
      default:
        return send(res, 400, { error: 'Unknown op' })
    }
  } catch (e) {
    send(res, 502, { error: e.message || 'Google Calendar failed' })
  }
}

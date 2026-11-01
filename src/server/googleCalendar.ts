// Google Calendar for Life System: sign in once (OAuth), the refresh token
// is kept sealed in your database (only the server can open it), and the
// app, the bots and the coach read and write your calendars through here.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { CalEvent } from '@core/dayTime'

export interface GoogleEnv {
  clientId: string
  clientSecret: string
  /** The server's own secret (sessions); seals the refresh token. */
  secret: string
}

/** What's saved in settings.google_oauth. */
export interface GoogleStored {
  enc: string
  email?: string | null
  /** Calendars to show (ids); empty or missing = all. */
  on?: string[]
  /** Where new events go (default: primary). */
  target?: string | null
}

export const GOOGLE_SETTING = 'google_oauth'
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'openid', 'email']
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/calendar/v3'

const keyOf = (secret: string) => createHash('sha256').update('life-google:' + secret).digest()

export function sealToken(secret: string, token: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv)
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
}

export function openToken(secret: string, sealed: string): string {
  const buf = Buffer.from(sealed, 'base64')
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export function authUrl(env: GoogleEnv, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

/** The code from the sign-in → a refresh token (sealed) and your email. */
export async function exchangeCode(env: GoogleEnv, redirectUri: string, code: string, fetchImpl: typeof fetch = fetch): Promise<GoogleStored> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.clientId, client_secret: env.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || !j.refresh_token) throw new Error(j.error_description || j.error || 'Google did not give a refresh token')
  let email: string | null = null
  try {
    const payload = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString('utf8'))
    email = payload.email ?? null
  } catch {
    /* no email: fine */
  }
  return { enc: sealToken(env.secret, j.refresh_token), email, on: [], target: null }
}

export interface CalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
  canWrite: boolean
}

export function createCalendarApi(env: GoogleEnv, stored: GoogleStored, fetchImpl: typeof fetch = fetch) {
  let access: { token: string; until: number } | null = null
  const token = async () => {
    if (access && access.until > Date.now() + 60_000) return access.token
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, refresh_token: openToken(env.secret, stored.enc), grant_type: 'refresh_token' })
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error === 'invalid_grant' ? 'Google sign-in expired: connect Google Calendar again in Settings' : j.error_description || 'Google refused the sign-in')
    access = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
    return access.token
  }
  const call = async (path: string, init: RequestInit = {}): Promise<any> => {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(12_000)
    })
    if (res.status === 204) return null
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${j?.error?.message ?? 'request failed'}`)
    return j
  }
  let cals: CalendarInfo[] | null = null
  const calendars = async (): Promise<CalendarInfo[]> => {
    if (cals) return cals
    const j = await call('/users/me/calendarList?minAccessRole=reader&maxResults=100')
    cals = (j.items ?? [])
      .filter((c: any) => !c.deleted && !c.hidden)
      .map((c: any) => ({ id: String(c.id), name: String(c.summaryOverride ?? c.summary ?? c.id), color: String(c.backgroundColor ?? '#7CC4FF'), primary: !!c.primary, canWrite: c.accessRole === 'owner' || c.accessRole === 'writer' }))
    return cals!
  }
  const target = async () => {
    const list = await calendars()
    return stored.target && list.some((c) => c.id === stored.target && c.canWrite) ? stored.target : (list.find((c) => c.primary)?.id ?? 'primary')
  }
  const toEvent = (e: any, cal: CalendarInfo): CalEvent => ({
    id: String(e.id),
    calendarId: cal.id,
    title: String(e.summary ?? '(no title)'),
    start: String(e.start?.dateTime ?? e.start?.date ?? ''),
    end: String(e.end?.dateTime ?? e.end?.date ?? ''),
    allDay: !e.start?.dateTime,
    color: cal.color,
    location: e.location ?? null,
    ours: e.extendedProperties?.private?.lifeSystem === '1'
  })

  return {
    calendars,
    /** Events of the shown calendars between two ISO times, sorted. */
    async events(fromIso: string, toIso: string): Promise<CalEvent[]> {
      const list = (await calendars()).filter((c) => !stored.on?.length || stored.on.includes(c.id))
      const all = await Promise.all(
        list.map((c) =>
          call(`/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}`)
            .then((j) => (j.items ?? []).filter((e: any) => e.status !== 'cancelled').map((e: any) => toEvent(e, c)))
            .catch(() => [] as CalEvent[])
        )
      )
      return all.flat().sort((a, b) => a.start.localeCompare(b.start))
    },
    /** A new event (in your chosen calendar), marked as made by Life System. */
    async create(e: { title: string; start: string; end: string; description?: string; calendarId?: string; colorId?: string; recurrence?: string[]; timeZone?: string }): Promise<CalEvent> {
      const calId = e.calendarId || (await target())
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.start)
      const body = {
        summary: e.title,
        description: e.description ?? 'Added by Life System',
        start: allDay ? { date: e.start } : { dateTime: e.start, ...(e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || 'Europe/Chisinau' } : {}) },
        end: allDay ? { date: e.end } : { dateTime: e.end, ...(e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || 'Europe/Chisinau' } : {}) },
        ...(e.colorId ? { colorId: e.colorId } : {}),
        // Repeating blocks: one RRULE, e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
        ...(e.recurrence?.length ? { recurrence: e.recurrence.filter((r) => /^RRULE:[A-Z0-9=;,]+$/.test(r)).slice(0, 2) } : {}),
        extendedProperties: { private: { lifeSystem: '1' } }
      }
      const j = await call(`/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify(body) })
      const cal = (await calendars()).find((c) => c.id === calId) ?? { id: calId, name: '', color: '#C8F135', primary: false, canWrite: true }
      return toEvent(j, cal)
    },
    async move(calendarId: string, id: string, start: string, end: string): Promise<void> {
      await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ start: { dateTime: start }, end: { dateTime: end } }) })
    },
    /** Changes the title, times or notes of one event. */
    async update(calendarId: string, id: string, patch: { title?: string; start?: string; end?: string; description?: string }): Promise<void> {
      const body: any = {}
      if (patch.title != null) body.summary = patch.title
      if (patch.description != null) body.description = patch.description
      if (patch.start) body.start = { dateTime: patch.start }
      if (patch.end) body.end = { dateTime: patch.end }
      await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })
    },
    async remove(calendarId: string, id: string): Promise<void> {
      await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
    }
  }
}
export type CalendarApi = ReturnType<typeof createCalendarApi>

/** Local "YYYY-MM-DD" + "HH:MM" → an ISO time with the local offset (the server runs in your time zone). */
export function localIso(day: string, hm: string): string {
  const d = new Date(`${day}T${hm}:00`)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${day}T${hm}:00${sign}${p(off / 60)}:${p(off % 60)}`
}

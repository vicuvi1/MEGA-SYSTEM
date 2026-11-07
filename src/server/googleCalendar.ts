// Google Calendar for Life System: sign in once (OAuth), the refresh token
// is kept sealed in your database (only the server can open it), and the
// app, the bots and the coach read and write your calendars through here.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { CalEvent } from '@core/dayTime'
import { DEFAULT_TZ } from '@core/defaults'
import { selfResponse } from '@core/calResponse'

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
  /** What the sign-in may do (Google's granted scopes); gmail.readonly after "Connect Gmail". */
  scopes?: string[]
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

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/** `extra`: more permissions asked on top (incremental: the calendar ones stay granted). */
export function authUrl(env: GoogleEnv, redirectUri: string, state: string, extra: string[] = []): string {
  const p = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [...GOOGLE_SCOPES, ...extra].join(' '),
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
  return { enc: sealToken(env.secret, j.refresh_token), email, on: [], target: null, scopes: String(j.scope ?? '').split(/\s+/).filter(Boolean) }
}

/** A new sign-in keeps the calendars you picked before (connecting Gmail must not reset them). */
export function keepGooglePrefs(prevRaw: string | null, next: GoogleStored): GoogleStored {
  try {
    const prev = JSON.parse(prevRaw || 'null') as GoogleStored | null
    if (!prev?.enc) return next
    return { ...next, on: prev.on ?? [], target: prev.target ?? null }
  } catch {
    return next
  }
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
    if (!res.ok) {
      const err: any = new Error(`Google Calendar ${res.status}: ${j?.error?.message ?? 'request failed'}`)
      err.status = res.status
      throw err
    }
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
    // The event's own color when you gave it one, else its calendar's.
    color: (e.colorId && EVENT_COLORS[String(e.colorId)]) || cal.color,
    colorId: e.colorId ? String(e.colorId) : null,
    location: e.location ?? null,
    description: e.description ?? null,
    recurringEventId: e.recurringEventId ?? null,
    ours: e.extendedProperties?.private?.lifeSystem === '1',
    // Meetings by their data, not their name (Q4, E2): a call link, the people, your answer.
    meet: e.hangoutLink ?? (e.conferenceData?.entryPoints ?? []).find((p: any) => p?.entryPointType === 'video')?.uri ?? null,
    attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
    declined: Array.isArray(e.attendees) && e.attendees.some((a: any) => a?.self && a?.responseStatus === 'declined'),
    // IS6: your answer (null when you made it or nobody is invited) and the kind of event.
    response: selfResponse(e),
    eventType: typeof e.eventType === 'string' ? e.eventType : null,
    free: e.transparency === 'transparent',
    htmlLink: e.htmlLink ?? null,
    reminder: e.reminders?.useDefault === false ? (e.reminders.overrides?.[0]?.minutes ?? 0) : null
  })

  return {
    calendars,
    /** A fresh access token (Gmail reads use the same sign-in). */
    token,
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
    /**
     * With `id` (a plan block's own id, see core/planLook planEventId) the write is
     * safe to repeat: when that event exists already (made a moment ago by another
     * write, or deleted earlier) it is updated and brought back, never made twice.
     */
    async create(e: { title: string; start: string; end: string; description?: string; location?: string; calendarId?: string; colorId?: string; recurrence?: string[]; timeZone?: string; reminder?: number | null; id?: string }): Promise<CalEvent> {
      const calId = e.calendarId || (await target())
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.start)
      const body = {
        summary: e.title,
        description: e.description ?? 'Added by Life System',
        ...(e.location ? { location: e.location } : {}),
        start: allDay ? { date: e.start } : { dateTime: e.start, ...(e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || DEFAULT_TZ } : {}) },
        end: allDay ? { date: e.end } : { dateTime: e.end, ...(e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || DEFAULT_TZ } : {}) },
        ...(e.colorId ? { colorId: e.colorId } : {}),
        // A reminder you chose (D6): a pop-up N minutes before.
        ...(e.reminder != null ? { reminders: { useDefault: false, overrides: e.reminder > 0 ? [{ method: 'popup', minutes: Math.min(40320, Math.round(e.reminder)) }] : [] } } : {}),
        // Repeating blocks: one RRULE, e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
        ...(e.recurrence?.length ? { recurrence: e.recurrence.filter((r) => /^RRULE:[A-Z0-9=;,]+$/.test(r)).slice(0, 2) } : {}),
        extendedProperties: { private: { lifeSystem: '1' } }
      }
      const id = e.id && /^[a-v0-9]{5,1024}$/.test(e.id) ? e.id : null
      let j: any
      try {
        j = await call(`/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify(id ? { ...body, id } : body) })
      } catch (err: any) {
        if (!id || err?.status !== 409) throw err
        // Already there: the same block written again. Update it (and undelete it).
        j = await call(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, status: 'confirmed' }) })
      }
      const cal = (await calendars()).find((c) => c.id === calId) ?? { id: calId, name: '', color: '#C8F135', primary: false, canWrite: true }
      return toEvent(j, cal)
    },
    async move(calendarId: string, id: string, start: string, end: string): Promise<void> {
      // An all-day event moves by its dates (F6).
      const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? { date: v, dateTime: null } : { dateTime: v, date: null })
      await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ start: day(start), end: day(end) }) })
    },
    /**
     * Changes an event: title, times, notes, color, repeat, calendar. With
     * scope 'all' on a repeating event, the whole series changes (its times
     * keep each day, only the time of day moves).
     */
    async update(calendarId: string, id: string, patch: { title?: string; start?: string; end?: string; description?: string; location?: string; colorId?: string | null; recurrence?: string[] | null; moveTo?: string; scope?: 'one' | 'all'; recurringEventId?: string | null; timeZone?: string; reminder?: number | null }): Promise<void> {
      let target = id
      const body: any = {}
      if (patch.title != null) body.summary = patch.title
      if (patch.description != null) body.description = patch.description
      if (patch.location != null) body.location = patch.location
      if (patch.colorId !== undefined) body.colorId = patch.colorId || null
      // Reminder (D6): a number of minutes, 0 = none, null = the calendar's default.
      if (patch.reminder !== undefined) body.reminders = patch.reminder == null ? { useDefault: true } : { useDefault: false, overrides: patch.reminder > 0 ? [{ method: 'popup', minutes: Math.min(40320, Math.round(patch.reminder)) }] : [] }
      if (patch.scope === 'all' && patch.recurringEventId) {
        target = patch.recurringEventId
        if (patch.start || patch.end) {
          const master = await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(target)}`)
          const keepDay = (masterIso: string, newIso: string) => `${String(masterIso).slice(0, 10)}${String(newIso).slice(10)}`
          const tz = master.start?.timeZone || patch.timeZone || process.env.TZ || DEFAULT_TZ
          if (patch.start && master.start?.dateTime) body.start = { dateTime: keepDay(master.start.dateTime, localIsoOf(patch.start)), timeZone: tz }
          if (patch.end && master.end?.dateTime) body.end = { dateTime: keepDay(master.end.dateTime, localIsoOf(patch.end)), timeZone: tz }
        }
      } else {
        const tz = patch.recurrence?.length ? { timeZone: patch.timeZone || process.env.TZ || DEFAULT_TZ } : {}
        // A date only (YYYY-MM-DD) makes it all-day (D5); a date-time makes it timed again.
        const at = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? { date: v, dateTime: null } : { dateTime: v, date: null, ...tz })
        if (patch.start) body.start = at(patch.start)
        if (patch.end) body.end = at(patch.end)
      }
      if (patch.recurrence !== undefined && !patch.recurringEventId) body.recurrence = (patch.recurrence ?? []).filter((r) => /^RRULE:[A-Z0-9=;,]+$/.test(r)).slice(0, 2)
      if (Object.keys(body).length) await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(target)}`, { method: 'PATCH', body: JSON.stringify(body) })
      // Another calendar (Google moves the event, or the whole series).
      if (patch.moveTo && patch.moveTo !== calendarId) await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(target)}/move?destination=${encodeURIComponent(patch.moveTo)}`, { method: 'POST' })
    },
    /** Deletes one event, or (with the series id) every repeat of it. */
    async remove(calendarId: string, id: string): Promise<void> {
      await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
    }
  }
}
export type CalendarApi = ReturnType<typeof createCalendarApi>

/** Google Calendar's event colors (colorId → color), as Google shows them. */
export const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
}

/** An ISO time (any offset) as local "YYYY-MM-DDTHH:MM:SS±hh:mm" in this server's time zone. */
function localIsoOf(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`
}

/** Local "YYYY-MM-DD" + "HH:MM" → an ISO time with the local offset (the server runs in your time zone). */
export function localIso(day: string, hm: string): string {
  const d = new Date(`${day}T${hm}:00`)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${day}T${hm}:00${sign}${p(off / 60)}:${p(off % 60)}`
}

import { describe, expect, it } from 'vitest'
import { authUrl, createCalendarApi, exchangeCode, openToken, sealToken } from './googleCalendar'
// @ts-expect-error plain JS module without types
import { makeState, stateOk } from '../../api/google.mjs'
import { readAction } from '../renderer/src/web/botBrain'

const env = { clientId: 'cid', clientSecret: 'csec', secret: 'server-secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Google Calendar', () => {
  it('seals the refresh token so only the server can open it', () => {
    const sealed = sealToken('server-secret', 'refresh-123')
    expect(sealed).not.toContain('refresh')
    expect(openToken('server-secret', sealed)).toBe('refresh-123')
    expect(() => openToken('other-secret', sealed)).toThrow()
  })

  it('signs in: the URL asks for offline calendar access; the code becomes a sealed token', async () => {
    const url = new URL(authUrl(env, 'https://x.app/api/google-callback', 'st'))
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toContain('auth/calendar')
    const idToken = `h.${Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url')}.s`
    const stored = await exchangeCode(env, 'https://x.app/api/google-callback', 'code', (async () => json({ refresh_token: 'r1', access_token: 'a', id_token: idToken })) as any)
    expect(stored.email).toBe('me@example.com')
    expect(openToken('server-secret', stored.enc)).toBe('r1')
  })

  it('a sign-in state is trusted only from this server and for 15 minutes', () => {
    const cfg = { secret: 's' }
    const st = makeState(cfg, 1000)
    expect(stateOk(cfg, st, 2000)).toBe(true)
    expect(stateOk(cfg, st, 1000 + 16 * 60_000)).toBe(false)
    expect(stateOk({ secret: 'other' }, st, 2000)).toBe(false)
  })

  it('reads events of the shown calendars and creates blocks marked as ours', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'at', expires_in: 3600 })
      if (url.includes('/calendarList')) return json({ items: [{ id: 'primary@x', summary: 'Me', primary: true, accessRole: 'owner', backgroundColor: '#123456' }, { id: 'uni', summary: 'University', accessRole: 'reader' }] })
      if (url.includes('/events') && (init?.method ?? 'GET') === 'GET') return json({ items: [{ id: 'e1', summary: 'Lecture', start: { dateTime: '2026-11-02T09:00:00+02:00' }, end: { dateTime: '2026-11-02T10:30:00+02:00' } }] })
      if (url.includes('/events') && init?.method === 'POST') return json({ id: 'new', summary: JSON.parse(String(init.body)).summary, start: { dateTime: '2026-11-02T15:00:00+02:00' }, end: { dateTime: '2026-11-02T15:50:00+02:00' }, extendedProperties: { private: { lifeSystem: '1' } } })
      return json({})
    }) as unknown as typeof fetch
    const api = createCalendarApi(env, { enc: sealToken('server-secret', 'r1'), on: ['primary@x'] }, fetchImpl)
    const list = await api.events('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')
    expect(list).toHaveLength(1) // only the shown calendar
    expect(list[0]).toMatchObject({ title: 'Lecture', color: '#123456', allDay: false })
    const made = await api.create({ title: 'Focus: Math', start: '2026-11-02T15:00:00+02:00', end: '2026-11-02T15:50:00+02:00' })
    expect(made.ours).toBe(true)
    expect(calls.filter((c) => c.includes('oauth2')).length).toBe(1) // the access token is reused
  })

  it('the coach can put a block in the calendar', () => {
    expect(readAction('event: Study etica | 2026-11-02 15:00 | 50')).toEqual({ kind: 'event', title: 'Study etica', day: '2026-11-02', time: '15:00', minutes: 50 })
    expect(readAction('event: x | tomorrow | 50')).toBeNull()
  })
})

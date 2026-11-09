// Photo Locker: the Drive key the server hands to a device (api/google.mjs driveToken).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRIVE_FILE_SCOPE, authUrl, driveAccessToken, sealToken } from './googleCalendar'
// @ts-expect-error plain JS module without types
import handler, { driveTokenOp } from '../../api/google.mjs'

const env = { clientId: 'cid', clientSecret: 'csec', secret: 'server-secret' }
const stored = { enc: sealToken('server-secret', 'refresh-made-up'), scopes: ['https://www.googleapis.com/auth/calendar', DRIVE_FILE_SCOPE] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const KEY = 'ya29.made-up-drive-key'

function fakeRes() {
  const r: any = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
  r.setHeader = (k: string, v: string) => (r.headers[k.toLowerCase()] = v)
  r.end = (b: string) => (r.body = String(b ?? ''))
  return r
}

afterEach(() => vi.restoreAllMocks())

describe('Photo Locker: Drive key', () => {
  it('Connect Google Drive asks for drive.file on top of the calendar (incremental)', () => {
    const url = new URL(authUrl(env, 'https://x.app/api/google-callback', 'st', [DRIVE_FILE_SCOPE]))
    const scope = url.searchParams.get('scope')!
    expect(scope).toContain('auth/calendar')
    expect(scope).toContain('auth/drive.file')
    expect(scope).not.toMatch(/auth\/drive(\s|$)/) // never the whole Drive
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
  })

  it('asks Google for a Drive-only key and gives a short-lived one', async () => {
    let sent = ''
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      sent = String(init?.body)
      return json({ access_token: KEY, expires_in: 3599, scope: DRIVE_FILE_SCOPE })
    }) as unknown as typeof fetch
    const t = await driveAccessToken(env, stored, fetchImpl, 1000)
    expect(new URLSearchParams(sent).get('scope')).toBe(DRIVE_FILE_SCOPE)
    expect(t).toEqual({ token: KEY, expiresAt: 1000 + 3599 * 1000 })
  })

  it('refuses a key wider than Drive, and a sign-in without Drive', async () => {
    const wide = (async () => json({ access_token: KEY, expires_in: 3600, scope: `${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/gmail.readonly` })) as unknown as typeof fetch
    await expect(driveAccessToken(env, stored, wide)).rejects.toThrow(/wider key/)
    await expect(driveAccessToken(env, { ...stored, scopes: ['https://www.googleapis.com/auth/calendar'] }, wide)).rejects.toThrow(/Connect Google Drive/)
  })

  it('the op answers with the key only, never logs it, and keeps it out of errors', async () => {
    const logs: string[] = []
    for (const k of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')))
    const ok = fakeRes()
    await driveTokenOp(ok, env, stored, (async () => json({ access_token: KEY, expires_in: 3600, scope: DRIVE_FILE_SCOPE })) as any)
    expect(JSON.parse(ok.body)).toMatchObject({ token: KEY })
    expect(ok.headers['cache-control']).toBe('no-store')
    const bad = fakeRes()
    await driveTokenOp(bad, env, stored, (async () => json({ error: 'invalid_grant', error_description: `bad ${KEY}` }, 400)) as any)
    expect(bad.body).not.toContain(KEY)
    expect(JSON.parse(bad.body).error).toMatch(/connect Google Drive again/)
    expect(logs.join('\n')).not.toContain(KEY)
  })

  it('needs a signed-in session', async () => {
    const res = fakeRes()
    const req: any = { method: 'POST', url: '/api/google', headers: {}, on() {} }
    await handler(req, res)
    expect([401, 503]).toContain(res.statusCode)
    expect(res.body).not.toContain('token":')
  })
})

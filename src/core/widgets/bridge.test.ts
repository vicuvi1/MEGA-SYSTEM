import { describe, expect, it } from 'vitest'
import { EMPTY_ISLAND, type IslandSnapshot } from '../islandModel'
import { CALLS_PER_MIN, checkCall, checkUrl, cleanGrants, fetchAnswer, fullGrants, NO_GRANTS, readFrameMsg, widgetData, type WidgetGrants } from './bridge'
import { validateManifest, type WidgetManifest } from './manifest'

const m = (validateManifest({ id: 'net', name: 'Net', version: '1.0.0', author: 'A', size: '1x1', refresh: 60, permissions: ['read', 'network', 'add', 'sound'], hosts: ['api.good-site.io', 'cdn.good-site.io'] }) as { manifest: WidgetManifest }).manifest
const all: WidgetGrants = fullGrants(m)
const now = 1_800_000_000_000

describe('widget bridge: the check on every call (PL2)', () => {
  it('nothing is allowed without the matching permission', () => {
    expect(checkCall({ op: 'fetch', url: 'https://api.good-site.io/x' }, NO_GRANTS, {}, now)).toMatchObject({ ok: false, error: expect.stringContaining('Network is off') })
    expect(checkCall({ op: 'addTask', text: 'Buy milk' }, NO_GRANTS, {}, now)).toMatchObject({ ok: false })
    expect(checkCall({ op: 'addNote', text: 'Hi' }, NO_GRANTS, {}, now)).toMatchObject({ ok: false })
    expect(checkCall({ op: 'sound', name: 'done' }, NO_GRANTS, {}, now)).toMatchObject({ ok: false })
  })
  it('granted calls pass, cleaned', () => {
    expect(checkCall({ op: 'fetch', url: 'https://api.good-site.io/v1?q=1#frag' }, all, {}, now)).toEqual({ ok: true, call: { op: 'fetch', url: 'https://api.good-site.io/v1?q=1' } })
    expect(checkCall({ op: 'addTask', text: '  Buy\nmilk ' }, all, {}, now)).toEqual({ ok: true, call: { op: 'addTask', text: 'Buy milk' } })
    expect(checkCall({ op: 'sound', name: 'chime' }, all, {}, now)).toEqual({ ok: true, call: { op: 'sound', name: 'chime' } })
  })
  it('unknown or malformed calls are refused (no way to the database, the PIN or the session)', () => {
    for (const msg of [null, 'fetch', {}, { op: 'sql', q: 'SELECT * FROM sys_auth' }, { op: 'session' }, { op: 'pin' }, { op: 'ipc', channel: 'desktop:load' }, { op: '__proto__' }, { op: 'sound', name: 'siren' }, { op: 'addTask', text: '' }, { op: 'addTask', text: 'x'.repeat(201) }, { op: 'addTask', text: 42 }])
      expect(checkCall(msg, all, {}, now).ok).toBe(false)
  })
  it('rate limits each kind of call', () => {
    const recent = { fetch: Array.from({ length: CALLS_PER_MIN.fetch }, (_, i) => now - i * 1000) }
    expect(checkCall({ op: 'fetch', url: 'https://api.good-site.io/' }, all, recent, now)).toMatchObject({ ok: false, error: expect.stringContaining('Too many') })
    expect(checkCall({ op: 'fetch', url: 'https://api.good-site.io/' }, all, recent, now + 61_000).ok).toBe(true)
  })
  it('grants never exceed what the manifest asks', () => {
    const narrow = (validateManifest({ id: 'nn', name: 'N', version: '1.0.0', author: 'A', size: '1x1', refresh: 60, permissions: ['read'] }) as { manifest: WidgetManifest }).manifest
    expect(cleanGrants(narrow, { read: true, network: ['evil.io'], add: true, sound: true })).toEqual({ read: true, network: [], add: false, sound: false })
    expect(cleanGrants(m, { network: ['api.good-site.io', 'evil.io'] }).network).toEqual(['api.good-site.io'])
  })
})

describe('widget network allowlist (PL2)', () => {
  const ok = ['api.good-site.io']
  it('only https, only listed hosts, no logins, no ports', () => {
    expect(checkUrl('https://api.good-site.io/data.json', ok)).toMatchObject({ ok: true, host: 'api.good-site.io' })
    expect(checkUrl('https://API.GOOD-SITE.IO/x', ok).ok).toBe(true)
    const no = (u: unknown) => expect(checkUrl(u, ok).ok).toBe(false)
    no('http://api.good-site.io/')
    no('https://evil.io/')
    no('https://api.good-site.io.evil.io/')
    no('https://evil.io/?u=https://api.good-site.io')
    no('https://user:pass@api.good-site.io/')
    no('https://api.good-site.io:8443/')
    no('https://127.0.0.1/')
    no('https://localhost/')
    no('file:///etc/passwd')
    no('javascript:alert(1)')
    no('life-system://app/api/db')
    no('/api/db')
    no('https://' + 'a'.repeat(600) + '.io/')
    no(42)
  })
  it('answers are text only and capped', () => {
    expect(fetchAnswer(200, 'application/json; charset=utf-8', '{"a":1}')).toEqual({ status: 200, type: 'application/json', body: '{"a":1}' })
    expect(fetchAnswer(200, 'image/png', 'PNGDATA').body).toBe('')
    expect(fetchAnswer(200, 'text/plain', 'x'.repeat(100_000)).body.length).toBe(64 * 1024)
  })
})

describe('the read-only data contract', () => {
  const snap: IslandSnapshot = { ...EMPTY_ISLAND, locked: false, now: { title: 'Study <b>block</b>', start: now - 60_000, end: now + 3600_000 }, next: { title: 'Gym', start: now + 7200_000, end: now + 9000_000 }, mustdos: [{ i: 0, text: 'Private thing', done: true }, { i: 1, text: 'Other', done: false }], points: { balance: 120, goal: null }, ben: { ...EMPTY_ISLAND.ben, last: { text: 'secret message from Ben', at: '', face: '' } } }
  it('without "read": only the time', () => {
    expect(Object.keys(widgetData(snap, now, { read: false }))).toEqual(['now', 'day'])
  })
  it('with "read": plan, focus, points, counts; never Ben’s messages or must-do texts', () => {
    const d = widgetData(snap, now, { read: true })
    expect(d.today?.plan.now?.title).toBe('Study block')
    expect(d.today?.mustdos).toEqual({ done: 1, total: 2 })
    expect(d.today?.points?.balance).toBe(120)
    const text = JSON.stringify(d)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('Private thing')
  })
  it('locked: only the time', () => {
    expect(widgetData({ ...snap, locked: true }, now, { read: true }).today).toBeUndefined()
  })
  it('frame messages are shape-checked', () => {
    expect(readFrameMsg({ t: 'call', id: 1, call: { op: 'x' } })).toEqual({ t: 'call', id: 1, call: { op: 'x' } })
    expect(readFrameMsg({ t: 'call', id: -1 })).toBeNull()
    expect(readFrameMsg({ t: 'eval', code: '1' })).toBeNull()
    expect(readFrameMsg({ t: 'busy', ms: 1e9 })).toEqual({ t: 'busy', ms: 60_000 })
  })
})

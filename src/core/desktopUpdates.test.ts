import { describe, expect, it, vi } from 'vitest'
import { alertDecisions, alertKeyboard, alertText, healthChecks, type HealthInput } from './health'
import { judgeRuns, refreshDesktopUpdates, type DesktopNote } from './desktopUpdates'

const now = new Date('2026-11-09T12:00:00Z')
const run = (conclusion: string | null, status = 'completed') => ({ status, conclusion, html_url: `https://github.com/x/actions/runs/${conclusion}` })
const fakeFetch = (runs: unknown[] | Error, tag = 'v1.2.3') =>
  vi.fn(async (url: any) => {
    if (runs instanceof Error) throw runs
    const u = String(url)
    if (u.includes('/runs')) return { ok: true, json: async () => ({ workflow_runs: runs }) }
    return { ok: true, json: async () => ({ tag_name: tag, published_at: '2026-11-08T12:00:00Z' }) }
  }) as any
const base: HealthInput = { now, beats: { tick: { ok: now.toISOString() } }, sportySeen: null, latestSnapshot: '2026-11-09', today: '2026-11-09', errors: [] }
const desktop = (note: DesktopNote | undefined, at = now) => healthChecks({ ...base, now: at, notes: note ? { desktopupdates: note } : {} }).find((c) => c.id === 'desktop')

describe('Desktop updates check', () => {
  it('two failed runs in a row is broken; one is not', () => {
    expect(judgeRuns([run('failure'), run('failure'), run('success')]).broken).toBe(true)
    expect(judgeRuns([run('failure'), run('success')]).broken).toBe(false)
  })
  it('cancelled and running runs are ignored', () => {
    expect(judgeRuns([run('failure'), run('cancelled'), run(null, 'in_progress'), run('failure')])).toMatchObject({ broken: true, failed: 2 })
    expect(judgeRuns([run('failure'), run('cancelled'), run('success')]).broken).toBe(false)
  })
  it('a GitHub error is unknown, never broken, and keeps the old answer', async () => {
    const n = await refreshDesktopUpdates(null, now, fakeFetch(new Error('offline')))
    expect(n.okAt).toBeUndefined()
    expect(desktop(n)).toMatchObject({ ok: true, unknown: true })
    const bad = await refreshDesktopUpdates(undefined, now, fakeFetch([run('failure'), run('failure')]))
    const later = new Date(now.getTime() + 2 * 3600_000)
    const kept = await refreshDesktopUpdates(bad, later, fakeFetch(new Error('403')))
    expect(kept.broken).toBe(true)
    const http = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as any
    expect((await refreshDesktopUpdates(null, now, http)).broken).toBeUndefined()
  })
  it('asks GitHub at most once an hour', async () => {
    const f = fakeFetch([run('success')])
    const a = await refreshDesktopUpdates(null, now, f)
    const calls = f.mock.calls.length
    const b = await refreshDesktopUpdates(a, new Date(now.getTime() + 59 * 60000), f)
    expect(f.mock.calls.length).toBe(calls)
    expect(b).toBe(a)
    await refreshDesktopUpdates(a, new Date(now.getTime() + 61 * 60000), f)
    expect(f.mock.calls.length).toBeGreaterThan(calls)
    expect(desktop(a)?.detail).toContain('1.2.3')
  })
  it('alerts once a day with the text, link and mute button, then says when it recovers', async () => {
    const n = await refreshDesktopUpdates(null, now, fakeFetch([run('failure'), run('failure')]))
    expect(desktop(n)).toMatchObject({ ok: false })
    const t1 = new Date(now.getTime() + 40 * 60000)
    const checks = healthChecks({ ...base, beats: { tick: { ok: t1.toISOString() } }, now: t1, notes: { desktopupdates: n } })
    const d1 = alertDecisions(checks, {}, t1, { today: '2026-11-09' })
    expect(d1.warn.map((c) => c.id)).toEqual(['desktop'])
    const text = alertText(d1.warn, [])
    expect(text).toContain("Desktop updates are not being built: the last 2 Windows release runs failed. The app on your PC can't update until it's fixed")
    expect(text).toContain('https://github.com/x/actions/runs/failure')
    expect(alertKeyboard(d1.warn)?.inline_keyboard[0][0].callback_data).toBe('hm|desktop')
    expect(alertDecisions(checks, d1.next, t1, { today: '2026-11-09' }).warn).toEqual([])
    const ok = await refreshDesktopUpdates(n, new Date(t1.getTime() + 61 * 60000), fakeFetch([run('success'), run('failure')]))
    const t2 = new Date(t1.getTime() + 62 * 60000)
    const d2 = alertDecisions(healthChecks({ ...base, beats: { tick: { ok: t2.toISOString() } }, now: t2, notes: { desktopupdates: ok } }), d1.next, t2, { today: '2026-11-09' })
    expect(d2.fixed).toEqual([])
    const t3 = new Date(t2.getTime() + 61 * 60000)
    const d3 = alertDecisions(healthChecks({ ...base, beats: { tick: { ok: t3.toISOString() } }, now: t3, notes: { desktopupdates: ok } }), d2.next, t3, { today: '2026-11-09' })
    expect(d3.fixed.map((c) => c.id)).toEqual(['desktop'])
  })
})

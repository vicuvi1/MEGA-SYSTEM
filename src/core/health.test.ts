import { describe, expect, it } from 'vitest'
import { alertDecisions, alertText, healthChecks, weeklyReport, type HealthInput } from './health'

const now = new Date('2026-11-04T12:00:00Z')
const min = (m: number) => new Date(now.getTime() - m * 60000).toISOString()
const base: HealthInput = { now, beats: { tick: { ok: min(5) } }, sportySeen: null, latestSnapshot: '2026-11-04', today: '2026-11-04', errors: [] }
const byId = (i: HealthInput) => Object.fromEntries(healthChecks(i).map((c) => [c.id, c]))

describe('system health', () => {
  it('all fine', () => {
    expect(healthChecks(base).every((c) => c.ok)).toBe(true)
  })

  it('server not running for 40 min, AI failing after its last success, Sporty gone, old snapshot', () => {
    const c = byId({
      ...base,
      beats: { tick: { ok: min(40) }, ai: { ok: min(120), err: { at: min(60), msg: 'OpenRouter 401' } } },
      sportySeen: min(30 * 60),
      latestSnapshot: '2026-11-01'
    })
    expect(c.tick).toMatchObject({ ok: false })
    expect(c.ai).toMatchObject({ ok: false })
    expect(c.ai.detail).toContain('OpenRouter 401')
    expect(c.sporty.ok).toBe(false)
    expect(c.snapshot.ok).toBe(false)
    // An error older than the last success is history, not a problem.
    expect(byId({ ...base, beats: { ...base.beats, telegram: { ok: min(1), err: { at: min(50), msg: 'x' } } } }).telegram.ok).toBe(true)
  })

  it('warns once after 30 min, then says when it is fixed', () => {
    const broken = healthChecks({ ...base, beats: { ...base.beats, ai: { err: { at: min(45), msg: 'down' } } } })
    const a = alertDecisions(broken, {}, now)
    expect(a.warn.map((c) => c.id)).toEqual(['ai'])
    expect(alertDecisions(broken, a.next, now).warn).toEqual([])
    const ok = healthChecks({ ...base, beats: { ...base.beats, ai: { ok: min(1), err: { at: min(45), msg: 'down' } } } })
    const b = alertDecisions(ok, a.next, now)
    expect(b.fixed.map((c) => c.id)).toEqual(['ai'])
    expect(b.next).toEqual({})
    expect(alertText(a.warn, [])).toContain("Ben's AI")
    // Fresh errors (under 30 min) don't alert yet.
    expect(alertDecisions(healthChecks({ ...base, beats: { ...base.beats, ai: { err: { at: min(10), msg: 'blip' } } } }), {}, now).warn).toEqual([])
  })

  it('weekly report', () => {
    const t = weeklyReport(healthChecks(base), [{ at: min(100), source: 'desktop', msg: 'x' }], now)
    expect(t).toContain('Everything is working')
    expect(t).toContain('desktop 1')
  })
})

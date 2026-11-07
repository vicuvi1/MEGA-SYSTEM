import { describe, expect, it } from 'vitest'
import { aiFailureCounts, alertDecisions, alertText, healthChecks, weeklyReport, type HealthInput } from './health'

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
    const broken = healthChecks({ ...base, beats: { ...base.beats, ai: { err: { at: min(35), msg: 'down' }, fails: { n: 3, since: min(45) } } } })
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

  it('a refused key says where to fix it', () => {
    const c = byId({ ...base, beats: { ...base.beats, telegram: { err: { at: min(40), msg: 'Unauthorized' } }, todoist: { ok: min(90), err: { at: min(35), msg: 'HTTP 401' } }, ai: { err: { at: min(40), msg: 'timeout' } } } })
    expect(c.telegram.detail).toContain('@BotFather')
    expect(c.todoist.detail).toContain('TODOIST_TOKEN')
    expect(c.ai.detail).toContain('timeout')
    expect(c.ai.detail).not.toContain('Vercel')
  })

  it('weekly report', () => {
    const t = weeklyReport(healthChecks(base), [{ at: min(100), source: 'desktop', msg: 'x' }], now)
    expect(t).toContain('Everything is working')
    expect(t).toContain('desktop 1')
  })

  // Coach bug (Sat 11:10): "Ben's AI: Failing since 34 min ago: The operation was aborted due to timeout".
  // One capped thinking try timed out (the chat answered with the quick model), then nobody
  // talked to Ben for 30 min: the single error turned into an alert.
  describe('a health card only for real, sustained failures', () => {
    const timeout = 'The operation was aborted due to timeout'
    it('one timeout followed by silence is not an outage, and never alerts', () => {
      const c = byId({ ...base, beats: { ...base.beats, ai: { ok: min(40), err: { at: min(34), msg: timeout }, fails: { n: 1, since: min(34) } } } })
      expect(c.ai.ok).toBe(true)
      expect(c.ai.detail).toMatch(/one call failed 34 min ago/)
      expect(alertDecisions(healthChecks({ ...base, beats: { ...base.beats, ai: { err: { at: min(34), msg: timeout } } } }), {}, base.now).warn).toEqual([])
    })
    it('three failures in a row for 30+ min alert once; the next OK clears it by itself', () => {
      const down = healthChecks({ ...base, beats: { ...base.beats, ai: { ok: min(90), err: { at: min(2), msg: timeout }, fails: { n: 4, since: min(40) } } } })
      const a = alertDecisions(down, {}, base.now)
      expect(a.warn.map((c) => c.id)).toEqual(['ai'])
      expect(a.warn[0].detail).toMatch(/Failing since 40 min ago \(4 failed in a row\)/)
      // The streak is reset by the OK write: the next check is OK and Ben says it works again.
      const up = healthChecks({ ...base, beats: { ...base.beats, ai: { ok: min(1), err: { at: min(2), msg: timeout } } } })
      const b = alertDecisions(up, a.next, base.now)
      expect(b.fixed.map((c) => c.id)).toEqual(['ai'])
      expect(alertText([], b.fixed)).toContain("Working again: Ben's AI")
    })
    it('a refused key still alerts after one failure', () => {
      expect(byId({ ...base, beats: { ...base.beats, ai: { err: { at: min(40), msg: 'OpenRouter 401: invalid api key' } } } }).ai.ok).toBe(false)
    })
    it('a capped thinking try and a call abandoned after a later answer do not count', () => {
      const t0 = 1_000_000
      expect(aiFailureCounts(new Error(timeout), { thinkMs: 16_000, noFallback: true }, t0, 0)).toBe(false)
      expect(aiFailureCounts(new Error('OpenRouter 502'), {}, t0, t0 + 5_000)).toBe(false)
      expect(aiFailureCounts(new Error(timeout), {}, t0, t0 - 1)).toBe(true)
      expect(aiFailureCounts(new Error('OpenRouter 502'), { thinkMs: 16_000, noFallback: true }, t0, 0)).toBe(true)
    })
  })
})

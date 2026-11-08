import { describe, expect, it } from 'vitest'
import { aiFailureCounts, ALERT_STEADY_MS, alertDecisions, alertKeyboard, alertText, brokenKinds, healthChecks, muteKind, readMutes, weeklyReport, type Check, type HealthInput } from './health'

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
    // "Working again" only once it has stayed OK for an hour.
    const b0 = alertDecisions(ok, a.next, now)
    expect(b0.fixed).toEqual([])
    const later = new Date(now.getTime() + 61 * 60000)
    const b = alertDecisions(ok, b0.next, later)
    expect(b.fixed.map((c) => c.id)).toEqual(['ai'])
    expect(b.next.ai).toMatchObject({ on: false })
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
      const b0 = alertDecisions(up, a.next, base.now)
      const b = alertDecisions(up, b0.next, new Date(base.now.getTime() + 60 * 60000))
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

// The owner's Telegram: "Ben's server: Last ran 4 h ago", "Ben's timer: Last ran 6 h ago" and
// "Ben's AI: Failing…" at 6:59 PM, 8:35 AM twice and 11:10 AM, day after day.
describe('alerts: at most once a day per problem, grouped, with what to do', () => {
  const at = (iso: string) => new Date(iso)
  const broken = (id: string, label: string, now: Date, detail = 'Last ran 6 h ago (should be every 10 min)'): Check => ({ id, label, ok: false, detail, since: new Date(now.getTime() - 6 * 3600_000).toISOString() })
  const fine = (id: string, label: string): Check => ({ id, label, ok: true, detail: 'Ran just now' })

  it('the same unresolved problem is told once a day, even when it flaps and two checkers find it', () => {
    const m835 = at('2026-11-07T08:35:00Z')
    const a = alertDecisions([broken('timer', "Ben's timer", m835)], {}, m835, { today: '2026-11-07' })
    expect(a.warn.map((c) => c.id)).toEqual(['timer'])
    // 8:35 again: the daily self-check finds the same thing ("sc:timer"): same kind, said already.
    expect(alertDecisions([broken('sc:timer', "Ben's timer", m835)], a.next, m835, { today: '2026-11-07' }).warn).toEqual([])
    // 9:50 GitHub ran the tick once (OK), 11:10 it is late again: no "working again", no new warning.
    const m950 = at('2026-11-07T09:50:00Z')
    const b = alertDecisions([fine('timer', "Ben's timer")], a.next, m950, { today: '2026-11-07' })
    expect(b.fixed).toEqual([])
    const m1110 = at('2026-11-07T11:10:00Z')
    const c = alertDecisions([broken('timer', "Ben's timer", m1110)], b.next, m1110, { today: '2026-11-07' })
    expect(c.warn).toEqual([])
    expect(c.next.timer.okSince).toBeUndefined()
    // 18:59 the same day: still nothing. The next morning: one reminder.
    const m1859 = at('2026-11-07T18:59:00Z')
    expect(alertDecisions([broken('timer', "Ben's timer", m1859)], c.next, m1859, { today: '2026-11-07' }).warn).toEqual([])
    const next = at('2026-11-08T08:35:00Z')
    expect(alertDecisions([broken('timer', "Ben's timer", next)], c.next, next, { today: '2026-11-08' }).warn.map((x) => x.id)).toEqual(['timer'])
  })

  it('"working again" only after a warning, and only once it stayed OK for an hour', () => {
    const now = at('2026-11-07T10:00:00Z')
    // Never warned: nothing to say.
    expect(alertDecisions([fine('ai', "Ben's AI")], {}, now, { today: '2026-11-07' }).fixed).toEqual([])
    const warned = { ai: { at: '2026-11-07T08:00:00.000Z', day: '2026-11-07', on: true } }
    const first = alertDecisions([fine('ai', "Ben's AI")], warned, now, { today: '2026-11-07' })
    expect(first.fixed).toEqual([])
    const hour = new Date(now.getTime() + ALERT_STEADY_MS)
    const second = alertDecisions([fine('ai', "Ben's AI")], first.next, hour, { today: '2026-11-07' })
    expect(second.fixed.map((c) => c.id)).toEqual(['ai'])
    expect(alertText([], second.fixed)).toBe("✅ Working again: Ben's AI.")
    // Broken again later the same day: already told today, so silent (and no second "working again").
    const late = at('2026-11-07T15:00:00Z')
    const third = alertDecisions([broken('ai', "Ben's AI", late, 'Failing')], second.next, late, { today: '2026-11-07' })
    expect(third.warn).toEqual([])
    expect(alertDecisions([fine('ai', "Ben's AI")], third.next, new Date(late.getTime() + 2 * ALERT_STEADY_MS), { today: '2026-11-07' }).fixed).toEqual([])
  })

  it('old notes (id → time) still work', () => {
    const now = at('2026-11-07T12:00:00Z')
    expect(alertDecisions([broken('ai', "Ben's AI", now, 'x')], { ai: '2026-11-07T09:00:00.000Z' }, now, { today: '2026-11-07' }).warn).toEqual([])
  })

  it('several problems at once are one message; the server line folds into the timer; steps with header names, never a secret', () => {
    const now = at('2026-11-07T08:35:00Z')
    const d = alertDecisions([broken('tick', "Ben's server", now, 'Last ran 4 h ago (should be every 10 min)'), broken('timer', "Ben's timer", now), broken('ai', "Ben's AI", now, 'Failing since 40 min ago (3 failed in a row): quick timed out after 30 s')], {}, now, { today: '2026-11-07' })
    expect(d.warn.map((c) => c.id).sort()).toEqual(['ai', 'tick', 'timer'])
    const text = alertText(d.warn, [], { appUrl: 'https://life.example/' })
    expect(text.match(/Something needs a look/g)).toHaveLength(1)
    expect(text).not.toContain("Ben's server</b>")
    expect(text).toContain("Ben's server stops too")
    expect(text).toContain('Set up a second pinger (3 steps)')
    expect(text).toContain('https://life.example/api/cron?job=tick every 10 minutes')
    expect(text).toContain('<code>Authorization</code>')
    expect(text).toContain('<code>X-Life-Timer</code> = <code>pinger</code>')
    expect(text).toContain('CRON_SECRET')
    expect(text).not.toMatch(/Bearer [A-Za-z0-9]{8,}/)
    expect(text).toContain('at most once a day')
    const kb = alertKeyboard(d.warn)!
    expect(kb.inline_keyboard.map((r) => r[0].callback_data)).toEqual(['hm|timer', 'hm|ai'])
    expect(kb.inline_keyboard[0][0].text).toContain('7 days')
  })

  it('"Mute this for 7 days" stops the warning (and the GitHub run failing) until the 7 days are over', () => {
    const now = at('2026-11-07T08:35:00Z')
    const mutes = muteKind({}, 'timer', now)
    expect(mutes.tick).toBe(mutes.timer)
    const checks = [broken('timer', "Ben's timer", now), broken('tick', "Ben's server", now)]
    expect(alertDecisions(checks, {}, now, { today: '2026-11-07', mutes }).warn).toEqual([])
    expect(brokenKinds(checks, now, mutes)).toEqual([])
    expect(brokenKinds(checks, now)).toEqual(['timer', 'tick'])
    const after = at('2026-11-14T09:00:00Z')
    expect(alertDecisions([broken('timer', "Ben's timer", after)], {}, after, { today: '2026-11-14', mutes }).warn.map((c) => c.id)).toEqual(['timer'])
    // Expired mutes are dropped on the next tap; junk in the setting reads as none.
    expect(Object.keys(muteKind(mutes, 'ai', after))).toEqual(['ai'])
    expect(readMutes('not json')).toEqual({})
  })

  it("this morning's self-check answer doesn't keep the timer broken once the live check is fine", () => {
    const c = byId({ ...base, beats: { tick: { ok: min(2) }, timer: { ok: min(5) } }, notes: { selfcheck: { at: min(120), line: '1 needs a look', checks: [{ id: 'sc:timer', label: "Ben's timer", ok: false, detail: 'Last ran 6 h ago', since: min(120) }] } } })
    expect(c['sc:timer']).toBeUndefined()
    expect(c.timer.ok).toBe(true)
  })
})

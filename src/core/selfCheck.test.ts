import { describe, expect, it } from 'vitest'
import { alertDecisions } from './health'
import { confirmed, selfCheckChecks, webhookVerdict } from './selfCheck'

const now = new Date('2026-11-05T09:00:00Z')
const fresh = new Date(now.getTime() - 5 * 60000).toISOString()
const URL = 'https://life.example/api/telegram?bot=777'
const base = { now, db: { ok: true, ms: 80 }, snapshot: { day: '2026-11-05', bytes: 400_000 }, drillAt: '2026-11-02T03:00:00Z', beats: { tick: { ok: fresh }, timer: { ok: fresh } } }

describe('Telegram links (CL3)', () => {
  it('a link that points elsewhere, misses button presses or keeps failing is set again', () => {
    expect(webhookVerdict({ url: URL, allowed_updates: ['message', 'callback_query'] }, URL, now)).toEqual({ ok: true, fix: false, problem: null })
    expect(webhookVerdict({ url: '', allowed_updates: [] }, URL, now)).toMatchObject({ ok: false, fix: true })
    expect(webhookVerdict({ url: URL, allowed_updates: ['message'] }, URL, now)).toMatchObject({ ok: false, fix: true })
    const failing = { url: URL, allowed_updates: ['message', 'callback_query'], last_error_date: now.getTime() / 1000 - 3600, last_error_message: 'Wrong response from the webhook: 500' }
    expect(webhookVerdict(failing, URL, now)).toMatchObject({ ok: false, fix: true, problem: expect.stringMatching(/500/) })
    // An old error (2 days ago) is history, not a problem.
    expect(webhookVerdict({ ...failing, last_error_date: now.getTime() / 1000 - 2 * 86400 }, URL, now).ok).toBe(true)
    expect(webhookVerdict({ url: URL, allowed_updates: ['callback_query'], pending_update_count: 80 }, URL, now)).toMatchObject({ ok: false, fix: false })
  })
})

describe('the daily self-check (CL3, CL11)', () => {
  it('all good is all green', () => {
    const c = selfCheckChecks({ ...base, bots: [{ name: 'MEGA_BOT_TOKEN', ok: true, pending: 0 }], ai: { ok: true, ms: 900, model: 'x/flash' }, budget: { spent: 2, budget: 10 }, google: { ok: true }, todoist: { ok: true } })
    expect(c.filter((x) => !x.ok)).toEqual([])
    expect(c.map((x) => x.id)).toEqual(expect.arrayContaining(['sc:bot:MEGA_BOT_TOKEN', 'sc:ai', 'sc:budget', 'sc:google', 'sc:todoist', 'sc:db', 'sc:snapshot', 'sc:drill', 'sc:tick', 'sc:timer']))
  })
  it('finds what is broken or close to a limit', () => {
    const old = new Date(now.getTime() - 3 * 3600_000).toISOString()
    const c = selfCheckChecks({
      ...base,
      ai: { ok: false, error: 'timed out' },
      budget: { spent: 8.5, budget: 10 },
      google: { ok: false, error: 'Google sign-in expired' },
      db: { ok: true, ms: 4000 },
      snapshot: { day: '2026-11-05', bytes: 3_600_000 },
      drillAt: '2026-10-20T03:00:00Z',
      beats: { tick: { ok: old }, timer: { ok: old } }
    })
    const bad = c.filter((x) => !x.ok).map((x) => x.id)
    expect(bad.sort()).toEqual(['sc:ai', 'sc:budget', 'sc:db', 'sc:drill', 'sc:google', 'sc:snapshot', 'sc:tick', 'sc:timer'])
    expect(c.find((x) => x.id === 'sc:budget')!.detail).toMatch(/85%/)
    expect(c.find((x) => x.id === 'sc:snapshot')!.detail).toMatch(/4\.5 MB/)
    expect(selfCheckChecks({ ...base, snapshot: null }).find((x) => x.id === 'sc:snapshot')!.ok).toBe(false)
  })
  it('a problem is told once a day (as the same kind as the 30-minute check), and "working again" comes when it stays fixed', () => {
    const broken = selfCheckChecks({ ...base, ai: { ok: false, error: 'down' } })
    const first = alertDecisions(confirmed(broken, now), {}, now)
    expect(first.warn.map((c) => c.id)).toEqual(['ai'])
    // The same day: not again (the 30-minute check of the AI is the same kind).
    expect(alertDecisions([{ id: 'ai', label: "Ben's AI", ok: false, detail: 'x', since: new Date(now.getTime() - 40 * 60000).toISOString() }], first.next, now).warn).toEqual([])
    const next = new Date(now.getTime() + 86400_000)
    const beats = { tick: { ok: next.toISOString() }, timer: { ok: next.toISOString() } }
    // Still broken on a new day: one reminder.
    expect(alertDecisions(confirmed(selfCheckChecks({ ...base, now: next, beats, drillAt: next.toISOString(), ai: { ok: false, error: 'down' } }), next), first.next, next).warn.map((c) => c.id)).toEqual(['ai'])
    const okChecks = (at: Date) => confirmed(selfCheckChecks({ ...base, now: at, beats, drillAt: next.toISOString(), ai: { ok: true } }), at)
    const seen = alertDecisions(okChecks(next), first.next, next)
    expect(seen.fixed).toEqual([])
    const hour = new Date(next.getTime() + 3600_000)
    expect(alertDecisions(okChecks(hour), seen.next, hour).fixed.map((c) => c.id)).toEqual(['ai'])
  })
})

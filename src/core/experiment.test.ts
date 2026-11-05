import { describe, expect, it } from 'vitest'
import { measureExperiment, pickExperiment } from './experiment'

const series = (from: string, n: number, v: (i: number) => number) => {
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const d = new Date(`${from}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    out[d.toISOString().slice(0, 10)] = v(i)
  }
  return out
}

describe('weekly experiment', () => {
  it('picks the change for the weakest area', () => {
    expect(pickExperiment({ sleep: 0.4, focus: 0.1 }).id).toBe('phone-out')
    expect(pickExperiment({ sleep: 0.4 }, ['phone-out']).id).not.toBe('phone-out')
  })
  it('measures 7 days against the 14 before', () => {
    // 14 days at 360 min of sleep, then 7 days at 420.
    const s = { ...series('2026-10-18', 14, () => 360), ...series('2026-11-01', 7, () => 420) }
    const mid = measureExperiment({ id: 'phone-out', start: '2026-11-01' }, s, '2026-11-03')!
    expect(mid).toMatchObject({ day: 3, done: false })
    const end = measureExperiment({ id: 'phone-out', start: '2026-11-01' }, s, '2026-11-08')!
    expect(end).toMatchObject({ done: true, changePct: 17 })
    expect(end.verdict).toMatch(/It works: 17% more min slept/)
  })
  it('spending: less is better', () => {
    const s = { ...series('2026-10-18', 14, () => 200), ...series('2026-11-01', 7, () => 150) }
    expect(measureExperiment({ id: 'cash-only', start: '2026-11-01' }, s, '2026-11-08')!.verdict).toMatch(/It works: 25% less/)
  })
})

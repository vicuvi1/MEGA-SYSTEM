import { describe, expect, it } from 'vitest'
import { lifeReview } from './lifeReview'

const fill = (today: string, from: number, to: number, v: number) => {
  const out: Record<string, number> = {}
  for (let k = from; k <= to; k++) {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - k)
    out[d.toISOString().slice(0, 10)] = v
  }
  return out
}

describe('weekly life review', () => {
  const today = '2026-11-08'
  it('3 findings from the biggest changes, and one experiment for the weakest area', () => {
    const r = lifeReview(
      {
        sleep: { ...fill(today, 0, 6, 330), ...fill(today, 7, 34, 450) }, // 2 h less a night
        workouts: { ...fill(today, 0, 6, 1), ...fill(today, 7, 34, 0.5) },
        focus: { ...fill(today, 0, 6, 60), ...fill(today, 7, 34, 60) },
        spend: { ...fill(today, 0, 6, 100), ...fill(today, 7, 34, 120) }
      },
      { crushed: 3, slips: 0, prevCrushed: 1 },
      today
    )
    expect(r.findings).toHaveLength(3)
    expect(r.findings.map((f) => f.area)).toContain('Sleep')
    expect(r.findings.find((f) => f.area === 'Sleep')!.text).toBe('5h30 a night, 120 min less than usual')
    expect(r.findings.some((f) => f.good)).toBe(true)
    expect(r.experiment.metric).toBe('sleep')
  })
})

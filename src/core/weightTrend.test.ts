import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { roughKcal, trendPoints, weightTrend } from './weightTrend'

const today = '2026-11-07'
/** Made-up weigh-ins every other day for 5 weeks, rising `perMonth` kg a month with a little noise. */
const series = (start: number, perMonth: number) =>
  Array.from({ length: 18 }, (_, i) => ({ day: addDays(today, -34 + i * 2), weight: Math.round((start + (perMonth / 30) * i * 2 + (i % 3 === 0 ? 0.3 : i % 3 === 1 ? -0.2 : 0)) * 10) / 10 }))

describe('weight trend (BD2)', () => {
  it('smooths daily swings into a 7-day average', () => {
    const pts = trendPoints([{ day: '2026-11-01', weight: 70 }, { day: '2026-11-02', weight: 71 }, { day: '2026-11-03', weight: 69.5 }], '2026-11-03')
    expect(pts.map((p) => p.trend)).toEqual([70, 70.5, 70.17])
  })
  it('waits for 2 weeks of weigh-ins', () => {
    const t = weightTrend([{ day: '2026-11-05', weight: 70 }, { day: '2026-11-06', weight: 70.2 }], today)
    expect(t.nudge).toBe('wait')
    expect(t.line).toMatch(/3 more morning weigh-ins/)
  })
  it('flat or losing: add about 200–300 kcal', () => {
    const t = weightTrend(series(70, 0), today)
    expect(t.nudge).toBe('add')
    expect(t.kcal).toBe(200)
    expect(t.line).toMatch(/Add about 200 kcal/)
    expect(weightTrend(series(70, -1), today).kcal).toBe(300)
  })
  it('on a lean-bulk pace: hold steady; too fast: ease off', () => {
    const t = weightTrend(series(70, 0.3), today)
    expect(t.nudge).toBe('hold')
    expect(t.targetKg!.lo).toBeCloseTo(0.18, 1)
    expect(weightTrend(series(70, 1.2), today).nudge).toBe('ease')
  })
  it('a rough daily need from weight only', () => {
    expect(roughKcal(70)).toBe(2300)
    expect(roughKcal(null)).toBeNull()
  })
})

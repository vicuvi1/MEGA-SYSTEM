import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, TODAY } from './growthFixture.test-helpers'
import { cleanZone, DEFAULT_ZONE, growthCheck, growthChart } from './growthCheck'

// The clock is pinned to the fixture's Monday; every input is made up.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
})
afterEach(() => vi.useRealTimers())

const sign = (c: ReturnType<typeof growthCheck>, id: string) => c.signs.find((s) => s.id === id)!

describe('the six signs and the verdict', () => {
  it('slow steady gain, waist flat, strong, fed and rested: yes, growing', () => {
    // +0.15 kg a week is about +0.65 kg a month, inside the zone.
    const c = growthCheck(fixture({ gainPerWeek: 0.15, waistPerWeek: 0 }))
    expect(sign(c, 'weight').state).toBe('good')
    expect(sign(c, 'waist').state).toBe('good')
    expect(sign(c, 'protein').state).toBe('good')
    expect(sign(c, 'sleep').state).toBe('good')
    expect(sign(c, 'strength').state).not.toBe('none')
    expect(c.verdict).toBe('yes')
    expect(c.score).toBeGreaterThanOrEqual(70)
    expect(c.headline).toBe('Yes, you are growing lean muscle.')
    expect(c.line).toMatch(/muscle, not fat/)
    expect(c.basis).toMatch(/signs are green.* · based on \d+ workouts, \d+ weigh-ins and \d+ food days/)
  })

  it('gaining too fast with a rising waist is not a green pattern, and says what to fix', () => {
    const c = growthCheck(fixture({ gainPerWeek: 0.6, waistPerWeek: 0.5 }))
    expect(sign(c, 'weight').state).toBe('fix')
    expect(sign(c, 'waist').state).toBe('fix')
    expect(c.verdict).not.toBe('yes')
    expect(c.faster.length).toBeGreaterThan(0)
    expect(c.faster.length).toBeLessThanOrEqual(2)
  })

  it('weight below the zone asks for more food', () => {
    const c = growthCheck(fixture({ gainPerWeek: 0.06 }))
    expect(['improve', 'fix']).toContain(sign(c, 'weight').state)
    expect(sign(c, 'weight').meaning).toMatch(/below the zone/)
  })

  it('protein: 6 of 7 is green, 5 of 7 is improve, 2 of 7 is fix', () => {
    const base = fixture()
    const days = (hit: number) => ({
      ...base,
      food: base.food.map((f, i, all) => {
        const back = all.length - 1 - i
        return back < 7 ? { ...f, protein: back < hit ? 160 : 40 } : f
      })
    })
    expect(sign(growthCheck(days(6)), 'protein').state).toBe('good')
    expect(sign(growthCheck(days(5)), 'protein').state).toBe('improve')
    expect(sign(growthCheck(days(2)), 'protein').state).toBe('fix')
    expect(sign(growthCheck(days(5)), 'protein').value).toBe('5 of 7 days')
  })

  it('sleep: 6 h 40 is improve and shows the average', () => {
    const base = fixture()
    const c = growthCheck({ ...base, sleep: base.sleep.map((s) => ({ ...s, minutes: 400 })) })
    expect(sign(c, 'sleep').state).toBe('improve')
    expect(sign(c, 'sleep').value).toBe('6 h 40')
    expect(sign(c, 'sleep').fix?.title).toBe('Sleep 7 h+.')
  })

  it('the zone is configurable and guarded', () => {
    expect(cleanZone({ lo: 0.2, hi: 0.5 })).toEqual({ lo: 0.2, hi: 0.5 })
    expect(cleanZone({ lo: 0.9, hi: 0.5 })).toEqual(DEFAULT_ZONE)
    expect(cleanZone(null)).toEqual(DEFAULT_ZONE)
    const wide = growthCheck(fixture({ gainPerWeek: 0.35 }), { zone: { lo: 1, hi: 2 } })
    expect(sign(wide, 'weight').goal).toBe('+2 kg max')
  })
})

describe('too little data: no made-up verdict, exactly what to log', () => {
  const empty = () => ({ ...fixture(), points: [], honestPoints: [], food: [], sleep: [], reps: [], sport: {} })

  it('nothing logged: no score, one line per missing thing', () => {
    const c = growthCheck(empty())
    expect(c.verdict).toBe('toolittle')
    expect(c.score).toBeNull()
    expect(c.signs.every((s) => s.state === 'none')).toBe(true)
    expect(c.missing).toHaveLength(6)
    expect(c.missing[0]).toMatch(/Log your sets/)
    expect(c.missing.join(' ')).toMatch(/Weigh in on 3 mornings a week/)
    expect(c.faster).toEqual([])
  })

  it('only food and sleep is still too little (no weight and no strength)', () => {
    const f = fixture()
    const c = growthCheck({ ...empty(), food: f.food, sleep: f.sleep })
    expect(c.verdict).toBe('toolittle')
    expect(c.missing.some((m) => /Weigh in/.test(m))).toBe(true)
  })

  it('one weigh-in is not a trend', () => {
    const f = fixture()
    const c = growthCheck({ ...empty(), points: f.points.slice(-1) })
    expect(sign(c, 'weight').state).toBe('none')
    expect(sign(c, 'weight').log).toMatch(/Weigh in on 3 mornings/)
  })
})

describe('the chart', () => {
  it('weekly weight and waist with the band from the first week', () => {
    const ch = growthChart(fixture({ gainPerWeek: 0.15 }))
    expect(ch.weeks).toHaveLength(8)
    expect(ch.weight).not.toBeNull()
    expect(ch.lo[0]).toBe(ch.firstWeight)
    const lastLo = ch.lo[7] as number
    const lastHi = ch.hi[7] as number
    expect(lastHi).toBeGreaterThan(lastLo)
    expect(lastLo).toBeGreaterThan(ch.firstWeight as number)
  })
})

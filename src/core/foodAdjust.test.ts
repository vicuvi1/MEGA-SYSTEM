import { describe, expect, it } from 'vitest'
import { addAdjLog, adjLogLine, adjustCheck, applyDelta, checkWeeks, cleanAdjLog, waistChange } from './foodAdjust'
import { cleanGoals } from './foodGoals'
import type { DayPoint } from './bodyComp'

// Made-up weigh-ins. TODAY is a Monday, so the latest full week is 2–8 Nov.
const TODAY = '2026-11-09'
const WEEKS = [
  ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-25'],
  ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-01'],
  ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08']
]
const pt = (day: string, weight: number | null, waist: number | null = null): DayPoint => ({ day, weight, waist, fat: null, muscle: null })
/** Three weeks of weights (oldest first), each four weigh-ins. */
const weeks = (...ws: number[][]): DayPoint[] => ws.flatMap((list, k) => list.map((w, i) => pt(WEEKS[k + (3 - ws.length)][i], w)))
const withWaist = (pts: DayPoint[], waists: [string, number][]) => {
  const out = pts.map((p) => ({ ...p }))
  for (const [day, w] of waists) {
    const p = out.find((x) => x.day === day)
    if (p) p.waist = w
    else out.push(pt(day, null, w))
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1))
}

const flat = weeks([73.5, 73.4, 73.6, 73.5], [73.5, 73.6, 73.4, 73.5], [73.6, 73.5, 73.5, 73.6])
const fast = weeks([73.0, 73.0, 73.0, 73.0], [73.5, 73.5, 73.5, 73.5], [74.2, 74.2, 74.3, 74.3])
const good = weeks([73.5, 73.5, 73.5, 73.5], [73.8, 73.8, 73.9, 73.8], [74.1, 74.2, 74.1, 74.2])

describe('the one calorie suggestion', () => {
  it('not enough data: under 3 weigh-ins in a week', () => {
    // 26 Oct–1 Nov has only 2 weigh-ins: the week before the latest does not count.
    const few = [pt('2026-10-26', 73.5), pt('2026-10-30', 73.5), ...weeks([73.6, 73.6, 73.7, 73.7])]
    const r = adjustCheck({ points: few, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state === 'none' && r.kind).toBe('nodata')
    expect(r.title).toBe('Not enough data yet')
    expect(r.why).toMatch(/Weigh in 3\+ mornings a week/)
    expect(adjustCheck({ points: [], today: TODAY, adj: 0, adjAt: '' }).title).toBe('Not enough data yet')
  })

  it('gain under 0.1 kg a week for 2 weeks in a row → +200 with the milk and peanut butter idea', () => {
    const r = adjustCheck({ points: flat, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state).toBe('suggest')
    if (r.state !== 'suggest') return
    expect(r.suggestion).toMatchObject({ delta: 200, after: 200, reason: 'Weight flat for 2 weeks' })
    expect(r.suggestion.tip).toMatch(/glass of milk \+ 1 spoon of peanut butter/)
  })

  it('flat only one week (rising the week before) or a missing third week: no suggestion yet', () => {
    const rose = weeks([73.0, 73.0, 73.0, 73.0], [73.5, 73.5, 73.5, 73.5], [73.5, 73.5, 73.6, 73.5])
    expect(adjustCheck({ points: rose, today: TODAY, adj: 0, adjAt: '' }).state).toBe('none')
    const two = weeks([73.5, 73.6, 73.4, 73.5], [73.6, 73.5, 73.5, 73.6])
    const r = adjustCheck({ points: two, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state === 'none' && r.kind).toBe('wait')
    expect(r.why).toMatch(/One more week/)
  })

  it('gain over 0.6 kg a week AND waist up more than 1 cm in 2 weeks → −150 (−200 over 0.8)', () => {
    const waistUp = withWaist(fast, [['2026-10-25', 80], ['2026-11-08', 81.2]])
    const r = adjustCheck({ points: waistUp, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state === 'suggest' && r.suggestion.delta).toBe(-150) // +0.75 kg a week
    const faster = withWaist(weeks([73.0, 73.0, 73.0, 73.0], [73.5, 73.5, 73.5, 73.5], [74.4, 74.4, 74.4, 74.4]), [['2026-10-25', 80], ['2026-11-08', 81.5]])
    const r2 = adjustCheck({ points: faster, today: TODAY, adj: 0, adjAt: '' })
    expect(r2.state === 'suggest' && r2.suggestion.delta).toBe(-200) // +0.9 kg a week
  })

  it('the waist condition: exactly +1 cm, a steady waist or no waist does not cut', () => {
    const one = adjustCheck({ points: withWaist(fast, [['2026-10-25', 80], ['2026-11-08', 81]]), today: TODAY, adj: 0, adjAt: '' })
    expect(one.state === 'none' && one.title).toBe('On track 👍')
    const none = adjustCheck({ points: fast, today: TODAY, adj: 0, adjAt: '' })
    expect(none.state === 'none' && none.kind).toBe('waist')
    // A waist 3+ weeks old is not "in 2 weeks".
    const old = adjustCheck({ points: withWaist(fast, [['2026-10-10', 79], ['2026-11-08', 81.5]]), today: TODAY, adj: 0, adjAt: '' })
    expect(old.state === 'none' && old.kind).toBe('waist')
  })

  it('+0.25–0.5 kg a week: On track', () => {
    const r = adjustCheck({ points: good, today: TODAY, adj: 0, adjAt: '' })
    expect(r.state === 'none' && r.title).toBe('On track 👍')
    expect(r.why).toMatch(/^\+0\.3\d kg a week \(the target is \+0\.25–0\.5 kg a week\)/)
  })

  it('this week counts once it has 3 weigh-ins', () => {
    const pts = [...flat, pt('2026-11-09', 73.6), pt('2026-11-10', 73.5), pt('2026-11-11', 73.6)]
    const w = checkWeeks(pts, '2026-11-11')
    expect(w.w0.week).toBe('2026-11-09')
    expect(checkWeeks(flat, TODAY).w0.week).toBe('2026-11-02')
  })

  it('bounded at ±600 and once a week after an answer', () => {
    expect(adjustCheck({ points: flat, today: TODAY, adj: 500, adjAt: '' }).state).toBe('none')
    expect(adjustCheck({ points: withWaist(fast, [['2026-10-25', 80], ['2026-11-08', 82]]), today: TODAY, adj: -500, adjAt: '' }).state).toBe('none')
    const checked = adjustCheck({ points: flat, today: TODAY, adj: 0, adjAt: '2026-11-05' })
    expect(checked.state === 'none' && checked.kind).toBe('checked')
    expect(adjustCheck({ points: flat, today: TODAY, adj: 0, adjAt: '2026-11-02' }).state).toBe('suggest')
    expect(applyDelta(500, 200)).toBe(600)
    expect(applyDelta(-500, -200)).toBe(-600)
  })

  it('a maintain goal never adds for flat weight', () => {
    expect(adjustCheck({ points: flat, today: TODAY, adj: 0, adjAt: '', goal: 'maintain' }).state).toBe('none')
  })

  it('waistChange compares the latest waist with one 10–21 days before', () => {
    expect(waistChange([pt('2026-10-25', null, 80), pt('2026-11-08', null, 81)], TODAY)).toBe(1)
    expect(waistChange([pt('2026-11-08', null, 81)], TODAY)).toBeNull()
    expect(waistChange([pt('2026-11-04', null, 80), pt('2026-11-08', null, 81)], TODAY)).toBeNull()
  })
})

describe('the calorie change history', () => {
  it('records date, change and reason, newest first, capped and cleaned', () => {
    let log = addAdjLog([], { day: '2026-10-20', delta: 200, after: 200, reason: 'Weight flat for 2 weeks' })
    log = addAdjLog(log, { day: '2026-11-09', delta: -150, after: 50, reason: 'Gaining +0.75 kg a week, waist +1.2 cm' })
    expect(log.map((e) => e.day)).toEqual(['2026-11-09', '2026-10-20'])
    expect(adjLogLine(log[0])).toBe('2026-11-09 · −150 kcal · Gaining +0.75 kg a week, waist +1.2 cm')
    expect(adjLogLine(log[1])).toBe('2026-10-20 · +200 kcal · Weight flat for 2 weeks')
    expect(cleanAdjLog([{ day: 'x', delta: 5 }, { day: '2026-11-01', delta: 0 }, null, { day: '2026-11-02', delta: 9999, after: 9999, reason: 'r' }])).toEqual([{ day: '2026-11-02', delta: 600, after: 600, reason: 'r' }])
    let many: ReturnType<typeof cleanAdjLog> = []
    for (let i = 1; i <= 25; i++) many = addAdjLog(many, { day: `2026-10-${String(i).padStart(2, '0')}`, delta: 200, after: 200, reason: '' })
    expect(many).toHaveLength(20)
    expect(many[0].day).toBe('2026-10-25')
    // Kept in the goals setting.
    expect(cleanGoals({ adjLog: log }).adjLog).toHaveLength(2)
    expect(cleanGoals({}).adjLog).toEqual([])
  })
})

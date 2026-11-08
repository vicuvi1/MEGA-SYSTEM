// Body → Progress: strength change, smoothing and the verdict, records, the monthly report. Made-up data, pinned dates.
import { describe, expect, it } from 'vitest'
import { addSets, shiftDay, type SetLog } from './sportSets'
import { bodyVerdict, monthReport, personalRecords, strengthHero, strengthView, trendView } from './bodyProgress'

const TODAY = '2026-11-08'
const ago = (n: number) => shiftDay(TODAY, -n)
const PU = { id: 'pu', name: 'Push-ups', target: 40, active: true, move: 'pushup' }
const DM = { id: 'dm', name: 'Diamond push-ups', target: 24, active: true, move: 'diamond_pushup' }
const PL = { id: 'pl', name: 'Plank', target: 90, unit: 'sec', active: true, move: 'plank' }

function sets(rows: [number, string, number[]][]): SetLog {
  let l: SetLog = {}
  for (const [n, id, reps] of rows) l = addSets(l, ago(n), id, reps, Date.parse(ago(n) + 'T10:00:00Z'))
  return l
}
const weigh = (rows: [number, number][]) => rows.map(([n, weight]) => ({ day: ago(n), weight }))
const waist = (rows: [number, number][]) => rows.map(([n, w]) => ({ day: ago(n), waist: w }))

describe('strength per move', () => {
  it('says how much stronger than 4 weeks ago, a harder variation counts as growth', () => {
    const log = sets([[28, 'pu', [15, 14]], [3, 'dm', [10, 9]]])
    const v = strengthView(log, [PU, DM], 'pushup', TODAY)
    expect(v.points.map((p) => p.name)).toEqual(['Push-ups', 'Diamond push-ups'])
    expect(v.bands.map((b) => b.name)).toEqual(['Push-ups', 'Diamond push-ups'])
    expect(v.pct).toBe(Math.round(((1.2 ** 2 * (1 + 10 / 30)) / (1 + 15 / 30) - 1) * 100))
    expect(v.line).toMatch(/^\+\d+% stronger than 4 weeks ago/)
  })
  it('same move, more reps', () => {
    const v = strengthView(sets([[28, 'pu', [10]], [2, 'pu', [20]]]), [PU], 'pushup', TODAY)
    expect(v.pct).toBe(Math.round(((1 + 20 / 30) / (1 + 10 / 30) - 1) * 100))
  })
  it('has no percent with too little data, and an empty state', () => {
    expect(strengthView(sets([[2, 'pu', [10]]]), [PU], 'pushup', TODAY).pct).toBeNull()
    expect(strengthView({}, [PU], 'row', TODAY).line).toMatch(/No rows sets yet/)
    expect(strengthHero({}, [PU], TODAY)).toEqual({ pct: null, used: 0 })
  })
  it('compares with the first week when the history is newer', () => {
    const v = strengthView(sets([[12, 'pu', [10]], [1, 'pu', [15]]]), [PU], 'pushup', TODAY)
    expect(v.pct).toBe(Math.round(((1 + 15 / 30) / (1 + 10 / 30) - 1) * 100))
    expect(v.line).toMatch(/your first week/)
  })
})

describe('weight and waist verdict', () => {
  const steady = (start: number, end: number) => {
    const rows: [number, number][] = []
    for (let n = 35; n >= 0; n -= 2) rows.push([n, start + ((35 - n) / 35) * (end - start)])
    return rows
  }
  it('is empty with too few weigh-ins', () => {
    const v = bodyVerdict(weigh([[3, 70]]), [], TODAY)
    expect(v.tone).toBe('none')
    expect(v.text).toMatch(/Log weight and waist weekly/)
  })
  it('weight up, waist the same: likely muscle', () => {
    const v = bodyVerdict(weigh(steady(70, 70.6)), waist([[34, 80], [1, 80.2]]), TODAY)
    expect(v.tone).toBe('good')
    expect(v.text).toMatch(/^\+0\.\d kg in 4 weeks, waist the same: likely muscle\.$/)
  })
  it('waist up 1.5 cm: slow the surplus', () => {
    const v = bodyVerdict(weigh(steady(70, 71)), waist([[34, 80], [1, 81.5]]), TODAY)
    expect(v.tone).toBe('warn')
    expect(v.text).toMatch(/waist up 1\.5 cm: slow the surplus/)
    expect(v.dWaist).toBe(1.5)
  })
  it('flat weight and weight loss', () => {
    expect(bodyVerdict(weigh(steady(70, 70.02)), waist([[34, 80], [1, 80]]), TODAY).text).toMatch(/flat/)
    expect(bodyVerdict(weigh(steady(71, 70)), waist([[34, 80], [1, 80]]), TODAY).text).toMatch(/losing weight/)
  })
  it('asks for the waist when there is none', () => {
    expect(bodyVerdict(weigh(steady(70, 70.5)), [], TODAY).text).toMatch(/Log your waist too/)
  })
  it('smooths with a 7-day average and builds the lean zone', () => {
    const t = trendView(weigh([[20, 70], [19, 71], [18, 70], [17, 71], [16, 70], [10, 70.4], [1, 70.8]]), waist([[10, 80]]), TODAY)
    expect(t.points.find((p) => p.day === ago(16))!.trend).toBe(70.4)
    expect(t.zone!.lo1).toBeLessThan(t.zone!.hi1)
    expect(t.zone!.hi1 - t.zone!.hi0).toBeGreaterThan(t.zone!.lo1 - t.zone!.lo0)
    expect(t.waist).toHaveLength(1)
  })
})

describe('personal records', () => {
  const log = sets([[20, 'pu', [12, 10]], [9, 'pu', [18]], [2, 'dm', [8]], [5, 'pl', [45]], [1, 'pl', [60]]])
  const days: Record<string, Record<string, number>> = { [ago(9)]: { pu: 40, pl: 45 }, [ago(2)]: { dm: 24 }, [ago(20)]: { pu: 22 } }
  const r = personalRecords(log, [PU, DM, PL], days, TODAY)
  it('finds max reps, longest hold, best day, first harder step', () => {
    const by = (id: string) => r.find((x) => x.id === id)!
    expect(by('reps-pushup')).toMatchObject({ value: '18 reps', day: ago(9), isNew: false })
    expect(by('hold-plank')).toMatchObject({ value: '60 s', isNew: true })
    expect(by('best-day')).toMatchObject({ value: '40 reps', day: ago(9) })
    expect(by('first-diamond_pushup')).toMatchObject({ day: ago(2), isNew: true })
    expect(r.find((x) => x.id === 'first-pushup')).toBeUndefined()
  })
  it('puts new records first', () => {
    expect(r[0].isNew).toBe(true)
    expect(r[r.length - 1].isNew).toBe(false)
  })
  it('is empty with no sets', () => expect(personalRecords({}, [PU], {}, TODAY)).toEqual([]))
})

describe('monthly report', () => {
  const log = sets([[35, 'pu', [12]], [2, 'pu', [18]], [3, 'dm', [6]]])
  const metrics = [
    { day: ago(30), weight: 70, waist: 80 },
    { day: ago(1), weight: 70.6, waist: 80.3 }
  ]
  it('puts the numbers together with one goal and copyable text', () => {
    const m = monthReport({ today: TODAY, log, exercises: [PU, DM], metrics, workoutDays: [ago(2), ago(6), ago(60)], protein: { hit: 5, days: 7 } })
    expect(m.label).toBe('November 2026')
    expect(m.weightKg).toBe(0.6)
    expect(m.waistCm).toBe(0.3)
    expect(m.workouts).toBe(3)
    expect(m.strengthPct).not.toBeNull()
    expect(m.goal).toMatch(/^Add 1 rep/)
    expect(m.text).toContain('protein goal 5 of the last 7 days')
    expect(m.text).toContain('Next goal:')
  })
  it('shows the last month in the first week of a new one', () => {
    const m = monthReport({ today: '2026-11-04', log: {}, exercises: [], metrics: [], workoutDays: ['2026-10-12'], protein: null })
    expect(m.label).toBe('October 2026')
    expect(m.workouts).toBe(1)
    expect(m.strengthPct).toBeNull()
    expect(m.goal).toMatch(/Log your sets/)
  })
  it('a waist up 1 cm or more sets the goal', () => {
    const m = monthReport({ today: TODAY, log, exercises: [PU, DM], metrics: [{ day: ago(30), waist: 80 }, { day: ago(1), waist: 81.2 }], workoutDays: [], protein: null })
    expect(m.goal).toMatch(/Hold your food steady/)
  })
})

import { describe, expect, it } from 'vitest'
import { cleanWeek, DEFAULT_DAYS, todayPlan, validateWeek, type DayType, type TrainWeek } from './trainWeek'

const week = (days: DayType[] = DEFAULT_DAYS): TrainWeek => ({ v: 1, days, updatedAt: 1 })
// 2026-11-09 is a Monday.
const TUE = '2026-11-10', WED = '2026-11-11', THU = '2026-11-12', FRI = '2026-11-13', SAT = '2026-11-14', SUN = '2026-11-15'

const twoInARow = (d: DayType[]) => d.some((t, i) => t !== 'rest' && t === d[(i + 6) % 7])

describe('the weekly split', () => {
  it('the default week never trains a muscle two days in a row, Sunday to Monday included', () => {
    expect(DEFAULT_DAYS).toEqual(['rest', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper'])
    expect(validateWeek(DEFAULT_DAYS)).toEqual({ ok: true, days: DEFAULT_DAYS, message: null })
    // Monday Legs + core (the optional extra) is fine too.
    expect(validateWeek(['legs', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper']).ok).toBe(true)
  })

  it('fixes two upper days in a row on the later day and says why in plain words', () => {
    const r = validateWeek(['rest', 'upper', 'upper', 'upper', 'rest', 'legs', 'upper'])
    expect(r.ok).toBe(false)
    expect(twoInARow(r.days)).toBe(false)
    expect(r.days[2]).toBe('legs')
    expect(r.message).toMatch(/Wednesday is now Legs \+ core/)
    expect(r.message).toMatch(/48 hours/)
  })

  it('keeps the day you just edited and moves its neighbour', () => {
    // You turned Friday into Upper next to Thursday's Upper: Thursday moves, Friday stays.
    const r = validateWeek(['rest', 'upper', 'legs', 'upper', 'upper', 'legs', 'upper'], 4)
    expect(r.days[4]).toBe('upper')
    expect(twoInARow(r.days)).toBe(false)
  })

  it('turns a day into rest when neither session fits, and wraps Sunday into Monday', () => {
    const r = validateWeek(['upper', 'legs', 'rest', 'rest', 'rest', 'legs', 'upper'])
    expect(r.ok).toBe(false)
    expect(twoInARow(r.days)).toBe(false)
    const all = validateWeek(['upper', 'upper', 'upper', 'upper', 'upper', 'upper', 'upper'])
    expect(twoInARow(all.days)).toBe(false)
  })

  it('rest days are yours to change', () => {
    const r = validateWeek(['upper', 'legs', 'rest', 'upper', 'legs', 'rest', 'rest'])
    expect(r.ok).toBe(true)
    expect(cleanWeek({ days: ['x'] }).days).toEqual(DEFAULT_DAYS)
  })
})

describe("today's session", () => {
  it('follows the week, and a rest day says so calmly with the next session', () => {
    expect(todayPlan(week(), [], TUE)).toMatchObject({ type: 'upper', why: 'planned' })
    const fri = todayPlan(week(), [{ date: THU, type: 'upper' }], FRI)
    expect(fri.type).toBe('rest')
    expect(fri.line).toMatch(/^Rest day: walk, stretch, eat your full food\. Muscles grow today\./)
    expect(fri.next).toEqual({ day: SAT, type: 'legs' })
    // "Train anyway" offers a session that keeps 48 hours: not upper the day after upper.
    expect(fri.anyway).toBe('legs')
  })

  it("a missed session moves to a rest day when it keeps 48 hours, without guilt", () => {
    // Thursday's Upper didn't happen; the last upper was Tuesday.
    const fri = todayPlan(week(), [{ date: TUE, type: 'upper' }, { date: WED, type: 'legs' }], FRI)
    expect(fri).toMatchObject({ type: 'upper', why: 'catch-up' })
    expect(fri.line).toMatch(/Thursday's Upper body didn't happen/)
    expect(fri.line).not.toMatch(/fail|lazy|should have|missed out/i)
    // A first visit (nothing logged yet) is a plain rest day, never "didn't happen".
    expect(todayPlan(week(), [], FRI)).toMatchObject({ type: 'rest', why: 'rest' })
  })

  it('never puts the same muscles on two days in a row', () => {
    // Upper on Saturday (a catch-up), Sunday's plan is upper → Legs + core instead.
    const sun = todayPlan(week(), [{ date: SAT, type: 'upper' }, { date: FRI, type: 'legs' }], SUN)
    expect(sun).toMatchObject({ type: 'legs', why: 'moved' })
    // Both kinds done in the last day: rest.
    const mon = todayPlan(week(['upper', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper']), [{ date: SUN, type: 'upper' }, { date: SUN, type: 'legs' }], '2026-11-16')
    expect(mon.type).toBe('rest')
  })

  it('done for today once a session is logged', () => {
    expect(todayPlan(week(), [{ date: WED, type: 'legs' }], WED)).toMatchObject({ type: 'legs', why: 'done' })
  })
})

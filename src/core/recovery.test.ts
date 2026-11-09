import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agoText, groupOfMuscle, groupsOfMove, recommend, recoveryMap, statusOf, REGION_GROUP } from './recovery'
import { REGIONS } from './bodyMap'
import { DEFAULT_DAYS, todayPlan, type DoneSession, type TrainWeek } from './trainWeek'

// Made-up data. 2026-11-09 is a Monday; the default week is rest · Upper · Legs · Upper · rest · Legs · Upper.
const week: TrainWeek = { v: 1, days: DEFAULT_DAYS, updatedAt: 1 }
const at = (day: string, hh: number) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00`).getTime()
const ex = [
  { id: 'e_push', name: 'Push-ups', move: 'pushup', unit: 'reps' },
  { id: 'e_row', name: 'Table rows', move: 'table_row', unit: 'reps' },
  { id: 'e_pike', name: 'Pike push-ups', move: 'pike_pushup', unit: 'reps' },
  { id: 'e_squat', name: 'Split squats', move: 'split_squat', unit: 'reps' },
  { id: 'e_plank', name: 'Plank', move: 'plank', unit: 'sec' },
  { id: 'e_pull', name: 'Pull-ups', move: 't:pullup', unit: 'reps' }
] as any[]
const sets = (day: string, hh: number, reps: number[], feel?: 'hard' | 'ok' | 'easy') =>
  reps.map((r, i) => ({
    reps: r,
    at: at(day, hh) + i * 60000,
    id: `${day}-${hh}-${i}`,
    ...(feel ? { feel } : {})
  }))

describe('the move → muscle mapping', () => {
  it('reads the move library muscles into six groups, each move on its own half of the body', () => {
    expect(groupOfMuscle('Thighs (quads)')).toBe('legs')
    expect(groupOfMuscle('Upper back')).toBe('back')
    expect(groupOfMuscle('Triceps')).toBe('arms')
    expect(groupOfMuscle('Lower abs')).toBe('core')
    expect(groupOfMuscle('Balance')).toBeNull()
    expect(groupsOfMove('pushup')).toEqual(['chest', 'arms'])
    expect(groupsOfMove('table_row')).toEqual(['back', 'arms'])
    expect(groupsOfMove('pike_pushup')).toEqual(['shoulders', 'arms'])
    // A plank's shoulders are a helper: it trains the core.
    expect(groupsOfMove('plank')).toEqual(['core'])
    expect(groupsOfMove('split_squat')).toEqual(['legs'])
    // Body Training's own moves (no demo) map too.
    expect(groupsOfMove('pullup')).toEqual(['back', 'arms'])
    expect(groupsOfMove('nope')).toEqual([])
  })

  it('every drawn body map region has a recovery group', () => {
    for (const r of REGIONS) expect(REGION_GROUP[r.id]).toBeTruthy()
  })
})

describe('recovery per muscle group', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T08:30:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('red under 24 h, yellow 24–48 h, green after 48 h or when not trained lately', () => {
    expect(statusOf(null)).toBe('green')
    expect(statusOf(10)).toBe('red')
    expect(statusOf(30)).toBe('yellow')
    expect(statusOf(48)).toBe('green')
    const now = at('2026-11-12', 8) // Thursday 08:00
    const st = {
      exercises: ex,
      sets: {
        // Tuesday 18:00 upper: chest, back, arms → 38 h → yellow.
        '2026-11-10': {
          e_push: sets('2026-11-10', 18, [12, 11, 10]),
          e_row: sets('2026-11-10', 18, [10, 9, 9])
        },
        // Wednesday 19:00 legs: legs, core → 13 h → red.
        '2026-11-11': {
          e_squat: sets('2026-11-11', 19, [12, 12]),
          e_plank: sets('2026-11-11', 19, [45, 40])
        },
        // A week ago shoulders: green.
        '2026-11-04': { e_pike: sets('2026-11-04', 18, [10, 10]) }
      }
    }
    const r = Object.fromEntries(recoveryMap(st, now, '2026-11-12').map((g) => [g.id, g]))
    expect(r.chest).toMatchObject({
      status: 'yellow',
      hours: 38,
      lastDay: '2026-11-10'
    })
    expect(r.back.status).toBe('yellow')
    expect(r.arms.status).toBe('yellow')
    expect(r.legs).toMatchObject({ status: 'red', hours: 13 })
    expect(r.core.status).toBe('red')
    expect(r.shoulders.status).toBe('green')
    expect(agoText(13)).toBe('13 h ago')
    expect(agoText(60)).toBe('3 days ago')
  })

  it('warm-ups, "Easy" sets and tiny sets are not hard sets', () => {
    const now = at('2026-11-12', 8)
    const st = {
      exercises: ex,
      sets: {
        // Only an easy set and a warm-up today: chest stays as it was (green).
        '2026-11-12': {
          e_push: [...sets('2026-11-12', 7, [20], 'easy'), ...sets('2026-11-12', 7, [3])]
        }
      }
    }
    const r = recoveryMap(st, now, '2026-11-12')
    expect(r.find((g) => g.id === 'chest')!.status).toBe('green')
  })

  it('a set saved without a time counts at 18:00 on its day; a time outside its day is kept inside it', () => {
    const now = at('2026-11-12', 8)
    const st = {
      exercises: ex,
      sets: {
        '2026-11-11': {
          e_pull: [{ reps: 8 }, { reps: 8, at: at('2026-11-01', 9) }]
        }
      }
    }
    const back = recoveryMap(st, now, '2026-11-12').find((g) => g.id === 'back')!
    // 18:00 Wednesday → 14 h (the back-dated time is pulled into Wednesday 04:00, the 18:00 one is later).
    expect(back).toMatchObject({ status: 'red', hours: 14 })
  })
})

describe('what is best to train today', () => {
  const rec = (status: Record<string, 'red' | 'yellow' | 'green'>) =>
    (['chest', 'back', 'shoulders', 'arms', 'legs', 'core'] as const).map((id) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      hours: status[id] === 'red' ? 12 : status[id] === 'yellow' ? 30 : null,
      status: status[id] ?? 'green',
      lastDay: null
    }))

  it('agrees with the split when its muscles are ready', () => {
    const done: DoneSession[] = [{ date: '2026-11-08', type: 'upper' }]
    const plan = todayPlan(week, done, '2026-11-10') // Tuesday: Upper
    const r = recommend(plan, rec({ legs: 'red' }), week, done, '2026-11-10')
    expect(r).toEqual({
      type: 'upper',
      line: 'Best to train today: Upper (back and chest are ready).',
      swap: null
    })
    const half = recommend(plan, rec({ chest: 'yellow' }), week, done, '2026-11-10')
    expect(half.line).toBe('Best to train today: Upper (back is ready, chest nearly).')
  })

  it('suggests a swap after a missed session, using the week rule', () => {
    // Wednesday's Legs + core didn't happen; Thursday is Upper (trained Tuesday).
    const done: DoneSession[] = [
      { date: '2026-11-08', type: 'upper' },
      { date: '2026-11-10', type: 'upper' }
    ]
    const plan = todayPlan(week, done, '2026-11-12')
    expect(plan.type).toBe('upper')
    const r = recommend(plan, rec({}), week, done, '2026-11-12')
    expect(r.swap).toBe('legs')
    expect(r.type).toBe('legs')
    expect(r.line).toBe("Wednesday's Legs + core was missed. Best to train today: Legs + core (legs and core are ready), then Upper next time.")
  })

  it('swaps when today’s muscles are still red and the other session is ready, else says go lighter', () => {
    const done: DoneSession[] = [{ date: '2026-11-07', type: 'legs' }]
    const plan = todayPlan(week, done, '2026-11-10')
    const r = recommend(plan, rec({ chest: 'red' }), week, done, '2026-11-10')
    expect(r.swap).toBe('legs')
    expect(r.line).toMatch(/^Chest is still recovering \(trained 12 h ago\)\. Best to train today: Legs \+ core instead/)
    const both = recommend(plan, rec({ chest: 'red', legs: 'red' }), week, done, '2026-11-10')
    expect(both).toMatchObject({ type: 'upper', swap: null })
    expect(both.line).toMatch(/Go lighter today, or rest\.$/)
  })

  it('a rest day stays rest, done stays done', () => {
    const done: DoneSession[] = [{ date: '2026-11-08', type: 'upper' }]
    const mon = recommend(todayPlan(week, done, '2026-11-09'), rec({}), week, done, '2026-11-09')
    expect(mon.type).toBe('rest')
    expect(mon.line).toMatch(/^Best today: rest\. If you want to train, Legs \+ core is ready/)
    const today: DoneSession[] = [...done, { date: '2026-11-10', type: 'upper' }]
    expect(recommend(todayPlan(week, today, '2026-11-10'), rec({}), week, today, '2026-11-10').line).toMatch(/^Trained today/)
  })
})

// Levels, the rank, the coach, forecasts and programs, on made-up histories and pinned dates.
import { describe, expect, it } from 'vitest'
import { FAMILIES, MOVES } from './sportMoves'
import { shiftDay, addSets, type SetLog } from './sportSets'
import { MAIN_FAMILIES, RANKS, compareThen, estimateSets, levelChanges, milestones, overallRank, placeAll, placeFamily, seriesOf, trackOf, type HistoryInput } from './sportLevels'
import { coachFor, feedbackFor, missingGroups } from './sportCoach'
import { forecasts, goalPace, recordsWall, storyWeek, trendLine, weeklyStory } from './sportForecast'
import { PROGRAMS, applyProgram, balanceCheck, deloadAdvice, sessionFor, stopProgram, todayRoutine } from './sportPrograms'

const TODAY = '2026-11-07' // a Saturday
const EX = [
  { id: 'pu', name: 'Push-ups', target: 50, active: true },
  { id: 'su', name: 'Sit-ups', target: 40, active: true },
  { id: 'sq', name: 'Squats', target: 50, active: true }
]
const ago = (n: number) => shiftDay(TODAY, -n)

/** A history: totals per day, and optional sets. */
function hist(days: Record<string, Record<string, number>>, sets: SetLog = {}, exercises: any[] = EX): HistoryInput {
  return { exercises, days, sets, today: TODAY }
}
function withSets(rows: [number, string, number[]][]): HistoryInput {
  let sets: SetLog = {}
  const days: Record<string, Record<string, number>> = {}
  for (const [n, id, reps] of rows) {
    sets = addSets(sets, ago(n), id, reps, Date.parse(ago(n) + 'T10:00:00Z'))
    days[ago(n)] = { ...(days[ago(n)] ?? {}), [id]: (days[ago(n)]?.[id] ?? 0) + reps.reduce((a, b) => a + b, 0) }
  }
  return hist(days, sets)
}

describe('the level tables', () => {
  it('every main exercise has 10–15 levels with a name, a requirement and a meaning', () => {
    for (const f of MAIN_FAMILIES) {
      const t = trackOf(f)!
      expect(t.levels.length, f).toBeGreaterThanOrEqual(10)
      expect(t.levels.length, f).toBeLessThanOrEqual(15)
      for (const l of t.levels) {
        expect(l.name && l.req && l.meaning).toBeTruthy()
        expect(l.req).toMatch(/^\d+×\d+/)
      }
    }
    expect(trackOf('pushup')!.levels[7].req).toBe('3×20 push-ups')
  })
  it('every family has a track, and all their moves exist and keep to the ladder order', () => {
    for (const f of Object.keys(FAMILIES)) {
      const t = trackOf(f)!
      expect(t, f).not.toBeNull()
      expect(t.levels.length, f).toBeGreaterThanOrEqual(3)
      const idx = t.levels.map((l) => FAMILIES[f].steps.indexOf(l.move))
      expect(idx.every((i) => i >= 0), f).toBe(true)
      expect([...idx].sort((a, b) => a - b), `${f} order`).toEqual(idx)
    }
    expect(MOVES.length).toBeGreaterThan(40)
  })
})

describe('placement without a test', () => {
  it('places a Telegram-style history (day totals only) from the best day, steadiness and trend', () => {
    const days: Record<string, Record<string, number>> = {}
    for (let i = 0; i < 21; i++) if (i % 2 === 0) days[ago(i)] = { pu: 120 + (i % 4) * 5 }
    const p = placeFamily(hist(days), 'pushup')!
    expect(p.estimated).toBe(true)
    expect(p.level).toBeGreaterThanOrEqual(7)
    expect(p.why).toMatch(/Push-ups: best day/)
    expect(p.why).toMatch(/Next: Level/)
    expect(p.active30).toBe(11)
  })
  it('one quick log places you at once (no test day)', () => {
    expect(placeFamily(hist({}), 'pushup')!.level).toBe(0)
    const p = placeFamily(withSets([[0, 'pu', [15, 14, 12]]]), 'pushup')!
    expect(p.level).toBe(6) // 3×10 yes, 3×15 no
    expect(p.lv!.name).toBe('Solid')
    expect(p.next!.req).toBe('3×15 push-ups')
  })
  it('any later log updates the level immediately', () => {
    const a = placeFamily(withSets([[0, 'pu', [15, 14, 12]]]), 'pushup')!
    const b = placeFamily(withSets([[0, 'pu', [20, 20, 20]]]), 'pushup')!
    expect(b.level).toBeGreaterThan(a.level)
    expect(b.lv!.req).toBe('3×20 push-ups')
  })
  it('one lucky day does not outrank a steady habit by more than one level', () => {
    const rows: [number, string, number[]][] = []
    for (let i = 2; i < 30; i += 3) rows.push([i, 'pu', [10, 10, 10]])
    rows.push([0, 'pu', [20, 20, 20]])
    const p = placeFamily(withSets(rows), 'pushup')!
    expect(p.solid).toBe(6)
    expect(p.level).toBe(7)
  })
  it('a harder move counts when you do about 70% of the reps', () => {
    const ex = [{ id: 'dm', name: 'Diamond push-ups', target: 30, active: true }]
    const p = placeFamily({ ...withSets([[0, 'dm', [10, 10, 10]]]), exercises: ex }, 'pushup')!
    expect(p.level).toBe(10)
  })
  it('a comeback after 10+ days off shows a lower level, and the old one returns after two hits', () => {
    const rows: [number, string, number[]][] = [[40, 'pu', [15, 15, 15]], [37, 'pu', [15, 15, 15]], [34, 'pu', [15, 15, 15]], [30, 'pu', [15, 15, 15]]]
    const off = placeFamily(withSets(rows), 'pushup')!
    expect(off.comeback?.daysOff).toBe(30)
    expect(off.level).toBe(off.comeback!.from - 2)
    const back1 = placeFamily(withSets([...rows, [2, 'pu', [15, 15, 15]]]), 'pushup')!
    expect(back1.comeback?.hits).toBe(1)
    expect(back1.level).toBeLessThan(back1.comeback!.from)
    const back2 = placeFamily(withSets([...rows, [3, 'pu', [15, 15, 15]], [0, 'pu', [15, 15, 15]]]), 'pushup')!
    expect(back2.comeback).toBeNull()
    expect(back2.level).toBe(7)
  })
  it('estimates sets from a total', () => {
    expect(estimateSets(130)).toEqual([22, 22, 22, 22, 21, 21])
    expect(estimateSets(0)).toEqual([])
    expect(estimateSets(90, 'sec')).toEqual([30, 30, 30])
  })
})

describe('the overall strength rank', () => {
  it('goes Recruit → Legend from all groups', () => {
    expect(RANKS.map((r) => r.name)).toEqual(['Recruit', 'Trainee', 'Fighter', 'Warrior', 'Elite', 'Legend'])
    expect(overallRank([]).rank.name).toBe('Recruit')
    const some = overallRank(placeAll(withSets([[0, 'pu', [15, 14, 12]], [0, 'sq', [30, 30, 30]], [0, 'su', [20, 20, 20]]])))
    expect(['Trainee', 'Fighter']).toContain(some.rank.name)
    expect(some.next).not.toBeNull()
    expect(some.hint).toMatch(/Fastest way up/)
  })
  it('an untrained group holds the rank down, and top ladders reach Legend', () => {
    const ex = [
      { id: 'a', name: 'Pseudo-planche push-ups', target: 20, active: true },
      { id: 'b', name: 'Pistol squats', target: 20, active: true },
      { id: 'c', name: 'Dragon flag (lowering)', target: 20, active: true },
      { id: 'd', name: 'Table rows', move: 'table_row', target: 20, active: true }
    ]
    const h = { ...withSets([[0, 'a', [6, 6, 6]], [0, 'b', [5, 5, 5]], [0, 'c', [5, 5, 5]], [0, 'd', [20, 20, 20]]]), exercises: ex }
    const r = overallRank(placeAll(h))
    expect(r.rank.name).toBe('Legend')
    const noPull = overallRank(placeAll({ ...h, exercises: ex.slice(0, 3) }))
    expect(noPull.score).toBeLessThan(r.score)
    expect(noPull.by.pull).toBe(0)
  })
  it('you 30 days ago vs now', () => {
    const rows: [number, string, number[]][] = [[40, 'pu', [8, 8, 8]], [35, 'pu', [8, 8, 8]], [33, 'pu', [10, 9, 9]], [1, 'pu', [15, 15, 15]], [3, 'pu', [15, 14, 15]]]
    const c = compareThen(withSets(rows))[0]
    expect(c.then!.level).toBeLessThan(c.now.level)
    expect(c.line).toMatch(/up!/)
  })
  it('milestone titles are earned from real feats', () => {
    const h = withSets([[10, 'pu', [50, 30, 20]], [5, 'sq', [40, 40, 30]]])
    const m = milestones(h)
    expect(m.find((x) => x.title === 'First 50 in one set')!.day).toBe(ago(10))
    expect(m.find((x) => x.title === '100 squats club')!.day).toBe(ago(5))
    expect(m.find((x) => x.title === 'Pistol unlocked')!.day).toBeNull()
  })
})

describe('the coach: double progression, feedback, step back', () => {
  const base = (rows: [number, string, number[]][]) => ({ ...withSets(rows), exId: 'pu' })
  it('aims for one more rep than your lowest set last time', () => {
    const c = coachFor(base([[2, 'pu', [15, 14, 12]]]))!
    expect(c.goal).toBe(13)
    expect(c.label).toBe('3×13')
    expect(c.chips).toEqual([15, 14, 12]) // quick log is prefilled from last time
    expect(c.line).toMatch(/Beat last time/)
  })
  it('feedback after a log: more than last time, same, fewer, top of the range, easier than usual', () => {
    const f = (today: number[]) => feedbackFor(base([[2, 'pu', [15, 14, 12]], [0, 'pu', today]]))!
    expect(f([15, 15, 13]).text).toMatch(/Good, 2 more than last time/)
    expect(f([15, 15, 13]).next).toBe('Next: 3×14')
    expect(f([15, 14, 12]).tone).toBe('same')
    expect(f([14, 12, 11]).tone).toBe('ease')
    expect(f([20, 20, 20]).text).toMatch(/Hit the top of the range/)
    expect(f([19, 19, 18]).tone).toBe('easy')
    expect(f([15]).text).toMatch(/2 more sets/)
    expect(feedbackFor(base([[0, 'pu', [15, 14, 12]]]))!.tone).toBe('first')
  })
  it('ready for a harder move after two sessions at the top, with the reason', () => {
    const c = coachFor(base([[5, 'pu', [20, 20, 20]], [2, 'pu', [20, 20, 21]]]))!
    expect(c.status).toBe('ready')
    expect(c.ready!.to.id).toBe('wide_pushup')
    expect(c.ready!.why).toBe('3×20 2 sessions in a row')
    expect(c.tip).toMatch(/\w/)
    const nope = coachFor({ ...base([[5, 'pu', [20, 20, 20]], [2, 'pu', [20, 20, 21]]]), notYet: { wide_pushup: shiftDay(TODAY, 3) } })!
    expect(nope.ready).toBeNull()
  })
  it('steps back after two misses, with no shame', () => {
    const c = coachFor(base([[6, 'pu', [8, 7, 6]], [3, 'pu', [4, 3, 3]], [1, 'pu', [4, 4, 3]]]))!
    expect(c.status).toBe('stuck')
    expect(c.stepBack!.to!.id).toBe('knee_pushup')
    expect(c.stepBack!.text).toMatch(/information, not failure/)
    expect(c.tip).toBeTruthy()
  })
  it('an easy week lowers the sets and holds the reps', () => {
    const c = coachFor({ ...base([[2, 'pu', [15, 14, 12]]]), deload: true })!
    expect(c.status).toBe('deload')
    expect(c.sets).toBe(2)
    expect(c.goal).toBe(14) // the first two sets are the working sets
  })
  it('suggests a missing muscle group', () => {
    const m = missingGroups({ exercises: [EX[0]], days: {}, sets: {}, today: TODAY })
    expect(m[0].text).toBe('Your legs have no training: add Squats?')
    expect(m.map((x) => x.muscle)).toEqual(['legs', 'pull', 'core'])
    expect(missingGroups({ exercises: EX, days: {}, sets: {}, today: TODAY }).map((x) => x.muscle)).toEqual(['pull'])
  })
})

describe('forecasts, goals, the story and the records wall', () => {
  const rising = () => {
    const rows: [number, string, number[]][] = []
    for (let i = 27; i >= 0; i -= 3) { const r = 10 + Math.round((27 - i) / 4); rows.push([i, 'pu', [r, r, r - 1]]) }
    return withSets(rows)
  }
  it('forecasts the next level from your recent pace', () => {
    const f = forecasts(rising()).find((x) => x.family === 'pushup')!
    expect(f.steps[0].days).not.toBeNull()
    expect(f.text).toMatch(/Level \d+ (in about \d+ days|is any day now|in a few months)/)
    expect(forecasts(withSets([[0, 'pu', [15, 14, 12]]]))[0].text).toMatch(/keep logging/)
    expect(trendLine([{ day: ago(0), v: 1 }], TODAY)).toBeNull()
  })
  it('a goal with a date: on pace or behind, and what to do today', () => {
    const h = rising()
    const easy = goalPace(h, { id: 'g', exId: 'pu', reps: 24, by: shiftDay(TODAY, 120) })!
    expect(['ahead', 'on']).toContain(easy.status)
    const hard = goalPace(h, { id: 'g', exId: 'pu', reps: 60, by: shiftDay(TODAY, 20) })!
    expect(hard.status).toBe('behind')
    expect(hard.today).toMatch(/Push one set to/)
    expect(goalPace(h, { id: 'g', exId: 'pu', reps: 10, by: shiftDay(TODAY, 20) })!.status).toBe('done')
    expect(goalPace(h, { id: 'g', exId: 'pu', reps: 60, by: shiftDay(TODAY, -2) })!.status).toBe('late')
  })
  it('tells the Sunday story, and last week on other days', () => {
    expect(storyWeek('2026-11-08')).toMatchObject({ from: '2026-11-02', to: '2026-11-08', label: 'This week' })
    expect(storyWeek(TODAY)).toMatchObject({ from: '2026-10-26', to: '2026-11-01', label: 'Last week' })
    const rows: [number, string, number[]][] = [[12, 'pu', [10, 10, 9]], [10, 'sq', [15, 15, 15]], [8, 'pu', [12, 11, 10]], [6, 'pu', [14, 13, 12]], [5, 'sq', [30, 30, 30]]]
    const s = weeklyStory(withSets(rows), ['Your core has no training: add Plank?'])
    expect(s.sessions).toBe(4)
    expect(s.gains[0]).toMatchObject({ name: 'Push-ups', from: 10, to: 14 })
    expect(s.headline).toMatch(/Last week: \+4 reps on push-ups/)
    expect(s.focus).toMatch(/core/)
  })
  it('the records wall lists best set and best day with dates', () => {
    const w = recordsWall(withSets([[9, 'pu', [20, 18, 15]], [3, 'pu', [16, 16, 16]]]))
    expect(w[0]).toMatchObject({ name: 'Push-ups', bestSet: 20, bestSetDay: ago(9), bestDay: 53, bestDayDay: ago(9), fresh: false })
  })
  it('marks level changes on the chart series', () => {
    const rows: [number, string, number[]][] = [[20, 'pu', [8, 8, 8]], [14, 'pu', [10, 10, 10]], [7, 'pu', [15, 15, 15]], [1, 'pu', [20, 20, 20]]]
    const s = seriesOf(withSets(rows), 'pushup')
    expect(s.map((p) => p.level)).toEqual([5, 6, 7, 8])
    expect(levelChanges(s).map((c) => c.level)).toEqual([6, 7, 8])
  })
})

describe('programs, the balance checker and the deload week', () => {
  it('has the three programs and rotates the workouts', () => {
    expect(PROGRAMS.map((p) => p.id)).toEqual(['fullbody3', 'ppl4', 'core'])
    const fb = PROGRAMS[0]
    expect(sessionFor(fb, '2026-11-02')!.id).not.toBe(sessionFor(fb, '2026-11-04')!.id)
    expect(sessionFor(fb, '2026-11-03')).toBeNull() // Tuesday
    expect(sessionFor(PROGRAMS[1], '2026-11-05')!.id).toBe('legs') // Thursday
    expect(sessionFor(PROGRAMS[2], '2026-11-07')!.id).toBe('finisher')
  })
  it('picking a program keeps your exercises; replace turns them off and stopping brings them back', () => {
    const mine = EX.map((e) => ({ ...e, doneToday: 0 }))
    const places = placeAll(withSets([[0, 'pu', [15, 14, 12]]]))
    const add = applyProgram(mine, PROGRAMS[0], places, { today: TODAY })
    expect(add.exercises.filter((e) => e.active && !(e as any).prog).map((e) => e.id)).toEqual(['pu', 'su', 'sq'])
    expect(add.added.length).toBeGreaterThan(2)
    const rep = applyProgram(mine, PROGRAMS[0], places, { today: TODAY, replace: true })
    expect(rep.exercises.filter((e) => !(e as any).prog).every((e) => e.active === false)).toBe(true)
    // Monday: workout A shows; Tuesday: a rest day still shows something (never empty).
    const mon = todayRoutine(rep.exercises as any, { id: 'fullbody3', startedOn: TODAY }, '2026-11-02')
    expect(mon.list.length).toBeGreaterThanOrEqual(4)
    const tue = todayRoutine(rep.exercises as any, { id: 'fullbody3', startedOn: TODAY }, '2026-11-03')
    expect(tue.restDay).toBe(true)
    expect(tue.list.length).toBeGreaterThan(0)
    const back = stopProgram(rep.exercises as any)
    expect(back.filter((e) => e.active).map((e) => e.id)).toEqual(['pu', 'su', 'sq'])
  })
  it('flags a missing, an unworked and an over-trained group', () => {
    const h = withSets([[0, 'pu', [15, 15, 15, 15, 15, 15, 15, 15]], [1, 'pu', [15, 15, 15, 15, 15, 15, 15, 15]], [2, 'pu', [15, 15, 15, 15, 15, 15, 15, 15]], [4, 'su', [15, 15]]])
    const b = balanceCheck({ exercises: [EX[0], EX[1]], sets: h.sets, today: TODAY })
    expect(b.some((x) => x.kind === 'missing' && x.muscle === 'legs')).toBe(true)
    expect(b.some((x) => x.kind === 'over' && x.muscle === 'push')).toBe(true)
    expect(balanceCheck({ exercises: EX, sets: {}, today: '2026-11-03' }).some((x) => x.kind === 'under')).toBe(false)
  })
  it('suggests a lighter week after 4–6 weeks of progress, not before', () => {
    const days: Record<string, Record<string, number>> = {}
    // five complete weeks before this one, volume rising each week
    for (let w = 5; w >= 1; w--) for (const d of [0, 2, 4]) days[shiftDay('2026-11-02', -7 * w + d)] = { pu: 40 + (5 - w) * 5 }
    expect(deloadAdvice(hist(days)).state).toBe('suggest')
    expect(deloadAdvice(hist(days)).weeks).toBe(5)
    const short: typeof days = {}
    for (let w = 2; w >= 1; w--) short[shiftDay('2026-11-02', -7 * w)] = { pu: 40 }
    expect(deloadAdvice(hist(short)).state).toBe('none')
    expect(deloadAdvice({ ...hist(days), lastDeload: shiftDay('2026-11-02', -14) }).state).toBe('none')
    expect(deloadAdvice({ ...hist(days), until: shiftDay(TODAY, 3) }).state).toBe('active')
    for (let w = 7; w >= 6; w--) days[shiftDay('2026-11-02', -7 * w)] = { pu: 30 }
    expect(deloadAdvice(hist(days)).state).toBe('overdue')
  })
})

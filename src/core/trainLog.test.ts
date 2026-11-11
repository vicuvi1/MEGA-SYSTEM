import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeSets } from './sportSets'
import { DEFAULT_LADDERS } from './trainLadders'
import {
  bestOf, currentLevel, doseSets, effortOf, ladderSets, weeklySets, declineLevel, doneSessions, ensureExercise, estimateLevelUp, keepLevel, lastLine, lastTime, levelStatus, logSet, mergeTrain,
  moveSessions, nextTimeOf, placeLadder, sameAsLast, saveSession, sessionFromSets, sessionItems, sessionMinutes, setLevel, suggestNow, trainOf, unlogSet, workoutOf, type MoveSession
} from './trainLog'

const push = DEFAULT_LADDERS[0]
const diamond = push.levels[2] // 6–12
const ses = (day: string, reps: number[], kg?: number): MoveSession => ({ day, reps, sets: reps.map((r, i) => ({ reps: r, at: Date.parse(day) + i, id: `${day}${i}`, form: 'good' as const, ...(kg ? { kg } : {}) })) })

/** A made-up Sport Track state with diamond push-up sets on some days. */
function state(days: Record<string, number[]>, extra: Record<string, unknown> = {}) {
  const sets: any = {}
  for (const [d, reps] of Object.entries(days)) sets[d] = { ex_d: reps.map((r, i) => ({ reps: r, at: Date.parse(d + 'T10:00:00Z') + i, id: `${d}-${i}`, form: 'good' })) }
  return { lastDate: '2026-11-13', exercises: [{ id: 'ex_d', name: 'Diamond push-ups', target: 30, move: 'diamond_pushup' }], days: {}, sets, ...extra }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T08:30:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('last time and same as last time', () => {
  it('finds the last session before today across the exercises of that move', () => {
    const st = state({ '2026-11-06': [8, 8, 7], '2026-11-10': [9, 8, 8], '2026-11-13': [10] })
    const all = moveSessions(st, 'diamond_pushup')
    expect(all.map((s) => s.day)).toEqual(['2026-11-06', '2026-11-10', '2026-11-13'])
    const last = lastTime(all, '2026-11-13')!
    expect(last.reps).toEqual([9, 8, 8])
    expect(lastLine(last, diamond, 3)).toBe('Last time: 9 · 8 · 8 → aim to beat it')
    expect(lastLine(null, diamond, 3)).toMatch(/^First time: 3 sets of 6–12/)
  })

  it('"same as last time" fills every set (the last one repeated), with the backpack kg', () => {
    expect(sameAsLast(ses('2026-11-10', [9, 8], 5), 3, diamond)).toEqual([{ reps: 9, kg: 5 }, { reps: 8, kg: 5 }, { reps: 8, kg: 5 }])
    expect(sameAsLast(null, 2, diamond)).toEqual([{ reps: 6 }, { reps: 6 }])
  })
})

describe('level-up and step back', () => {
  it('top of the range in every working set, 2 sessions in a row → level complete', () => {
    const one = levelStatus([ses('2026-11-06', [10, 9, 9]), ses('2026-11-10', [12, 12, 12])], diamond, 3)
    expect(one).toMatchObject({ state: 'building', hits: 1, topSets: 3, needSets: 6, pct: 0.5 })
    const two = levelStatus([ses('2026-11-10', [12, 12, 12]), ses('2026-11-13', [12, 12, 13])], diamond, 3)
    expect(two.state).toBe('complete')
    expect(two.pct).toBe(1)
    // A partial session counts its top sets.
    expect(levelStatus([ses('2026-11-10', [12, 12, 10])], diamond, 3).topSets).toBe(2)
  })

  it("can't reach the bottom twice on a new level → stay or one level back; old sessions before the level don't count", () => {
    const s = [ses('2026-10-01', [3, 2]), ses('2026-11-10', [5, 4, 4]), ses('2026-11-13', [5, 5, 4])]
    expect(levelStatus(s, diamond, 3, '2026-11-10').state).toBe('struggling')
    expect(levelStatus(s, diamond, 3, '2026-11-10').line).toMatch(/one step back/)
    expect(levelStatus([ses('2026-11-13', [5, 5, 4])], diamond, 3).state).toBe('building')
  })

  it('a "not yet" waits for a newer session', () => {
    const st = levelStatus([ses('2026-11-10', [12, 12, 12]), ses('2026-11-13', [12, 12, 12])], diamond, 3)
    const last = ses('2026-11-13', [12, 12, 12])
    expect(suggestNow(st, last)).toBe(true)
    expect(suggestNow(st, last, '2026-11-13')).toBe(false)
    expect(suggestNow(st, ses('2026-11-15', [12, 12, 12]), '2026-11-13')).toBe(true)
  })

  it('moving up keeps the date you reached each level; placement becomes your level the first time you train', () => {
    const st: any = state({})
    keepLevel(st, 'push', 2, 1)
    keepLevel(st, 'push', 5, 2)
    expect(st.trainLevels.push.level).toBe(2)
    setLevel(st, 'push', 3, '2026-11-13', 3)
    expect(st.trainLevels.push).toMatchObject({ level: 3, reached: { '3': '2026-11-13' } })
    declineLevel(st, 'push', 3, '2026-11-14', 4)
    expect(st.trainLevels.push).toMatchObject({ level: 3, declinedOn: '2026-11-14' })
    expect(currentLevel(st, trainOf(st), push)).toEqual({ index: 3, placed: false, since: '2026-11-13' })
  })
})

describe('placement from your best sets', () => {
  it('about 50 push-ups in one set → archer push-ups (an advanced push level)', () => {
    const st = { exercises: [{ id: 'ex_p', name: 'Push-ups', target: 50 }], sets: { '2026-11-01': { ex_p: [{ reps: 50, id: 'a', at: 1 }] } } }
    const at = placeLadder(push, (m) => bestOf(st, m))
    expect(push.levels[at].move).toBe('archer_pushup')
    // A best set told to Sport Track counts the same.
    expect(placeLadder(push, (m) => bestOf({ bestSets: { pushup: { move: 'pushup', reps: 50, day: '2026-11-01' } } }, m))).toBe(at)
  })

  it('few push-ups → an easy level; nothing logged → the first level', () => {
    expect(push.levels[placeLadder(push, (m) => (m === 'pushup' ? 12 : null))].move).toBe('knee_pushup')
    expect(push.levels[placeLadder(push, (m) => (m === 'pushup' ? 20 : null))].move).toBe('pushup')
    expect(placeLadder(push, () => null)).toBe(0)
  })
})

describe('the roadmap estimate', () => {
  it('needs 3 sessions', () => {
    expect(estimateLevelUp([ses('2026-11-06', [8, 8, 8]), ses('2026-11-10', [9, 9, 8])], diamond, 3, 'Decline push-ups')).toEqual({ weeks: null, line: 'Not enough data yet: 1 more session for an estimate.' })
  })

  it('uses your real growth: +1 rep a set every 3–4 days from 8 to 12 is about 2 weeks', () => {
    const e = estimateLevelUp([ses('2026-11-02', [7, 7, 7]), ses('2026-11-06', [8, 8, 8]), ses('2026-11-09', [9, 9, 9])], diamond, 3, 'Decline push-ups')
    expect(e.weeks).toBe(2)
    expect(e.line).toBe('At your pace: ~2 weeks to Decline push-ups.')
  })

  it('flat reps say so, a done level is ready now', () => {
    expect(estimateLevelUp([ses('2026-11-02', [9, 9, 9]), ses('2026-11-06', [9, 9, 9]), ses('2026-11-09', [9, 9, 9])], diamond, 3, 'X').weeks).toBeNull()
    expect(estimateLevelUp([ses('2026-11-02', [9, 9, 9]), ses('2026-11-06', [12, 12, 12]), ses('2026-11-09', [12, 12, 12])], diamond, 3, 'X').line).toMatch(/^Ready now/)
  })
})

describe("today's moves and saving", () => {
  it('today on your levels: upper is push, pull, shoulders with 3 + 5 + 2 sets inside 30 minutes (10-20 hard sets a muscle a week)', () => {
    const st = state({ '2026-11-10': [9, 8, 8] }, { trainLevels: { push: { level: 2, reached: {}, at: 1 } } })
    const items = sessionItems(st, trainOf(st), 'upper', '2026-11-13')
    expect(items.map((i) => i.ladder.id)).toEqual(['push', 'pull', 'shoulders'])
    expect(items.map((i) => i.sets)).toEqual([3, 5, 2])
    expect(items[0]).toMatchObject({ name: 'Diamond push-ups', lastLine: 'Last time: 9 · 8 · 8 → aim to beat it' })
    expect(sessionMinutes(items)).toBeLessThanOrEqual(30)
    const legs = sessionItems(st, trainOf(st), 'legs', '2026-11-13')
    expect(legs.map((i) => i.ladder.id)).toEqual(['single', 'hinge', 'core'])
    expect(legs.map((i) => i.sets)).toEqual([4, 3, 5])
    expect(sessionMinutes(legs)).toBeLessThanOrEqual(30)
  })

  it('logs sets with effort into the same set log, the day total and today; undo takes one back', () => {
    const st: any = { lastDate: '2026-11-13', exercises: [], days: {}, sets: {} }
    const id = ensureExercise(st, 'neg_pullup', DEFAULT_LADDERS[1].levels[2], 3)
    expect(st.exercises[0]).toMatchObject({ id: 'ex_t_neg_pullup', move: 't:neg_pullup', active: false })
    expect(ensureExercise(st, 'neg_pullup', DEFAULT_LADDERS[1].levels[2], 3)).toBe(id)
    const a = logSet(st, { day: '2026-11-13', exId: id, set: { reps: 5, feel: 'hard', kg: 2.3 }, session: 's1', now: 1000, salt: 'a' })
    logSet(st, { day: '2026-11-13', exId: id, set: { reps: 4, feel: 'easy' }, session: 's1', now: 2000, salt: 'b' })
    expect(a).toEqual({ reps: 5, at: 1000, id: 'rsa', session: 's1', kg: 2.5, feel: 'hard', rir: 1 })
    expect(st.sets['2026-11-13'][id][1]).toMatchObject({ feel: 'easy', rir: 4 })
    expect(st.days['2026-11-13'][id]).toBe(9)
    expect(st.exercises[0].doneToday).toBe(9)
    expect(unlogSet(st, '2026-11-13', id, a.id!)).toBe(true)
    expect(st.days['2026-11-13'][id]).toBe(4)
    expect(st.exercises[0].doneToday).toBe(4)
    expect(moveSessions(st, 'neg_pullup')[0].reps).toEqual([4])
  })

  it('a session record counts for the week once it has sets', () => {
    const st: any = {}
    saveSession(st, { id: 's1', date: '2026-11-13', type: 'upper', exercises: [{ ladder: 'push', move: 'pushup', exId: 'x', sets: [{ reps: 10 }] }], startedAt: 5, durationSec: 60 })
    saveSession(st, { id: 's0', date: '2026-11-12', type: 'legs', exercises: [], startedAt: 1, durationSec: 0 })
    saveSession(st, { id: 's1', date: '2026-11-13', type: 'upper', exercises: [{ ladder: 'push', move: 'pushup', exId: 'x', sets: [{ reps: 10 }, { reps: 9 }] }], startedAt: 5, durationSec: 120, done: true })
    expect(st.trainLog.map((s: any) => s.id)).toEqual(['s1', 's0'])
    expect(doneSessions(trainOf(st).log)).toEqual([{ date: '2026-11-13', type: 'upper' }])
  })
})

describe('two devices', () => {
  it('merging sets keeps the new effort fields', () => {
    const a = { '2026-11-13': { ex: [{ reps: 8, at: 1, id: 'a', rir: 1, feel: 'hard' as const, session: 's1' }] } }
    const b = { '2026-11-13': { ex: [{ reps: 9, at: 2, id: 'b' }] } }
    expect(mergeSets(a, b)['2026-11-13'].ex).toEqual([{ reps: 8, at: 1, id: 'a', rir: 1, feel: 'hard', session: 's1' }, { reps: 9, at: 2, id: 'b' }])
  })

  it('sessions join by id (the one with more sets wins); the week and each level follow the newer edit', () => {
    const a = { trainLog: [{ id: 's1', startedAt: 1, exercises: [{ sets: [{ reps: 1 }] }] }], trainWeek: { days: ['rest'], updatedAt: 5 }, trainLevels: { push: { level: 3, at: 9 }, pull: { level: 1, at: 1 } } }
    const b = { trainLog: [{ id: 's1', startedAt: 1, exercises: [{ sets: [{ reps: 1 }, { reps: 2 }] }] }, { id: 's2', startedAt: 2, exercises: [] }], trainWeek: { days: ['upper'], updatedAt: 6 }, trainLevels: { push: { level: 2, at: 3 }, pull: { level: 2, at: 4 } } }
    const m: any = mergeTrain(a, b)
    expect(m.trainLog.map((s: any) => s.id)).toEqual(['s2', 's1'])
    expect(m.trainLog[1].exercises[0].sets).toHaveLength(2)
    expect(m.trainWeek.updatedAt).toBe(6)
    expect(m.trainLevels).toEqual({ push: { level: 3, at: 9 }, pull: { level: 2, at: 4 } })
    expect(mergeTrain({}, {})).toEqual({})
  })
})

describe('finishing a workout', () => {
  it('reads the session back from the set log and logs one workout (the usual points rule)', () => {
    const st: any = { lastDate: '2026-11-13', exercises: [{ id: 'ex_p', name: 'Push-ups', target: 30, move: 'pushup' }], days: {}, sets: {} }
    logSet(st, { day: '2026-11-13', exId: 'ex_p', set: { reps: 12, feel: 'ok' }, session: 's1', now: 1000, salt: 'a' })
    logSet(st, { day: '2026-11-13', exId: 'ex_p', set: { reps: 11, feel: 'hard' }, session: 's1', now: 2000, salt: 'b' })
    logSet(st, { day: '2026-11-13', exId: 'ex_p', set: { reps: 30 }, session: 'other', now: 3000, salt: 'c' })
    const rec = sessionFromSets(st, { id: 's1', date: '2026-11-13', type: 'upper', items: [{ ladder: 'push', move: 'pushup', exId: 'ex_p' }, { ladder: 'pull', move: 'table_row', exId: 'ex_r' }], startedAt: 0, now: 600000, done: true })
    expect(rec.exercises[0].sets).toEqual([{ reps: 12, feel: 'ok' }, { reps: 11, feel: 'hard' }])
    expect(rec.durationSec).toBe(600)
    const w = workoutOf(rec)!
    expect(w.title).toBe('Upper body: Push-ups 12 · 11')
    expect(w.items).toEqual([{ exerciseId: 'ex_p', name: 'Push-ups', unit: 'reps', amount: 23, sets: [{ reps: 12 }, { reps: 11 }] }])
    expect(workoutOf({ ...rec, exercises: [] })).toBeNull()
  })
})

// The Tracker and Body → Training share these rules (sportTrain.ts reads them): double progression with effort.
describe('double progression with effort (one engine for the Tracker and Training)', () => {
  const tapped = (day: string, reps: number[], feel: 'easy' | 'ok' | 'hard'): MoveSession => ({ day, reps, sets: reps.map((r, i) => ({ reps: r, at: Date.parse(day) + i, id: `${day}${i}`, feel, form: 'good' as const })) })

  it('the top of the range in every set, 2 sessions in a row, not Hard and form OK, completes a level', () => {
    const two = (feel: 'easy' | 'ok' | 'hard') => [tapped('2026-11-08', [12, 12, 12, 12], feel), tapped('2026-11-10', [12, 12, 12, 12], feel)]
    expect(levelStatus(two('easy'), diamond, 4)).toMatchObject({ state: 'complete', reason: '4×12 easy twice', jump: 1 })
    expect(levelStatus(two('ok'), diamond, 4)).toMatchObject({ state: 'complete', reason: '4×12 twice with 1–2 reps left' })
    expect(levelStatus(two('hard'), diamond, 4)).toMatchObject({ state: 'building', hits: 0 })
    expect(levelStatus(two('hard'), diamond, 4).line).toMatch(/it was hard/)
    expect(levelStatus([tapped('2026-11-10', [12, 12, 12, 12], 'easy')], diamond, 4)).toMatchObject({ state: 'building', hits: 1 })
    expect(levelStatus([ses('2026-11-08', [12, 12, 12, 12]), ses('2026-11-10', [12, 12, 12, 12])], diamond, 4).reason).toBe('4×12 in 2 sessions in a row')
    const broke = two('easy')
    broke[1].sets[0].form = 'off'
    expect(levelStatus(broke, diamond, 4)).toMatchObject({ state: 'building', hits: 0 })
  })

  it('far too easy, twice, offers two levels up', () => {
    expect(levelStatus([tapped('2026-11-08', [16, 16, 15, 15], 'easy'), tapped('2026-11-10', [16, 16, 15, 15], 'easy')], diamond, 4)).toMatchObject({ state: 'complete', jump: 2 })
  })

  it('effort is read from the working sets only', () => {
    expect(effortOf(tapped('2026-11-10', [12, 12], 'easy'), 2)).toBe('easy')
    expect(effortOf({ sets: [{ reps: 12, at: 1, id: 'a', feel: 'easy' }, { reps: 12, at: 2, id: 'b', feel: 'ok' }] }, 2)).toBe('ok')
    expect(effortOf({ sets: [{ reps: 12, at: 1, id: 'a', feel: 'easy' }, { reps: 12, at: 2, id: 'b' }] }, 2)).toBeNull()
  })

  it('a completed level is offered, never applied by itself; "Not yet" waits for a newer session', () => {
    const st: any = state({}, { trainLevels: { push: { level: 2, reached: { '2': '2026-11-01' }, at: 1 } } })
    for (const d of ['2026-11-09', '2026-11-11']) st.sets[d] = { ex_d: [12, 12, 12].map((r, i) => ({ reps: r, at: Date.parse(d + 'T10:00:00Z') + i, id: `${d}${i}`, feel: 'easy', form: 'good' })) }
    const data = trainOf(st)
    expect(currentLevel(st, data, push, '2026-11-13').index).toBe(2)
    const items = sessionItems(st, data, 'upper', '2026-11-11')
    expect(items[0].offer).toMatchObject({ to: 3, name: 'Decline push-ups', reason: '3×12 easy twice' })
    expect(items[0].nextTime).toEqual({ kind: 'up', move: 'decline_pushup', line: 'Unlocked: Decline push-ups 3 × 6–12, because 3×12 easy twice.' })
    declineLevel(st, 'push', 2, '2026-11-12', 5)
    expect(sessionItems(st, trainOf(st), 'upper', '2026-11-13')[0].offer).toBeNull()
  })

  it('placement becomes your level with the day you reached it; Make easier keeps the earlier day', () => {
    const st: any = state({}, {})
    keepLevel(st, 'push', 3, 9, '2026-11-13')
    expect(st.trainLevels.push).toMatchObject({ level: 3, reached: { '3': '2026-11-13' } })
    setLevel(st, 'push', 2, '2026-11-14', 10, true)
    setLevel(st, 'push', 3, '2026-11-15', 11, true)
    expect(st.trainLevels.push).toMatchObject({ level: 3, reached: { '2': '2026-11-14', '3': '2026-11-13' } })
  })

  it('under the top: aim one more rep on the lowest set; a hard top set stays; under the bottom twice stays or steps back', () => {
    const base = { ladder: push, index: 2, level: diamond, name: 'Diamond push-ups', fullSets: 3 }
    const reps = [tapped('2026-11-13', [10, 9, 8], 'ok')]
    expect(nextTimeOf({ ...base, latest: reps[0], status: levelStatus(reps, diamond, 3) }, '2026-11-13')?.line).toBe('Next time: Diamond push-ups 10 · 9 · 9, because one more rep on your lowest set is how you grow.')
    const hard = [tapped('2026-11-13', [12, 12, 12], 'hard')]
    expect(nextTimeOf({ ...base, latest: hard[0], status: levelStatus(hard, diamond, 3) }, '2026-11-13')?.kind).toBe('stay')
    const low = [tapped('2026-11-10', [5, 4, 4], 'hard'), tapped('2026-11-13', [5, 5, 4], 'hard')]
    expect(nextTimeOf({ ...base, latest: low[1], status: levelStatus(low, diamond, 3) }, '2026-11-13')).toMatchObject({ kind: 'down', line: expect.stringMatching(/one step back to Push-ups/) })
    expect(nextTimeOf({ ...base, latest: low[0], status: levelStatus(low, diamond, 3) }, '2026-11-13')).toBeNull()
  })

  it('the default week gives every muscle group 10-20 hard sets, legs included; Full / Lighter / Short are 4 / 3 / 2 sets', () => {
    const data = trainOf({})
    const w = weeklySets(data)
    for (const m of ['push', 'pull', 'legs', 'core'] as const) {
      expect(w[m]).toBeGreaterThanOrEqual(10)
      expect(w[m]).toBeLessThanOrEqual(20)
    }
    // Four upper days: still inside the range.
    const four = trainOf({ trainWeek: { v: 1, days: ['upper', 'legs', 'upper', 'rest', 'upper', 'legs', 'upper'], updatedAt: 1 } })
    for (const v of Object.values(weeklySets(four))) expect(v).toBeLessThanOrEqual(20)
    expect(ladderSets(data.week, data.ladders, data.ladders[3])).toBe(4)
    expect([doseSets(4, 'full'), doseSets(4, 'light'), doseSets(4, 'short')]).toEqual([4, 3, 2])
    expect(doseSets(2, 'light')).toBe(2)
  })

  it('old daily totals place you: 130 push-ups a day is about 22 a set, which is past plain push-ups', () => {
    const st = { exercises: [{ id: 'ex_p', name: 'Push-ups', target: 130 }], days: { '2026-11-12': { ex_p: 130 } }, sets: {} }
    const data = trainOf(st)
    expect(push.levels[currentLevel(st, data, push, '2026-11-13').index].move).toBe('diamond_pushup')
    // Without today (no totals) and for Telegram-imported days, totals don't place you.
    expect(currentLevel(st, data, push).index).toBe(0)
    const imp = { ...st, importedDays: { '2026-11-12': ['ex_p'] } }
    expect(currentLevel(imp, trainOf(imp), push, '2026-11-13').index).toBe(0)
    // Totals older than 60 days don't count.
    expect(currentLevel(st, data, push, '2027-03-01').index).toBe(0)
  })
})

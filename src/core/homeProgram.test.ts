import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHomeProgram, blockWeek, buildHomeProgram, cleanPrefs, sessionOn, stopHomeProgram, toTrackerProgram, type HomePrefs } from './homeProgram'
import { stopProgram, todayRoutine } from './sportPrograms'
import type { HistoryInput } from './sportLevels'

// Made-up data only. Monday 2031-03-03.
const TODAY = '2031-03-05'
const EX = [
  { id: 'ex_pushups', name: 'Push-ups', target: 120, unit: 'reps', active: true, move: 'pushup' },
  { id: 'ex_situps', name: 'Sit-ups', target: 60, unit: 'reps', active: true, move: 'situp' },
  { id: 'ex_old', name: 'Old curls', target: 20, unit: 'reps', active: true }
]
/** About 50 push-ups in one set (a declared best set), nothing else logged. */
const STRONG: HistoryInput = { exercises: EX, days: {}, sets: {}, today: TODAY, best: { pushup: { move: 'pushup', reps: 50, day: '2031-03-04' } } }
const P = (p: Partial<HomePrefs> = {}): HomePrefs => ({ minutes: 30, days: 3, equip: ['chair'], focus: 'balanced', ...p })
const all = (prog: ReturnType<typeof buildHomeProgram>) => prog.weeks.flatMap((w) => w.sessions.flatMap((s) => s.items))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-03-05T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('home program builder', () => {
  it.each([20, 30, 45] as const)('every session of every week fits %i minutes, with a warm-up', (minutes) => {
    for (const days of [3, 4, 5] as const) {
      const prog = buildHomeProgram(P({ minutes, days }), STRONG)
      expect(prog.weeks).toHaveLength(4)
      expect(prog.warmup.minutes).toBeGreaterThanOrEqual(3)
      for (const w of prog.weeks) for (const s of w.sessions) {
        expect(s.minutes).toBeLessThanOrEqual(minutes)
        expect(s.items.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('more time gives more work', () => {
    const work = (m: 20 | 45) => buildHomeProgram(P({ minutes: m }), STRONG).weeks[0].sessions[0].items.reduce((t, i) => t + i.sets, 0)
    expect(work(45)).toBeGreaterThan(work(20))
  })

  it('50 push-ups in one set puts push-ups on a hard variation, trained for strength (5–8)', () => {
    const push = buildHomeProgram(P(), STRONG).weeks[0].sessions[0].items.find((i) => i.move.family === 'pushup')!
    expect(['archer_pushup', 'decline_pushup', 'planche_pushup', 'onearm_assist_pushup']).toContain(push.move.id)
    expect(push.kind).toBe('strength')
    expect([push.lo, push.hi]).toEqual([5, 8])
    expect(push.level?.start).toBe(false)
    expect(push.level!.n).toBeGreaterThanOrEqual(12)
    // A move with nothing logged starts easy and says so.
    const squat = all(buildHomeProgram(P(), STRONG)).find((i) => i.move.family === 'squat')!
    expect(squat.level?.start).toBe(true)
  })

  it('size moves get 8–15, holds get seconds, rests suit the reps', () => {
    for (const it of all(buildHomeProgram(P({ minutes: 45 }), STRONG))) {
      if (it.kind === 'size') expect([it.lo, it.hi]).toEqual([8, 15])
      if (it.kind === 'hold') expect(it.unit).toBe('sec')
      if (it.kind === 'strength') expect(it.rest).toBeGreaterThanOrEqual(it.pairNext ? 75 : 105)
    }
  })

  it('equipment is respected', () => {
    const none = all(buildHomeProgram(P({ equip: [] }), STRONG))
    const chairMoves = ['chair_dip', 'bulgarian_squat', 'box_pistol', 'decline_pushup', 'elevated_pike', 'table_row_bent', 'table_row', 'feet_row', 'onearm_row']
    expect(none.some((i) => chairMoves.includes(i.move.id))).toBe(false)
    expect(none.some((i) => !i.move.lib)).toBe(false)
    const bar = all(buildHomeProgram(P({ equip: ['bar'] }), STRONG))
    expect(bar.some((i) => /pull-ups|chin-ups/i.test(i.move.name))).toBe(true)
    const dumb = all(buildHomeProgram(P({ equip: ['dumbbells'] }), STRONG))
    expect(dumb.some((i) => i.move.id === 'db_row')).toBe(true)
    expect(dumb.some((i) => i.note === 'Hold the dumbbells')).toBe(true)
  })

  it('weeks 1–3 build, week 4 is lighter', () => {
    const prog = buildHomeProgram(P({ minutes: 45 }), STRONG)
    const sets = (w: number) => prog.weeks[w].sessions[0].items.reduce((t, i) => t + i.sets, 0)
    expect(prog.weeks.map((w) => w.light)).toEqual([false, false, false, true])
    expect(sets(2)).toBeGreaterThan(sets(0))
    expect(sets(3)).toBeLessThan(sets(0))
    expect(prog.rules[0]).toMatch(/top of the range in all sets/)
  })

  it('focus puts its moves first; days pick the split', () => {
    const legs = buildHomeProgram(P({ focus: 'legs' }), STRONG).weeks[0].sessions[0].items[0]
    expect(legs.move.group).toBe('legs')
    expect(buildHomeProgram(P({ days: 4 }), STRONG).weeks[0].sessions.map((s) => s.name)).toEqual(['Upper body', 'Lower body'])
    expect(buildHomeProgram(P({ days: 5 }), STRONG).days).toEqual([0, 1, 2, 4, 5])
  })

  it('is deterministic and cleans odd prefs', () => {
    expect(JSON.stringify(buildHomeProgram(P(), STRONG))).toBe(JSON.stringify(buildHomeProgram(P(), STRONG)))
    expect(cleanPrefs({ minutes: 99, days: 9, equip: ['bar', 'laser'], focus: 'x' })).toEqual({ minutes: 30, days: 3, equip: ['bar'], focus: 'balanced' })
  })
})

describe('use this program', () => {
  const prog = buildHomeProgram(P(), STRONG)

  it('Today (todayRoutine) shows that day’s session; rest days are rest days', () => {
    const exs = applyHomeProgram(EX, prog, 1, '2031-03-03')
    const state = { id: 'home', startedOn: '2031-03-03', custom: toTrackerProgram(prog, '2031-03-03') }
    const mon = todayRoutine(exs, state, '2031-03-03')
    expect(mon.session?.id).toBe('full_a')
    expect(mon.list.map((e) => e.name).sort()).toEqual(prog.weeks[0].sessions[0].items.map((i) => i.move.name).sort())
    expect(todayRoutine(exs, state, '2031-03-04').restDay).toBe(true)
    expect(todayRoutine(exs, state, '2031-03-05').session?.id).toBe('full_b')
    // Your push-ups keep their id (history continues), with the program's target.
    expect(exs.find((e) => e.id === 'ex_old')?.active).toBe(false)
    expect(sessionOn(prog, '2031-03-03', '2031-03-24')?.week.n).toBe(4)
  })

  it('targets follow the week; stop brings your own routine back as it was', () => {
    const w1 = applyHomeProgram(EX, prog, 1, '2031-03-03')
    const w4 = applyHomeProgram(w1, prog, 4, '2031-03-24')
    const first = prog.weeks[0].sessions[0].items[0]
    const t = (l: typeof w1) => l.find((e) => e.name === first.move.name)!.target
    expect(t(w4)).toBeLessThan(t(w1))
    for (const stop of [stopHomeProgram, stopProgram]) {
      const back = stop(w4 as any) as typeof EX
      for (const e of EX) {
        const b = back.find((x) => x.id === e.id)!
        expect(b.active).toBe(true)
        expect(b.target).toBe(e.target)
      }
      expect(back.filter((e) => e.active).length).toBe(EX.length)
    }
  })

  it('the first training day after you start gets the first session, even on a Sunday', () => {
    for (const start of ['2031-03-02', '2031-03-05', '2031-03-09']) {
      const t = toTrackerProgram(prog, start)
      const first = ['2031-03-03', '2031-03-05', '2031-03-10'][['2031-03-02', '2031-03-05', '2031-03-09'].indexOf(start)]
      expect(todayRoutine(applyHomeProgram(EX, prog, 1, start), { id: 'home', startedOn: start, custom: t }, first).session?.id).toBe('full_a')
    }
  })

  it('block weeks repeat after 4', () => {
    expect([blockWeek('2031-03-05', '2031-03-05'), blockWeek('2031-03-05', '2031-03-10'), blockWeek('2031-03-05', '2031-03-24'), blockWeek('2031-03-05', '2031-03-31')]).toEqual([1, 2, 4, 1])
  })
})

// UX5 + PG4 with made-up data and pinned dates: Ben's one line after a workout
// (honest, plain, once, not in a meeting or at night) and why a move stalled.
import { describe, expect, it } from 'vitest'
import { cleanSummary, stallInsight, stallsOf, workoutNote } from './sportInsight'
import { decideWorkoutNote, cleanPushLog, claim, workoutNoteKey } from './benPushes'
import type { SetLog } from './sportSets'

const T = new Date('2026-11-07T18:00:00').getTime()
const summary = (o: Record<string, unknown> = {}) => ({ day: '2026-11-07', source: 'workout mode', minutes: 20, at: T, sets: 6, reps: 90, records: 0, levelUps: 0, exercises: [{ name: 'Push-ups', sets: [15, 15, 14], next: 'Next: 3×16' }], ...o })
const log = () => cleanPushLog({}, '2026-11-07')

describe('the note after a workout', () => {
  it('says a level-up first, then a record, then rest advice, then a push, then the plain count', () => {
    expect(workoutNote(cleanSummary(summary({ levelUps: 1, records: 2 }))!)?.kind).toBe('levelup')
    expect(workoutNote(cleanSummary(summary({ records: 2 }))!)).toMatchObject({ kind: 'record', text: '2 new records today. Well done.' })
    expect(workoutNote(cleanSummary(summary({ sets: 18 }))!)?.kind).toBe('rest')
    expect(workoutNote(cleanSummary(summary({ sets: 2, reps: 30 }))!)?.kind).toBe('push')
    expect(workoutNote(cleanSummary(summary())!)).toMatchObject({ kind: 'plain', text: '6 sets and 90 reps today. Next for Push-ups: 3×16.' })
  })
  it('only uses numbers the summary has', () => {
    for (const o of [{}, { sets: 18 }, { sets: 2 }, { records: 3 }, { levelUps: 2 }]) {
      const s = cleanSummary(summary(o))!
      const n = workoutNote(s)!
      const known = new Set(JSON.stringify(s).match(/\d+/g))
      for (const d of n.text.match(/\d+/g) ?? []) expect(known.has(d)).toBe(true)
    }
  })
  it('has nothing to say for an empty or broken summary', () => {
    expect(cleanSummary(null)).toBeNull()
    expect(cleanSummary({ day: 'today' })).toBeNull()
    expect(cleanSummary(summary({ sets: 0, reps: 0, exercises: [] }))).toBeNull()
  })
})

describe('when the note goes out', () => {
  const base = { now: T, summary: summary(), log: log(), here: true, meeting: false, quiet: false }
  it('goes to the island at the PC and Telegram when away', () => {
    expect(decideWorkoutNote(base)?.channel).toBe('island')
    expect(decideWorkoutNote({ ...base, here: false })?.channel).toBe('telegram')
    expect(decideWorkoutNote(base)).toMatchObject({ type: 'workoutNote', key: workoutNoteKey('2026-11-07', 'workout mode') })
  })
  it('never in a meeting or quiet hours', () => {
    expect(decideWorkoutNote({ ...base, meeting: true })).toBeNull()
    expect(decideWorkoutNote({ ...base, quiet: true })).toBeNull()
  })
  it('is one note per workout, on either channel', () => {
    const key = workoutNoteKey('2026-11-07', 'workout mode')
    const done = claim(log(), key, 'telegram', T).log
    expect(decideWorkoutNote({ ...base, log: done })).toBeNull()
    // another summary 10 minutes later is the same session; 40 minutes later is a new one
    const other = summary({ source: 'routine' })
    expect(decideWorkoutNote({ ...base, log: done, summary: other, now: T + 10 * 60_000 })).toBeNull()
    expect(decideWorkoutNote({ ...base, log: done, summary: other, now: T + 40 * 60_000 })?.key).toBe(workoutNoteKey('2026-11-07', 'routine'))
    expect(decideWorkoutNote({ ...base, log: { ...log(), outbox: [{ key, text: 'x', at: T }] } })).toBeNull()
  })
})

const ex = [{ id: 'ex_pushups', name: 'Push-ups', target: 15, active: true, move: 'pushup' }]
const sets = (...days: [string, number[]][]): SetLog => Object.fromEntries(days.map(([d, reps]) => [d, { ex_pushups: reps.map((r) => ({ reps: r })) }])) as SetLog

describe('a stalled move', () => {
  const today = '2026-11-07'
  it('needs no rep gain for 2 sessions after a better one', () => {
    expect(stallsOf(sets(['2026-11-01', [12, 12]], ['2026-11-03', [15, 14]], ['2026-11-05', [15, 13]]), ex, today)).toHaveLength(0)
    const s = stallsOf(sets(['2026-10-30', [12]], ['2026-11-02', [15, 14]], ['2026-11-04', [15, 13]], ['2026-11-06', [14, 14]]), ex, today)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ sessions: 2, best: 15 })
    expect(stallsOf(sets(['2026-11-02', [15]], ['2026-11-04', [16]], ['2026-11-06', [17]]), ex, today)).toHaveLength(0)
    expect(stallsOf(sets(['2026-09-02', [15]], ['2026-09-04', [15]], ['2026-09-06', [15]]), ex, today)).toHaveLength(0)
  })
})

describe('why it stalled', () => {
  const stalled = [{ name: 'Push-ups', sessions: 2, best: 15 }]
  it('names low protein and short sleep with the real numbers', () => {
    const i = stallInsight(stalled, { protein: { avg: 80, days: 5, goal: 135 }, sleep: { avgMin: 370, nights: 6 } })!
    expect(i.text).toBe('Push-ups stalled. Protein averaged 80 g (goal 135) and you slept 6h10 on average. Fix those first.')
  })
  it('says what to log when data is missing, never a guess', () => {
    expect(stallInsight(stalled, { protein: { avg: 0, days: 0, goal: 135 }, sleep: { avgMin: 500, nights: 5 } })!.text).toBe('Push-ups stalled. Log protein to see why.')
    expect(stallInsight(stalled, { protein: null, sleep: null })!.text).toBe('Push-ups stalled. Log protein to see why. Log your sleep to see why.')
    expect(stallInsight(stalled, { protein: { avg: 80, days: 4, goal: 135 }, sleep: null })!.text).toContain('Fix that first. Log your sleep to see why.')
  })
  it('says protein and sleep look fine when they do, and counts readiness', () => {
    expect(stallInsight(stalled, { protein: { avg: 130, days: 6, goal: 135 }, sleep: { avgMin: 470, nights: 6 } })!.text).toContain('look fine')
    expect(stallInsight(stalled, { protein: { avg: 130, days: 6, goal: 135 }, sleep: { avgMin: 470, nights: 6 }, readiness: { mode: 'light', why: 'sore' } })!.causes[0]).toContain('lighter day')
  })
  it('shows nothing when nothing stalled', () => {
    expect(stallInsight([], { protein: null, sleep: null })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { dayKey } from './dates'
import {
  alarmDue,
  applyStudyOp,
  checkManual,
  cleanLog,
  cleanStore,
  clockText,
  filterBlocks,
  filterCounts,
  hmText,
  isForgotten,
  minutesUntil,
  putNote,
  rangeOf,
  runNow,
  saveBlock,
  sessionCap,
  starterStore,
  streakOf,
  studyStats,
  totalsByGroup,
  weekEnd,
  weekStart,
  type StudySession,
  type StudyStore
} from './studyTime'

const NOW = new Date(2026, 10, 13, 10, 0) // Fri 13 Nov 2026, local
const iso = (h: number, m = 0, d = 13) => new Date(2026, 10, d, h, m).toISOString()

function store(): StudyStore {
  let s = cleanStore(null)
  s = saveBlock(s, { id: 'a', name: 'Algebra', category: 'Math', tags: ['#Exam', 'practice'], plannedMin: 50, quick: true }, NOW)
  s = saveBlock(s, { id: 'b', name: 'Essay', category: 'English', tags: ['writing'], plannedMin: null, due: '2026-11-14' }, NOW)
  s = saveBlock(s, { id: 'c', name: 'Old lab', category: 'Science', tags: [], plannedMin: 30, done: true }, NOW)
  s = saveBlock(s, { id: 'd', name: 'Next week', category: 'Math', tags: [], plannedMin: 25, due: '2026-11-20' }, NOW)
  return s
}

const ses = (id: number, day: string, blockId: string | null, minutes: number, breakMin = 0, subject = 'X'): StudySession => ({
  id,
  day,
  blockId,
  subject,
  minutes,
  breakMin,
  startedAt: `${day}T09:00:00.000Z`,
  endedAt: `${day}T10:00:00.000Z`,
  source: 'timer'
})

describe('blocks', () => {
  it('cleans what it is given: tags lower case without #, new categories get a colour, duplicates dropped', () => {
    const s = store()
    expect(s.blocks.find((b) => b.id === 'a')!.tags).toEqual(['exam', 'practice'])
    expect(s.categories.map((c) => c.name)).toEqual(['Math', 'English', 'Science'])
    const again = cleanStore({ blocks: [...s.blocks, s.blocks[0], { id: '', name: 'x' }, 'junk'], categories: [{ name: 'Math', color: 'red' }] })
    expect(again.blocks).toHaveLength(4)
    expect(again.categories).toEqual([])
  })
  it('a save without a name is refused; ops apply inside the save', () => {
    expect(() => saveBlock(store(), { id: 'z', name: '  ' }, NOW)).toThrow('name')
    const done = applyStudyOp(store(), { op: 'done', id: 'a', done: true }, NOW)
    expect(done.blocks.find((b) => b.id === 'a')!.done).toBe(true)
    expect(applyStudyOp(store(), { op: 'remove', id: 'a' }, NOW).blocks.map((b) => b.id)).not.toContain('a')
    expect(applyStudyOp(cleanStore(null), { op: 'starter' }, NOW).blocks.length).toBe(3)
    expect(applyStudyOp(store(), { op: 'starter' }, NOW).blocks.length).toBe(4)
    expect(starterStore(NOW).blocks.every((b) => b.quick)).toBe(true)
  })
})

describe('filters (Focus To-Do style)', () => {
  const today = '2026-11-13'
  it('Today, Tomorrow, This week, All, Completed, category and tag', () => {
    const s = store()
    const ids = (f: Parameters<typeof filterBlocks>[1]) => filterBlocks(s.blocks, f, today).map((b) => b.id)
    expect(ids({ kind: 'today' })).toEqual(['a'])
    expect(ids({ kind: 'tomorrow' })).toEqual(['b'])
    expect(ids({ kind: 'week' })).toEqual(['a', 'b'])
    expect(ids({ kind: 'all' })).toEqual(['a', 'b', 'd'])
    expect(ids({ kind: 'done' })).toEqual(['c'])
    expect(ids({ kind: 'category', name: 'math' })).toEqual(['a', 'd'])
    expect(ids({ kind: 'tag', tag: '#EXAM' })).toEqual(['a'])
    expect(filterCounts(s.blocks, today)).toEqual({ today: 1, tomorrow: 1, week: 2, all: 3, done: 1 })
  })
  it('weeks run Monday to Sunday', () => {
    expect(weekStart('2026-11-13')).toBe('2026-11-09')
    expect(weekEnd('2026-11-13')).toBe('2026-11-15')
    expect(weekEnd('2026-11-15')).toBe('2026-11-15')
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
  })
})

describe('the running timer', () => {
  it('works from the stored start time: breaks never count, a reload loses nothing', () => {
    const run = { subject: 'Algebra', startedAt: iso(9), planned: 50, pausedMs: 5 * 60_000 }
    const n = runNow(run, NOW.getTime())
    expect(n.workedMs).toBe(55 * 60_000)
    expect(n.breakMs).toBe(5 * 60_000)
    expect(n.plannedEndsAt).toBe(Date.parse(iso(9, 55)))
    // On a break of 10 min that began at 09:50: work stands still, the break end is known.
    const brk = runNow({ ...run, pausedAt: iso(9, 50), breakMin: 10 }, NOW.getTime())
    expect(brk.onBreak).toBe(true)
    expect(brk.workedMs).toBe(45 * 60_000)
    expect(brk.breakMs).toBe(15 * 60_000)
    expect(brk.breakEndsAt).toBe(Date.parse(iso(10)))
    // An open stopwatch has no planned end.
    expect(runNow({ ...run, open: true }, NOW.getTime()).plannedEndsAt).toBeNull()
  })
  it('one cap: planned + 30 min (never past 4 h); an open stopwatch 4 h', () => {
    expect(sessionCap({ planned: 50 })).toBe(80)
    expect(sessionCap({ planned: 230 })).toBe(240)
    expect(sessionCap({ planned: 240, open: true })).toBe(240)
  })
  it('a timer forgotten overnight is found: past the cap, or into a new app day', () => {
    const day = (d: Date) => dayKey(d)
    const late = { subject: 'Essay', startedAt: new Date(2026, 10, 12, 22, 30).toISOString(), planned: 240, open: true }
    // 01:30 is still the same app day (it turns at 04:00): not forgotten yet.
    expect(isForgotten(late, new Date(2026, 10, 13, 1, 30).getTime(), day)).toBe(false)
    // 08:00 the next morning: a new app day and past the 4 h cap.
    expect(isForgotten(late, new Date(2026, 10, 13, 8, 0).getTime(), day)).toBe(true)
    // A planned 25 min block left running 2 hours: past its cap.
    expect(isForgotten({ subject: 'x', startedAt: iso(8), planned: 25 }, NOW.getTime(), day)).toBe(true)
    expect(isForgotten({ subject: 'x', startedAt: iso(9, 30), planned: 25 }, NOW.getTime(), day)).toBe(false)
  })
  it('putting a forgotten timer right: minutes up to the end you say, capped', () => {
    const run = { subject: 'Essay', startedAt: iso(9), planned: 240, open: true, pausedMs: 10 * 60_000 }
    expect(minutesUntil(run, Date.parse(iso(10, 30)))).toBe(80)
    expect(minutesUntil(run, Date.parse(iso(23)))).toBe(240)
    expect(minutesUntil(run, Date.parse(iso(8)))).toBe(1)
  })
})

describe('stats', () => {
  const today = '2026-11-13'
  const s = store()
  const all = [
    ses(1, '2026-11-13', 'a', 60, 10),
    ses(2, '2026-11-13', 'b', 30, 5),
    ses(3, '2026-11-12', 'a', 40),
    ses(4, '2026-11-11', null, 20, 0, 'Loose'),
    ses(5, '2026-11-09', 'd', 25),
    ses(6, '2026-11-02', 'a', 100)
  ]
  it('a day, a week and a month, with totals, breaks apart and the average session', () => {
    const day = studyStats(all, s, rangeOf('day', today), 'category', today)
    expect(day.totalMin).toBe(90)
    expect(day.breakMin).toBe(15)
    expect(day.sessions).toBe(2)
    expect(day.avgSessionMin).toBe(45)
    const week = studyStats(all, s, rangeOf('week', today), 'category', today)
    expect(week.range).toEqual({ from: '2026-11-09', to: '2026-11-13' })
    expect(week.totalMin).toBe(175)
    expect(week.byDay.map((d) => d.minutes)).toEqual([25, 0, 20, 40, 90])
    expect(week.beforeMin).toBe(0) // the same 5 days of last week (4–8 Nov)
    expect(studyStats(all, s, rangeOf('custom', today, { from: '2026-11-09', to: '2026-11-15' }), 'block', today).beforeMin).toBe(100)
    expect(studyStats(all, s, rangeOf('month', today), 'block', today).totalMin).toBe(275)
  })
  it('the donut by category, tag or block (biggest first, "No block" for loose sessions)', () => {
    const r = rangeOf('week', today)
    const byCat = studyStats(all, s, r, 'category', today).slices
    expect(byCat.map((x) => [x.label, x.minutes])).toEqual([
      ['Math', 125],
      ['English', 30],
      ['No block', 20]
    ])
    expect(byCat[0].color).toBe(s.categories[0].color)
    const byTag = studyStats(all, s, r, 'tag', today).slices
    expect(byTag.map((x) => x.label)).toEqual(['#exam', '#practice', 'No tag', '#writing'])
    expect(byTag[0].minutes).toBe(100)
    const byBlock = studyStats(all, s, r, 'block', today)
    expect(byBlock.slices[0]).toMatchObject({ label: 'Algebra', minutes: 100 })
    expect(byBlock.topBlocks.map((b) => b.label)).toEqual(['Algebra', 'Essay', 'Next week', 'Loose'])
  })
  it('small slices fold into Other', () => {
    const many = Array.from({ length: 9 }, (_, i) => ses(i + 1, today, null, 10 + i, 0, `S${i}`))
    const st = studyStats(many, s, rangeOf('day', today), 'block', today, 6)
    expect(st.slices).toHaveLength(6)
    expect(st.slices[5].label).toBe('Other')
    expect(st.slices.reduce((t, x) => t + x.minutes, 0)).toBe(st.totalMin)
  })
  it('studied against plan, streaks and the best day', () => {
    const week = studyStats(all, s, rangeOf('week', today), 'block', today)
    // Planned blocks: a (50) twice, d (25) once → 125 planned, 125 done.
    expect(week.plan).toEqual({ plannedMin: 125, actualMin: 125, pct: 100 })
    expect(week.streak).toBe(3) // 11, 12, 13
    expect(week.bestStreak).toBe(3)
    expect(week.bestDay).toEqual({ day: today, minutes: 90 })
    expect(streakOf(new Set(['2026-11-12', '2026-11-11']), today)).toBe(2) // today not yet
    expect(streakOf(new Set(['2026-11-10']), today)).toBe(0)
  })
  it('custom ranges are ordered and at most a year', () => {
    expect(rangeOf('custom', today, { from: '2026-11-10', to: '2026-11-01' })).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(rangeOf('custom', today, { from: '2024-01-01', to: today }).from).toBe('2025-11-12')
    expect(rangeOf('custom', today, null)).toEqual({ from: '2026-11-07', to: today })
  })
  it('totals per category and tag for the filter list', () => {
    const t = totalsByGroup(all, s)
    expect(t.category.get('math')).toBe(225)
    expect(t.tag.get('exam')).toBe(200)
  })
})

describe('session notes and text', () => {
  it('keeps notes by start time, drops old ones', () => {
    const now = NOW.getTime()
    let log = putNote({}, iso(9), { b: 'a', k: 5 }, now)
    log = putNote(log, new Date(2025, 0, 1).toISOString(), { b: 'x' }, now)
    expect(Object.keys(log)).toEqual([iso(9)])
    expect(cleanLog({ ...log, bad: { b: 'y' }, [iso(8)]: { b: 7, k: -1, s: 'weird' } })).toEqual({ [iso(9)]: { b: 'a', k: 5 }, [iso(8)]: {} })
    expect(putNote(log, iso(9), null, now)).toEqual({})
  })
  it('checks a typed-in session', () => {
    expect(checkManual({ minutes: 30, day: '2026-11-13' }, '2026-11-13')).toBeNull()
    expect(checkManual({ minutes: 30, day: '2026-11-14' }, '2026-11-13')).toMatch(/not come/)
    expect(checkManual({ minutes: 30, day: '2026-10-01' }, '2026-11-13')).toMatch(/14 days/)
    expect(checkManual({ minutes: 0, day: '2026-11-13' }, '2026-11-13')).toMatch(/Minutes/)
  })
  it('writes time plainly', () => {
    expect(hmText(65)).toBe('1h 05m')
    expect(hmText(45)).toBe('45m')
    expect(clockText(65_000)).toBe('1:05')
    expect(clockText(3_725_000)).toBe('1:02:05')
  })
})

describe('the reminder when a planned block or a break ends', () => {
  it('fires once for the planned end and once for a break end, never for an open stopwatch or a plain focus timer', () => {
    const said = new Set<string>()
    const run = { subject: 'Algebra', startedAt: iso(9), planned: 50, blockId: 'a' }
    expect(alarmDue(run, Date.parse(iso(9, 49)), said)).toBeNull()
    const end = alarmDue(run, Date.parse(iso(9, 50)), said)!
    expect(end.text).toMatch(/planned time done/)
    said.add(end.key)
    expect(alarmDue(run, Date.parse(iso(9, 51)), said)).toBeNull()
    const brk = { ...run, pausedAt: iso(9, 52), breakMin: 5 }
    expect(alarmDue(brk, Date.parse(iso(9, 56)), said)).toBeNull()
    expect(alarmDue(brk, Date.parse(iso(9, 57)), said)!.text).toMatch(/Break's over/)
    expect(alarmDue({ ...run, open: true, planned: 240 }, Date.parse(iso(23)), new Set())).toBeNull()
    expect(alarmDue({ subject: 'x', startedAt: iso(9), planned: 25 }, Date.parse(iso(9, 30)), new Set())).toBeNull()
  })
})

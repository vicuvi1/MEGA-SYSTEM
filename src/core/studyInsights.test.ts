import { describe, expect, it } from 'vitest'
import { bestHours, dayTimeline, goalViews, heatMap, sessionsCsv, sliceDetail } from './studyInsights'
import { applyStudyOp, cleanStore, NO_BLOCK_KEY, resolveBlocks, saveBlock, studyStats, rangeOf, totalsByGroup, type StudySession } from './studyTime'

// Times are built from local dates, so these pass in any time zone.
const NOW = new Date(2026, 10, 13, 18, 0) // Fri 13 Nov 2026
const today = '2026-11-13'
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`
let id = 0
const ses = (d: number, h: number, minutes: number, blockId: string | null, extra: Partial<StudySession> = {}): StudySession => ({
  id: ++id,
  day: day(d),
  blockId,
  subject: extra.subject ?? 'Algebra',
  minutes,
  breakMin: 0,
  startedAt: at(d, h),
  endedAt: new Date(new Date(2026, 10, d, h).getTime() + (minutes + (extra.breakMin ?? 0)) * 60_000).toISOString(),
  source: 'timer',
  ...extra
})

function store() {
  let s = cleanStore(null)
  s = saveBlock(s, { id: 'a', name: 'Algebra', category: 'Math', tags: ['practice'], plannedMin: 50 }, NOW)
  s = saveBlock(s, { id: 'b', name: 'Essay', category: 'English', tags: [], plannedMin: 25 }, NOW)
  s = applyStudyOp(s, { op: 'goal', category: 'Math', minutes: 360 }, NOW)
  s = applyStudyOp(s, { op: 'goal', category: 'English', minutes: 60 }, NOW)
  return applyStudyOp(s, { op: 'color', category: 'Math', color: '#7c9cff', emoji: '📐' }, NOW)
}

describe('the numbers agree: sessions with no block', () => {
  it('a plain focus session takes the block of the same name, the rest count under "No block"', () => {
    const s = store()
    const all = resolveBlocks([ses(13, 9, 30, null, { subject: 'algebra' }), ses(13, 11, 23, null, { subject: 'Plain focus' })], s)
    expect(all.map((x) => x.blockId)).toEqual(['a', null])
    const t = totalsByGroup(all, s)
    expect(t.total).toBe(53)
    expect([...t.category.values()].reduce((a, b) => a + b, 0)).toBe(53)
    expect(t.category.get('~none')).toBe(23)
    expect(t.tag.get('')).toBe(23)
    const st = studyStats(all, s, rangeOf('day', today), 'category', today)
    expect(st.slices.find((x) => x.key === NO_BLOCK_KEY)).toMatchObject({ label: 'No block', minutes: 23 })
  })
})

describe('goals per subject', () => {
  it('this week against the goal, with an even pace and a warning when behind', () => {
    const s = store()
    // Mon–Fri: Math 60 min, English 70 min.
    const all = [ses(9, 9, 30, 'a'), ses(11, 9, 30, 'a'), ses(12, 9, 40, 'b'), ses(13, 9, 30, 'b'), ses(6, 9, 300, 'a')]
    const [math, eng] = goalViews(all, s, today)
    expect(math).toMatchObject({ category: 'Math', doneMin: 60, goalMin: 360, expectedMin: 257, behind: true, reached: false, leftMin: 300, daysLeft: 3, perDayMin: 100, emoji: '📐' })
    expect(eng).toMatchObject({ doneMin: 70, reached: true, behind: false, pct: 117 })
  })
})

describe('best hours', () => {
  it('minutes per clock hour (a session spread over its hours) and the hours you focus longest', () => {
    const all = [ses(12, 9, 50, 'a'), ses(13, 9, 40, 'a'), ses(12, 14, 20, 'b'), ses(13, 14, 15, 'b'), ses(11, 21, 90, 'a'), ses(13, 7, 30, 'a', { source: 'manual' })]
    const b = bestHours(all, today, 30)
    expect(b.hours[9]).toMatchObject({ minutes: 90, sessions: 2, avgMin: 45 })
    expect(b.hours[21].minutes).toBe(60)
    expect(b.hours[22].minutes).toBe(30)
    expect(b.hours[7].minutes).toBe(0) // typed in: no real clock
    expect(b.best).toEqual([9, 14])
    expect(b.line).toBe('Your best hours: 9–10, 14–15')
  })
  it('breaks inside a session thin its minutes over the hours it covered', () => {
    const b = bestHours([ses(13, 10, 60, 'a', { breakMin: 60 })], today)
    expect(b.hours[10].minutes + b.hours[11].minutes).toBe(60)
  })
})

describe('the heat map and the timeline', () => {
  it('weeks of days, Monday first, levels by your own busiest days', () => {
    const h = heatMap([ses(13, 9, 120, 'a'), ses(12, 9, 10, 'a'), ses(10, 9, 30, 'a'), ses(9, 9, 60, 'a')], today, 4)
    expect(h.weeks).toHaveLength(4)
    expect(h.weeks[3][0].day).toBe('2026-11-09')
    expect(h.weeks[3].map((c) => c.level)).toEqual([3, 2, 0, 1, 4, 0, 0])
    expect(h.weeks[3][6]).toMatchObject({ day: '2026-11-15', future: true })
    expect(h).toMatchObject({ maxMin: 120, totalMin: 220, activeDays: 4 })
  })
  it('a day from morning to night: when you studied what, in its colour', () => {
    const s = store()
    const t = dayTimeline([ses(13, 9, 50, 'a', { note: 'Proofs' }), ses(13, 23, 90, 'b'), ses(12, 9, 10, 'a')], s, today)
    expect(t.segs.map((x) => [x.from, x.to, x.label])).toEqual([
      [540, 590, 'Algebra'],
      [1380, 1470, 'Essay']
    ])
    expect(t.segs[0]).toMatchObject({ color: '#7c9cff', emoji: '📐', note: 'Proofs' })
    expect([t.from, t.to]).toEqual([360, 1500])
  })
})

describe('one subject and the CSV', () => {
  it('a slice\'s sessions and its trend over 8 weeks', () => {
    const d = sliceDetail([ses(13, 9, 50, 'a'), ses(12, 9, 10, 'b'), ses(5, 9, 30, 'a')], store(), 'category', 'c:math', today)
    expect(d.sessions.map((x) => x.minutes)).toEqual([50, 30])
    expect(d.trend).toHaveLength(8)
    expect(d.trend.slice(-2).map((x) => x.minutes)).toEqual([30, 50])
  })
  it('exports block, category, tags, start, end, break, pause and note (quoted when needed)', () => {
    const csv = sessionsCsv([ses(13, 9, 50, 'a', { breakMin: 5, pauseMin: 2, note: 'Proofs, "hard" ones' }), ses(12, 9, 10, null, { subject: 'Loose' })], store())
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('block,category,tags,start,end,minutes,break_min,pause_min,pomodoros,source,note')
    expect(lines[1]).toBe(`Loose,No block,,${at(12, 9)},${new Date(2026, 10, 12, 9, 10).toISOString()},10,0,0,0,timer,`)
    expect(lines[2].endsWith(',50,5,2,0,timer,"Proofs, ""hard"" ones"')).toBe(true)
    expect(lines[2].startsWith('Algebra,Math,practice,')).toBe(true)
  })
})

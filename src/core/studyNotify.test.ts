import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { studyNotice, type NoticeIn } from './studyNotify'
import { applyStudyOp, cleanStore, localDay, saveBlock, type StudyRun, type StudySession } from './studyTime'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m)
const iso = (d: number, h: number, m = 0) => at(d, h, m).toISOString()

function store() {
  let s = cleanStore(null)
  s = saveBlock(s, { id: 'a', name: 'Algebra', category: 'Math', tags: [], plannedMin: 50 }, at(13, 8))
  s = saveBlock(s, { id: 'b', name: 'Essay', category: 'English', tags: [], plannedMin: 25, due: '2026-11-13' }, at(13, 8))
  s = applyStudyOp(s, { op: 'color', category: 'Math', color: '#7c9cff', emoji: '📐' }, at(13, 8))
  return applyStudyOp(s, { op: 'prefs', prefs: { endSound: 'levelUp', breakSound: 'success' } }, at(13, 8))
}

const pomoRun = (extra: Partial<StudyRun> = {}): StudyRun => ({ subject: 'Algebra', startedAt: iso(13, 9), planned: 25, blockId: 'a', pomo: { work: 25, short: 5, long: 15, every: 4, done: 0, at: 25 }, ...extra })

function input(o: Partial<NoticeIn> & { now: number }): NoticeIn {
  const said = new Set<string>()
  return { run: null, today: '2026-11-13', store: store(), sessions: [], done: (id) => said.has(id), meeting: false, dayOf: localDay, ...o }
}

describe('Study Time notices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(13, 9))
  })
  afterEach(() => vi.useRealTimers())

  it('pomodoro done → "Take 5" / "Keep going", with your end sound; one over-time nudge later; a long break after 4', () => {
    expect(studyNotice(input({ run: pomoRun(), now: at(13, 9, 24).getTime() }))).toBeNull()
    const n = studyNotice(input({ run: pomoRun(), now: at(13, 9, 25).getTime() }))!
    expect(n).toMatchObject({ kind: 'pomoDone', timer: true, title: 'Pomodoro 1 done', sound: 'levelUp', face: '🍅' })
    expect(n.actions.map((a) => [a.label, a.op])).toEqual([
      ['Take 5', 'pomoBreak'],
      ['Keep going', 'keepGoing'],
      ['Stop & log', 'stop']
    ])
    // Answered (or left): after 10 more minutes, one nudge, then nothing.
    const said = new Set([n.id])
    const over = studyNotice({ ...input({ run: pomoRun(), now: at(13, 9, 36).getTime() }), done: (id) => said.has(id) })!
    expect(over).toMatchObject({ kind: 'overtime', title: '11 min past the pomodoro' })
    said.add(over.id)
    expect(studyNotice({ ...input({ run: pomoRun(), now: at(13, 9, 40).getTime() }), done: (id) => said.has(id) })).toBeNull()
    const fourth = pomoRun({ pomo: { work: 25, short: 5, long: 15, every: 4, done: 3, at: 25 } })
    expect(studyNotice(input({ run: fourth, now: at(13, 9, 25).getTime() }))!.actions[0].label).toBe('Take 15')
  })

  it('break over → "Back to Algebra", with your break sound', () => {
    const run = pomoRun({ pausedAt: iso(13, 9, 25), pausedMs: 0, pauseKind: 'break', breakMin: 5, pomo: { work: 25, short: 5, long: 15, every: 4, done: 1, at: 50 } })
    expect(studyNotice(input({ run, now: at(13, 9, 29).getTime() }))).toBeNull()
    const n = studyNotice(input({ run, now: at(13, 9, 30).getTime() }))!
    expect(n).toMatchObject({ kind: 'breakOver', title: "Break's over", sound: 'success', face: '📐' })
    expect(n.actions[0]).toMatchObject({ label: 'Back to Algebra', op: 'back' })
    // A plain pause never rings.
    expect(studyNotice(input({ run: { ...run, pauseKind: 'pause', breakMin: null }, now: at(13, 9, 40).getTime() }))).toBeNull()
  })

  it('count up: planned time reached, then one over-time nudge 15 min later', () => {
    const run: StudyRun = { subject: 'Algebra', startedAt: iso(13, 9), planned: 50, blockId: 'a' }
    expect(studyNotice(input({ run, now: at(13, 9, 50).getTime() }))).toMatchObject({ kind: 'planned', title: 'Planned time reached' })
    expect(studyNotice(input({ run, now: at(13, 10, 5).getTime() }))).toMatchObject({ kind: 'overtime', title: '15 min over the plan' })
    // An open stopwatch never has a planned end.
    expect(studyNotice(input({ run: { ...run, open: true, planned: 240 }, now: at(13, 10, 30).getTime() }))).toBeNull()
  })

  it('a forgotten timer comes first; in a meeting the timer notices wait as a dot', () => {
    const run: StudyRun = { subject: 'Algebra', startedAt: iso(12, 22), planned: 50, blockId: 'a' }
    expect(studyNotice(input({ run, now: at(13, 8).getTime(), today: '2026-11-13' }))).toMatchObject({ kind: 'forgot', title: 'Timer still running?' })
    expect(studyNotice(input({ run: pomoRun(), now: at(13, 9, 25).getTime(), meeting: true }))).toMatchObject({ kind: 'pomoDone', dot: true })
  })

  it('nothing running: a goal reached, a planned block waiting, a goal behind; never in a meeting, never with nudges off', () => {
    let s = applyStudyOp(store(), { op: 'goal', category: 'Math', minutes: 60 }, at(13, 8))
    const ses = (h: number, minutes: number, blockId: string, d = 13): StudySession => ({ id: h, day: `2026-11-${d}`, blockId, subject: '', minutes, breakMin: 0, startedAt: iso(d, h), endedAt: new Date(at(d, h).getTime() + minutes * 60_000).toISOString(), source: 'timer' })
    // Reached today: once.
    const reached = studyNotice(input({ store: s, sessions: [ses(9, 30, 'a', 12), ses(10, 40, 'a')], now: at(13, 12).getTime() }))!
    expect(reached).toMatchObject({ kind: 'goalReached', title: 'Goal reached', sound: 'remindReward' })
    // Reached before today: no notice; the Essay due today is waiting (nothing studied for 45 min).
    const due = studyNotice(input({ store: s, sessions: [ses(9, 70, 'a', 12)], now: at(13, 12).getTime() }))!
    expect(due).toMatchObject({ kind: 'due', title: 'Your planned block is waiting' })
    expect(due.actions[0]).toMatchObject({ op: 'start', blockId: 'b', label: 'Start Essay' })
    expect(studyNotice(input({ store: s, sessions: [ses(11, 40, 'b')], now: at(13, 12).getTime() }))?.kind).not.toBe('due')
    // Behind (afternoon): Math 10 of 60 by Friday.
    s = applyStudyOp(s, { op: 'save', block: { id: 'b', name: 'Essay', category: 'English', due: null } }, at(13, 8))
    const behind = studyNotice(input({ store: s, sessions: [ses(9, 10, 'a', 10)], now: at(13, 15).getTime() }))!
    expect(behind).toMatchObject({ kind: 'goalBehind', title: 'Behind on Math' })
    expect(behind.actions[0]).toMatchObject({ op: 'start', blockId: 'a' })
    expect(studyNotice(input({ store: s, sessions: [], now: at(13, 15).getTime(), meeting: true }))).toBeNull()
    const off = applyStudyOp(s, { op: 'prefs', prefs: { nudges: false } }, at(13, 8))
    expect(studyNotice(input({ store: off, sessions: [], now: at(13, 15).getTime() }))).toBeNull()
    // Late at night: no gentle nudges.
    expect(studyNotice(input({ store: s, sessions: [], now: at(13, 22, 30).getTime() }))).toBeNull()
  })
})

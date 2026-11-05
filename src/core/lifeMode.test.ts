import { describe, expect, it } from 'vitest'
import { activeMode, cleanModes, EMPTY_MODES, endMode, modeLine, modeRestDays, modeRules, modeTarget, startMode } from './lifeMode'
import { dueRhythm, DEFAULT_RHYTHM_PREFS, type RhythmFacts } from './rhythm'

const now = new Date('2026-11-05T09:00:00Z')

describe('life modes (FT4)', () => {
  it('runs for N days with an end date, then moves to the past by itself', () => {
    const b = startMode(EMPTY_MODES, 'sick', 3, '2026-11-05', now)
    expect(b.current).toMatchObject({ kind: 'sick', from: '2026-11-05', until: '2026-11-07' })
    expect(modeRules(b, '2026-11-06')).toMatchObject({ label: 'Sick', dayN: 2, days: 3, training: false, idle: false })
    expect(activeMode(b, '2026-11-08')).toBeNull()
    const later = cleanModes(b, '2026-11-08')
    expect(later.current).toBeNull()
    expect(later.past).toHaveLength(1)
  })
  it('"end now" keeps the days already in the mode, and one started today leaves no trace', () => {
    const b = startMode(EMPTY_MODES, 'travel', 5, '2026-11-03', now)
    const ended = endMode(b, '2026-11-05')
    expect(ended.current).toBeNull()
    expect(ended.past[0]).toMatchObject({ from: '2026-11-03', until: '2026-11-04' })
    expect(endMode(startMode(EMPTY_MODES, 'exam', 7, '2026-11-05', now), '2026-11-05')).toEqual({ current: null, past: [] })
  })
  it('sick and travel days keep the workout streak; exam week does not', () => {
    let b = startMode(EMPTY_MODES, 'travel', 2, '2026-11-01', now)
    b = startMode(cleanModes(b, '2026-11-04'), 'exam', 7, '2026-11-04', now)
    expect(modeRestDays(b, '2026-11-05')).toEqual(['2026-11-01', '2026-11-02'])
  })
  it('targets move with the mode', () => {
    const exam = modeRules(startMode(EMPTY_MODES, 'exam', 7, '2026-11-05', now), '2026-11-05')
    expect(modeTarget(50, exam)).toBe(75)
    expect(modeTarget(50, null)).toBe(50)
    expect(modeLine(EMPTY_MODES, '2026-11-05')).toBe('')
    expect(modeLine(startMode(EMPTY_MODES, 'exam', 7, '2026-11-05', now), '2026-11-05')).toMatch(/Exam week.*day 1 of 7/)
  })
  it('the rhythm respects the mode: no training nudge, fewer water nudges', () => {
    const f: RhythmFacts = { today: '2026-11-05', time: '19:00', weekday: 4, wakeAt: '07:00', wakeTarget: '07:00', waterMl: 0, waterTarget: 2000, workoutDone: false, paused: false }
    const st = { day: '2026-11-05', water: ['11:00', '13:00'], briefing: { status: 'approved' } } as any
    const prefs = { ...DEFAULT_RHYTHM_PREFS, on: true, evening: '22:00' }
    expect(dueRhythm(st, prefs, f)).toEqual(expect.arrayContaining(['training', 'water']))
    const quiet = dueRhythm(st, prefs, { ...f, mode: { waterMax: 2, training: false, replan: true } })
    expect(quiet).not.toContain('training')
    expect(quiet).not.toContain('water')
  })
})

import { describe, expect, it } from 'vitest'
import { cleanProposal, dayScore, DEFAULT_RHYTHM_PREFS, dueRhythm, localProposal, proposalText, readLines, rhythmFor, reviewText, suggestWeekFocus, waterBehind, weakest, type RhythmFacts } from './rhythm'

const today = '2026-11-02' // a Monday
const facts = (over: Partial<RhythmFacts> = {}): RhythmFacts => ({ today, time: '08:00', weekday: 1, wakeAt: null, wakeTarget: '07:00', waterMl: 0, waterTarget: 2700, workoutDone: false, paused: false, ...over })
const ev = (title: string, s: string, e: string) => ({ id: title, calendarId: 'c', title, start: new Date(`${today}T${s}:00`).toISOString(), end: new Date(`${today}T${e}:00`).toISOString(), allDay: false })

describe('rhythm: when things are due', () => {
  it('sends the morning plan after the wake-up, once, before noon', () => {
    const s = rhythmFor(null, today)
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '07:30' }))).toEqual([])
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '07:45' }))).toEqual(['briefing'])
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '06:40', wakeAt: '06:30' }))).toEqual(['briefing'])
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '12:10', waterMl: 2000 }))).toEqual([])
    const sent = { ...s, briefing: { status: 'proposed' as const, sentAt: '', plan: localProposal({ today, now: '08:00', events: [], tasks: [], top3: [], waterTarget: 2700, workoutDone: false }), version: 1 } }
    expect(dueRhythm(sent, DEFAULT_RHYTHM_PREFS, facts({ time: '09:00', waterMl: 500 }))).toEqual([])
  })

  it('evening review, Sunday review, training nudge; nothing when off', () => {
    const s = { ...rhythmFor(null, today), briefing: undefined }
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '21:05', waterMl: 2700, workoutDone: true }))).toEqual(['evening'])
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '18:30', waterMl: 2000 }))).toEqual(['training'])
    expect(dueRhythm(s, DEFAULT_RHYTHM_PREFS, facts({ time: '21:05', weekday: 0, waterMl: 2700, workoutDone: true }))).toEqual(['weekly', 'evening'])
    expect(dueRhythm(s, { ...DEFAULT_RHYTHM_PREFS, on: false }, facts({ time: '21:05' }))).toEqual([])
  })

  it('water nudges only when far behind, spaced out, at most 3', () => {
    const s = rhythmFor(null, today)
    expect(waterBehind(s, facts({ time: '14:00', waterMl: 300 }))).toBe(true)
    expect(waterBehind(s, facts({ time: '14:00', waterMl: 1200 }))).toBe(false)
    expect(waterBehind({ ...s, water: ['13:00'] }, facts({ time: '14:00', waterMl: 300 }))).toBe(false)
    expect(waterBehind({ ...s, water: ['11:00', '13:00', '15:00', '16:50', '18:40'] }, facts({ time: '20:30', waterMl: 300 }))).toBe(false)
  })

  it('a new day keeps tomorrow and the weekly review only', () => {
    const s = rhythmFor({ day: '2026-11-01', water: ['12:00'], evening: { sentAt: '', score: 50, top3: [] }, tomorrow: { day: today, top3: ['A'] } }, today)
    expect(s).toEqual({ day: today, water: [], tomorrow: { day: today, top3: ['A'] } })
  })
})

describe('rhythm: the plan', () => {
  it('builds a local plan from last night\'s top 3, in free time, with a training slot', () => {
    const p = localProposal({ today, now: '08:05', events: [ev('Lecture', '09:00', '12:00')], tasks: [{ content: 'Call the bank', priority: 4 }, { content: 'Read ch. 2', starred: true }], top3: ['Lab report'], waterTarget: 2700, workoutDone: false })
    expect(p.mustdos).toEqual(['Lab report', 'Read ch. 2', 'Call the bank'])
    expect(p.blocks[0]).toEqual({ title: 'Lab report', start: '12:00', minutes: 50 })
    expect((p.training?.time ?? '') >= '17:00').toBe(true)
    expect(proposalText(p)).toContain('12:00–12:50 Lab report')
  })

  it('cleans the model\'s plan: no clashes, real times, past times dropped', () => {
    const events = [ev('Lecture', '09:00', '12:00')]
    const fb = localProposal({ today, now: '08:00', events, tasks: [], top3: ['X'], waterTarget: 2700, workoutDone: true })
    const p = cleanProposal({ headline: 'Push day', mustdos: ['A', 'B', 'C', 'D'], blocks: [{ title: 'Clash', start: '10:00', minutes: 50 }, { title: 'Early', start: '07:00', minutes: 30 }, { title: 'Good', start: '13:00', minutes: 50 }, { title: 'Overlap', start: '13:30', minutes: 30 }], training: { time: '18:00', what: 'Run 5 km' }, waterMl: 3000 }, fb, events, '08:00')
    expect(p.mustdos).toEqual(['A', 'B', 'C'])
    expect(p.blocks).toEqual([{ title: 'Good', start: '13:00', minutes: 50 }])
    expect(p.training).toEqual({ time: '18:00', what: 'Run 5 km' })
    expect(p.waterMl).toBe(3000)
    expect(cleanProposal('nonsense', fb, events, '08:00')).toBe(fb)
  })
})

describe('rhythm: reviews', () => {
  const r = { mustdosDone: 2, mustdosTotal: 3, focusMin: 60, plannedFocusMin: 100, blocksDone: 1, blocksPlanned: 2, waterMl: 2700, waterTarget: 2700, workoutDone: true, trainingPlanned: true }
  it('scores the day and names the weakest part', () => {
    expect(dayScore(r)).toBe(Math.round((2 / 3) * 40 + 0.6 * 30 + 15 + 15))
    expect(weakest(r)).toContain('Focus 60 of 100')
    expect(weakest({ ...r, focusMin: 100 })).toContain('1 must-do left open')
    expect(weakest({ ...r, mustdosDone: 3, focusMin: 100 })).toContain('Everything done')
    expect(reviewText(r, 75, 'Start earlier.', ['A', 'B'])).toContain("Tomorrow's top 3")
  })
  it('picks the weakest metric for next week and reads typed lists', () => {
    expect(suggestWeekFocus([{ id: 'focus', now: 8, target: 10 }, { id: 'wake', now: 2, target: 7 }, { id: 'spend', now: 0, target: 1 }])).toBe('wake')
    expect(readLines('1. Lab report\n2) Rust ch. 4\n- 3 runs\n4. extra')).toEqual(['Lab report', 'Rust ch. 4', '3 runs'])
  })
})

import { nameAndRank } from './rhythm'
describe('morning plan: rules build, AI only names and ranks (N6)', () => {
  const rules = { day: '2026-11-05', headline: '2 must-dos', mustdos: ['Lab report', 'Read ch. 4'], blocks: [{ title: 'Focus', start: '09:00', minutes: 50 }, { title: 'Focus', start: '10:00', minutes: 50 }], training: null, waterMl: 2500 } as any
  it('keeps the times, takes names, ranking and headline', () => {
    const p = nameAndRank(rules, { headline: '2 must-dos · 1h40 focus', mustdos: ['read ch. 4', 'Lab report'], names: ['Lab report draft (due Fri)', 'Etica ch. 4'] })
    expect(p.blocks.map((b: any) => [b.start, b.title])).toEqual([['09:00', 'Lab report draft (due Fri)'], ['10:00', 'Etica ch. 4']])
    expect(p.mustdos).toEqual(['Read ch. 4', 'Lab report'])
    expect(p.headline).toBe('2 must-dos · 1h40 focus')
  })
  it('ignores made-up must-dos and junk', () => {
    expect(nameAndRank(rules, { mustdos: ['Buy a boat'], names: [42] }).mustdos).toEqual(['Lab report', 'Read ch. 4'])
    expect(nameAndRank(rules, null)).toBe(rules)
  })
})

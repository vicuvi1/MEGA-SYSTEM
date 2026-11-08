import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayState, DOSE_OF, readinessParts, verdictOf, VERDICT_TITLE } from './readinessDay'
import { trainReadiness } from './trainReadiness'
import { readiness } from './readiness'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-06T08:30:00'))
})
afterEach(() => vi.useRealTimers())

describe('readiness score and verdict', () => {
  it('a good night, fresh and an easy yesterday: 100, go full', () => {
    const r = trainReadiness({ sleptMin: 470, soreness: 1, ydaySets: 6 })
    expect(r.score).toBe(100)
    expect(verdictOf(r.score)).toBe('go')
    expect(VERDICT_TITLE.go).toBe('Ready: go full')
    expect(DOSE_OF.go).toBe('full')
  })

  it('sleep counts against your own need, not a fixed 8 h', () => {
    // 6.8 h is 1.2 h under an 8 h need (a small minus), but fine for a 7 h need.
    expect(readiness({ sleptMin: 408, soreness: null, needMin: 480 }).score).toBe(90)
    expect(readiness({ sleptMin: 408, soreness: null, needMin: 420 }).score).toBe(100)
    // 6 h with a 9 h need is 3 h short: the biggest minus.
    expect(readiness({ sleptMin: 360, soreness: null, needMin: 540 }).score).toBe(60)
    // No need given: the same steps as before (8 h).
    expect(readiness({ sleptMin: 320, soreness: null }).score).toBe(60)
  })

  it('a short night and sore: go lighter (70%)', () => {
    const r = trainReadiness({ sleptMin: 380, soreness: 3, ydaySets: 0, needMin: 480 })
    expect(r.score).toBe(75)
    expect(verdictOf(r.score)).toBe('lighter')
    expect(VERDICT_TITLE.lighter).toBe('Go lighter (70%)')
    expect(DOSE_OF.lighter).toBe('light')
  })

  it('very sore after a big day: rest or mobility (Short 50% if you train anyway)', () => {
    const r = trainReadiness({ sleptMin: 450, soreness: 5, ydaySets: 26 })
    expect(r.score).toBeLessThan(50)
    expect(verdictOf(r.score)).toBe('rest')
    expect(VERDICT_TITLE.rest).toBe('Rest or mobility')
    expect(DOSE_OF.rest).toBe('short')
    expect(r.mode).toBe('short')
  })

  it('the verdict uses the same steps as the dose (80 / 50) and clamps odd numbers', () => {
    expect(verdictOf(80)).toBe('go')
    expect(verdictOf(79)).toBe('lighter')
    expect(verdictOf(50)).toBe('lighter')
    expect(verdictOf(49)).toBe('rest')
    expect(verdictOf(-10)).toBe('rest')
    expect(verdictOf(500)).toBe('go')
    expect(verdictOf(Number.NaN)).toBe('rest')
  })

  it('your pick wins for the dose; the verdict still says what the numbers say', () => {
    const r = trainReadiness({ sleptMin: 300, soreness: 4, override: 'full' })
    expect(r.mode).toBe('full')
    expect(verdictOf(r.score)).toBe('rest')
  })

  it('the parts in plain words: sleep against the need, soreness, yesterday', () => {
    const p = readinessParts({ sleptMin: 390, needMin: 480, soreness: 2, ydaySets: 18 })
    expect(p.map((x) => x.value)).toEqual(['6.5 of 8 h', 'fresh', '18 hard sets'])
    expect(p.map((x) => x.tone)).toEqual(['ok', 'good', 'ok'])
    const none = readinessParts({ sleptMin: null, soreness: null, ydaySets: 0 })
    expect(none.map((x) => x.value)).toEqual(['not logged', 'tap 1–5', 'no hard sets'])
  })
})

describe('smart rest day', () => {
  it('never says rest after a workout logged today (unless you tapped it)', () => {
    for (const verdict of ['go', 'lighter', 'rest'] as const) {
      for (const plannedRest of [false, true]) {
        const d = dayState({ trainedToday: true, restTapped: false, plannedRest, verdict })
        expect(d.kind).toBe('done')
        expect(d.title).not.toMatch(/rest/i)
        expect(d.line).toMatch(/You trained today/)
      }
    }
  })

  it('a tapped rest day wins, and then it never says "you trained today"', () => {
    const d = dayState({ trainedToday: true, restTapped: true, verdict: 'go' })
    expect(d).toMatchObject({ kind: 'rest', reason: 'tapped', title: 'Rest day' })
    expect(d.line).not.toMatch(/trained today/i)
  })

  it('rest only when the plan or the score says so', () => {
    expect(dayState({ trainedToday: false, restTapped: false, plannedRest: true, verdict: 'go' })).toMatchObject({ kind: 'rest', reason: 'plan' })
    expect(dayState({ trainedToday: false, restTapped: false, verdict: 'rest' })).toMatchObject({ kind: 'rest', reason: 'readiness' })
    expect(dayState({ trainedToday: false, restTapped: false, verdict: 'lighter' })).toMatchObject({ kind: 'train', reason: null })
    expect(dayState({ trainedToday: false, restTapped: false, verdict: 'go' }).title).toBe("Today's workout")
  })
})

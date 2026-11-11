import { describe, expect, it } from 'vitest'
import { kpisFor, moveBest, pathProgress, pathViews, personalRecords, repsText, strengthChart, stepsUnlocked, weightRange } from './trainProgress'
import { trainOf } from './trainLog'

// Made-up data. 2026-11-10 is a Tuesday.
const TODAY = '2026-11-10'
const ex = (ladder: string, move: string, reps: number[], feel?: string) => ({ ladder, move, exId: `x-${move}`, sets: reps.map((r) => ({ reps: r, ...(feel ? { feel } : {}) })) })
const sess = (date: string, exercises: any[]) => ({ id: `s-${date}`, date, type: 'upper', exercises, startedAt: 0, durationSec: 0, done: true })

function state(): any {
  return {
    exercises: [{ id: 'ex_d', name: 'Diamond push-ups', target: 24, unit: 'reps', move: 'diamond_pushup' }],
    sets: {
      '2026-10-27': { ex_d: [8, 8, 8].map((r, i) => ({ reps: r, at: 1000 + i, id: `a${i}`, feel: 'ok', form: 'good' })) },
      '2026-11-05': { ex_d: [12, 12, 12].map((r, i) => ({ reps: r, at: 2000 + i, id: `b${i}`, feel: 'ok', form: 'good' })) }
    },
    trainLevels: { push: { level: 2, reached: { 1: '2026-09-01', 2: '2026-10-20' }, at: 1 }, pull: { level: 0, reached: {}, at: 1 } },
    trainLog: [
      sess('2026-10-14', [ex('push', 'pushup', [10, 10, 10], 'ok'), ex('pull', 'table_row', [8, 8, 8], 'hard')]),
      sess('2026-10-27', [ex('push', 'diamond_pushup', [8, 8, 8], 'ok')]),
      sess('2026-11-05', [ex('push', 'diamond_pushup', [12, 12, 12], 'ok'), ex('pull', 'table_row', [12, 11, 10], 'ok')])
    ]
  }
}

describe('path progress', () => {
  it('fills mastered steps, part-fills your step from its real unlock progress, names the next one', () => {
    const rows = pathProgress(state(), TODAY)
    const push = rows.find((r) => r.ladder === 'push')!
    expect(push.step).toBe(3)
    expect(push.moveName).toBe('Diamond push-ups')
    expect(push.segs.map((s) => s.state).slice(0, 4)).toEqual(['done', 'done', 'current', 'later'])
    expect(push.segs[0].fill).toBe(1)
    expect(push.segs[2].fill).toBe(push.pct / 100)
    expect(push.pct).toBeGreaterThan(0)
    expect(push.pct).toBeLessThan(100)
    expect(push.next).toBe('Decline push-ups')
    expect(push.checks.map((c) => c.id)).toEqual(['sessions', 'reps', 'effort'])
    expect(push.checks.find((c) => c.id === 'reps')!.detail).toBe('3 × 12')
    expect(rows.map((r) => r.ladder)).toEqual(['push', 'pull', 'shoulders', 'single', 'hinge', 'core'])
  })

  it('a new chain has no progress and says so', () => {
    const row = pathProgress({}, TODAY).find((r) => r.ladder === 'shoulders')!
    expect(row.fresh).toBe(true)
    expect(row.pct).toBe(0)
  })

  it('one-day picks do not change the path', () => {
    const st = { ...state(), trainPicks: { day: TODAY, at: 1, moves: { push: { move: 'pushup', lo: 8, hi: 15, unit: 'reps' } } } }
    expect(pathProgress(st, TODAY).find((r) => r.ladder === 'push')!.move).toBe('diamond_pushup')
  })
})

describe('step cards', () => {
  it('Mastered, You are here, Next with the sessions to go, Locked', () => {
    const push = pathViews(state(), TODAY).find((p) => p.id === 'push')!
    expect(push.cards.slice(0, 5).map((c) => c.state)).toEqual(['done', 'done', 'now', 'next', 'locked'])
    expect(push.cards[3].text).toMatch(/^Next · (\d sessions? to go|unlocked)$/)
    expect(push.cards[0].text).toBe('Mastered')
    expect(push.step).toBe(3)
  })
})

describe('records, KPIs and strength', () => {
  it('best set with its day and the change over the best before', () => {
    const data = trainOf(state())
    const b = moveBest(data, 'diamond_pushup')!
    expect(b.reps).toBe(12)
    expect(b.when).toBe('Thu')
    expect(b.sessions).toBe(2)
    expect(moveBest(data, 'plank')).toBeNull()
    const recs = personalRecords(state())
    const d = recs.find((r) => r.move === 'diamond_pushup')!
    expect(d.change).toBe('+4')
    expect(recs.find((r) => r.move === 'pushup')!.change).toBe('new')
  })

  it('workouts and hard sets against the period before; steps unlocked skip the placement', () => {
    const k = kpisFor(state(), TODAY, 28)
    expect(k.workouts).toBe(3)
    expect(k.workoutsBefore).toBe(0)
    expect(k.hardSets).toBe(15)
    expect(k.unlocked.map((u) => u.name)).toEqual(['Diamond push-ups'])
    expect(stepsUnlocked(state(), '2026-11-01', TODAY)).toEqual([])
  })

  it('weight change needs two weigh-ins a week apart', () => {
    const pts = [
      { day: '2026-10-15', weight: 73.6 },
      { day: '2026-11-08', weight: 74.0 }
    ]
    expect(weightRange(pts, '2026-10-14', TODAY)).toEqual({ from: 73.6, to: 74, change: 0.4 })
    expect(weightRange(pts.slice(0, 1), '2026-10-14', TODAY)).toBeNull()
  })

  it('strength over time: the best set per week, a step up counts more, the step-up is marked', () => {
    const c = strengthChart(state(), TODAY, 'push', '4w')
    expect(c.buckets).toHaveLength(4)
    expect(c.hasData).toBe(true)
    expect(c.buckets[3].score).toBeGreaterThan(c.buckets[2].score ?? 0)
    expect(c.ups).toEqual([{ bucket: 0, name: 'Diamond push-ups', day: '2026-10-20' }])
    expect(strengthChart(state(), TODAY, 'push', 'week').buckets).toHaveLength(7)
    expect(strengthChart({}, TODAY, 'push', '12w').hasData).toBe(false)
  })

  it('texts', () => {
    expect(repsText(1, 'reps')).toBe('1 rep')
    expect(repsText(100, 'sec')).toBe('1:40')
    expect(repsText(45, 'sec')).toBe('45 s')
  })
})

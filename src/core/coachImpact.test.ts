import { describe, expect, it } from 'vitest'
import { bump, impactVerdict, recordDay, scorecard, type CoachHistory } from './coachImpact'

describe('is the coach working?', () => {
  it('keeps an approved plan approved and counts promises', () => {
    let h: CoachHistory = { days: {} }
    h = recordDay(h, '2026-11-02', { plan: 'approved' })
    h = recordDay(h, '2026-11-02', { plan: 'proposed' })
    h = bump(bump(h, '2026-11-02', 'kept'), '2026-11-02', 'kept')
    expect(h.days['2026-11-02']).toEqual({ plan: 'approved', kept: 2 })
  })

  it('builds weekly rows and an honest verdict', () => {
    let h: CoachHistory = { days: {} }
    // Two weeks before: weak. Last two weeks: better.
    for (const [d, kept, broken, score] of [['2026-10-06', 1, 3, 40], ['2026-10-14', 1, 2, 45], ['2026-10-21', 3, 1, 70], ['2026-10-29', 4, 0, 80]] as const) {
      h = recordDay(h, d, { plan: 'approved', score, mustdos: [2, 3] })
      h = bump(h, d, 'kept', kept)
      h = bump(h, d, 'broken', broken)
    }
    const focus = [{ day: '2026-10-07', minutes: 120 }, { day: '2026-10-22', minutes: 300 }, { day: '2026-10-30', minutes: 300 }]
    const rows = scorecard(h, focus, '2026-11-01', 4)
    expect(rows.map((r) => r.week)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(rows[3]).toMatchObject({ kept: 4, broken: 0, keptPct: 100, plansApproved: 1, avgScore: 80, focusMin: 300 })
    const v = impactVerdict(rows)
    expect(v.verdict).toBe('working')
    expect(v.lines[0]).toContain('Promises kept: 88% (was 29%) ↑')
    expect(impactVerdict(scorecard({ days: {} }, [], '2026-11-01', 4)).verdict).toBe('too early')
  })
})

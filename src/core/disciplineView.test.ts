import { describe, expect, it } from 'vitest'
import { badgesOf, bestRun, breathAt, friendlyDate, heatmap, nextBadge, rankLadder, rankProgress, shortDate, streakRuns, urgesPerWeek, type Mark } from './disciplineView'

describe('discipline page view', () => {
  it('badges: held now, earned by your best, the next one, and locked', () => {
    const b = badgesOf(4, 12)
    const by = (d: number) => b.find((x) => x.days === d)!
    expect(b.map((x) => x.days)).toEqual([1, 3, 7, 14, 30, 60, 90, 180, 365])
    expect(by(1).state).toBe('now')
    expect(by(3).state).toBe('now')
    expect(by(7).state).toBe('next')
    expect(by(7).left).toBe(3)
    expect(by(14).state).toBe('locked')
    expect(badgesOf(2, 10).find((x) => x.days === 7)!.state).toBe('earned') // reached before, not now
    expect(badgesOf(0, 0).find((x) => x.days === 1)!.state).toBe('next')
  })

  it('next badge progress', () => {
    expect(nextBadge(4)).toMatchObject({ days: 7, from: 3 })
    expect(nextBadge(4)!.pct).toBeCloseTo(0.25)
    expect(nextBadge(0)).toMatchObject({ days: 1, pct: 0 })
    expect(nextBadge(400)).toBeNull()
  })

  it('rank ladder and progress to the next rank', () => {
    const l = rankLadder(4)
    expect(l[0].state).toBe('done')
    expect(l[1]).toMatchObject({ name: 'Squire', state: 'current', tier: 2 })
    expect(l[2].state).toBe('locked')
    const p = rankProgress(4)
    expect(p).toMatchObject({ name: 'Squire', next: { name: 'Warrior', days: 7 }, left: 3 })
    expect(p.pct).toBeCloseTo(0.25)
    expect(rankProgress(200)).toMatchObject({ name: 'Legend', next: null, pct: 1, left: 0 })
    expect(rankProgress(0)).toMatchObject({ name: 'Initiate', left: 3, pct: 0 })
  })

  it('heatmap: Monday columns ending this week, with the honest states', () => {
    const today = '2026-11-06' // a Friday
    const marks: Mark[] = [
      { day: '2026-11-01', kind: 'reset', hour: 22 },
      { day: '2026-11-03', kind: 'checkin', hour: 21 },
      { day: '2026-11-04', kind: 'urge', hour: 23 },
      { day: '2026-11-04', kind: 'urge', hour: 1 }
    ]
    const h = heatmap(marks, today, '2026-10-20', 26)
    expect(h.columns).toHaveLength(26)
    const last = h.columns[25]
    expect(last[0].day).toBe('2026-11-02') // Monday
    expect(last[1].state).toBe('clean')
    expect(last[2]).toMatchObject({ state: 'open', urges: 2 })
    expect(last[4].state).toBe('open') // today, not checked in yet
    expect(last[5].state).toBe('future')
    expect(h.columns[24][6]).toMatchObject({ day: '2026-11-01', state: 'reset' })
    expect(h.columns[0][0].state).toBe('before')
    expect(h.months.slice(0, 2)).toEqual([{ col: 0, label: 'May' }, { col: 3, label: 'Jun' }])
    expect(h.months.some((m) => m.label === 'Nov')).toBe(true)
    expect(heatmap([], today, null, 4).columns.flat().every((c) => c.state === 'before' || c.state === 'future')).toBe(true)
  })

  it('urges per week, ending with this week', () => {
    const w = urgesPerWeek(
      [
        { day: '2026-11-04', kind: 'urge', hour: 22 },
        { day: '2026-11-02', kind: 'urge', hour: 22 },
        { day: '2026-10-28', kind: 'urge', hour: 22 },
        { day: '2026-10-28', kind: 'checkin', hour: 22 }
      ],
      '2026-11-06',
      4
    )
    expect(w.map((x) => x.count)).toEqual([0, 0, 1, 2])
    expect(w[3]).toMatchObject({ from: '2026-11-02', label: 'This week' })
    expect(w[2].label).toBe('26 Oct')
  })

  it('streak runs split at resets; the record is the longest', () => {
    const runs = streakRuns('2026-09-01', ['2026-10-01', '2026-11-02', '2025-01-01'], '2026-11-06')
    expect(runs).toEqual([
      { from: '2026-09-01', to: '2026-10-01', days: 30, ended: 'reset' },
      { from: '2026-10-01', to: '2026-11-02', days: 32, ended: 'reset' },
      { from: '2026-11-02', to: '2026-11-06', days: 4, ended: 'now' }
    ])
    expect(bestRun(runs)?.days).toBe(32)
    expect(streakRuns(null, [], '2026-11-06')).toEqual([])
    expect(bestRun([])).toBeNull()
  })

  it('friendly dates', () => {
    expect(friendlyDate('2026-11-02', '2026-11-06')).toBe('Monday, 2 November')
    expect(friendlyDate('2026-11-06', '2026-11-06')).toBe('today')
    expect(friendlyDate('2026-11-05', '2026-11-06')).toBe('yesterday')
    expect(friendlyDate('2025-12-30', '2026-11-06')).toBe('Tuesday, 30 December 2025')
    expect(shortDate('2026-03-09')).toBe('9 Mar')
    expect(shortDate('2025-03-09', '2026-01-01')).toBe('9 Mar 2025')
  })

  it('breathing: box and 4-7-8 steps, and how full the circle is', () => {
    expect(breathAt('box', 0)).toMatchObject({ label: 'Breathe in', secondsLeft: 4, fill: 0 })
    expect(breathAt('box', 2000).fill).toBeCloseTo(0.5)
    expect(breathAt('box', 5000)).toMatchObject({ label: 'Hold', fill: 1, step: 1 })
    expect(breathAt('box', 10000)).toMatchObject({ label: 'Breathe out', step: 2 })
    expect(breathAt('box', 13000)).toMatchObject({ label: 'Hold', fill: 0, step: 3 })
    expect(breathAt('box', 16000).step).toBe(0) // a new cycle
    expect(breathAt('478', 4000)).toMatchObject({ label: 'Hold', secondsLeft: 7, fill: 1 })
    expect(breathAt('478', 11000)).toMatchObject({ label: 'Breathe out', secondsLeft: 8, fill: 1 })
    expect(breathAt('478', 19000).step).toBe(0)
  })
})

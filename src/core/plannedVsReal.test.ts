import { describe, expect, it } from 'vitest'
import { pcWorkMinutes, weekTime } from './plannedVsReal'

describe('planned vs real time (FT10)', () => {
  it('reads the PC work total from the day line', () => {
    expect(pcWorkMinutes('VS Code 3h10, YouTube 35m · work 4h20, distracting 1h')).toBe(260)
    expect(pcWorkMinutes('Docs 40m · work 45m, distracting 0m')).toBe(45)
    expect(pcWorkMinutes('work 3h, distracting 1h')).toBe(180)
    expect(pcWorkMinutes('nothing')).toBeNull()
  })
  it('puts planned blocks next to real focus per subject, inside the week only', () => {
    const w = weekTime({
      from: '2026-11-02',
      to: '2026-11-08',
      blocks: [
        { day: '2026-11-02', subject: 'Math', minutes: 90 },
        { day: '2026-11-03', subject: 'math', minutes: 60, mark: 'skip' },
        { day: '2026-11-04', subject: 'Rust', minutes: 50 },
        { day: '2026-10-30', subject: 'Math', minutes: 90 }
      ],
      sessions: [
        { day: '2026-11-02', subject: 'Math', minutes: 45 },
        { day: '2026-11-04', subject: 'Rust', minutes: 55 },
        { day: '2026-11-05', subject: 'CTF', minutes: 30 }
      ],
      pcLines: [{ day: '2026-11-02', line: 'Code 2h · work 2h, distracting 10m' }, { day: '2026-11-03', line: 'x · work 1h30, distracting 0m' }]
    })
    expect(w.rows).toEqual([
      { subject: 'Math', plannedMin: 150, realMin: 45, skipped: 1 },
      { subject: 'Rust', plannedMin: 50, realMin: 55, skipped: 0 },
      { subject: 'CTF', plannedMin: 0, realMin: 30, skipped: 0 }
    ])
    expect(w).toMatchObject({ plannedMin: 200, realMin: 130, pcWorkMin: 210 })
    expect(w.line).toMatch(/3h20 planned, 2h10 done \(65%\), PC work 3h30.*Biggest gap: Math/)
  })
  it('says nothing for an empty week', () => {
    expect(weekTime({ from: '2026-11-02', to: '2026-11-08', blocks: [], sessions: [] })).toMatchObject({ rows: [], pcWorkMin: null, line: '' })
  })
})

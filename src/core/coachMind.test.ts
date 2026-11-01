import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { applyMind, EMPTY_MIND, findPatterns, focusBySubject, mindText, readMindOp, sleepDiary, weekAhead } from './coachMind'

const today = '2026-11-01'

describe('coach mind', () => {
  it('reads memory actions', () => {
    expect(readMindOp('aim: Pass the algebra exam | 2026-12-15 | 6h focus')).toEqual({ kind: 'aim', title: 'Pass the algebra exam', deadline: '2026-12-15', weekly: '6h focus' })
    expect(readMindOp('aim: Run 5 km | - | 3 runs')).toEqual({ kind: 'aim', title: 'Run 5 km', deadline: '', weekly: '3 runs' })
    expect(readMindOp('works: 25 min blocks in the morning')).toEqual({ kind: 'works', text: '25 min blocks in the morning' })
    expect(readMindOp('pattern: skips study after late nights')).toEqual({ kind: 'pattern', text: 'skips study after late nights' })
    expect(readMindOp('aim:  ')).toBeNull()
    expect(readMindOp('log: 30 pushups')).toBeNull()
  })

  it('keeps the newest version of an idea and moves works/fails across', () => {
    let m = applyMind(EMPTY_MIND, { kind: 'aim', title: 'Pass the algebra exam', deadline: '2026-12-15', weekly: '6h focus' }, today).mind
    m = applyMind(m, { kind: 'aim', title: 'pass the algebra exam', deadline: '2026-12-15', weekly: '8h focus' }, today).mind
    expect(m.goals).toHaveLength(1)
    expect(m.goals[0].weekly).toBe('8h focus')
    m = applyMind(m, { kind: 'fails', text: 'studying after 22:00' }, today).mind
    m = applyMind(m, { kind: 'works', text: 'studying after 22:00' }, today).mind
    expect(m.fails).toHaveLength(0)
    expect(m.works.map((x) => x.t)).toEqual(['studying after 22:00'])
    const closed = applyMind(m, { kind: 'aimdone', title: 'algebra exam' }, today)
    expect(closed.mind.goals).toHaveLength(0)
    expect(closed.line).toContain('pass the algebra exam')
    expect(applyMind(m, { kind: 'aimdone', title: 'nothing like it' }, today).line).toBe('')
  })

  it('writes the mind for the prompt with days left', () => {
    const m = applyMind(EMPTY_MIND, { kind: 'aim', title: 'Lab portfolio', deadline: '2026-11-08', weekly: '' }, today).mind
    expect(mindText(m, today)).toContain('Lab portfolio · due 2026-11-08 (7 days left)')
    expect(mindText(EMPTY_MIND, today)).toBe('')
  })

  it('finds that late nights cost focus, and stays quiet without enough data', () => {
    const focus: { day: string; minutes: number }[] = []
    const sleep: { day: string; onTime: boolean; bedOnTime: boolean | null; quality: number | null }[] = []
    for (let i = 1; i <= 28; i++) {
      const day = addDays(today, -i)
      const late = i % 4 === 0
      sleep.push({ day, onTime: true, bedOnTime: !late, quality: null })
      focus.push({ day, minutes: late ? 20 : 80 })
    }
    const p = findPatterns({ today, focus, sleep, workouts: [], spending: null })
    expect(p.some((x) => x.startsWith('After a late night: 20 min focus'))).toBe(true)
    expect(findPatterns({ today, focus: focus.slice(0, 3), sleep: sleep.slice(0, 3), workouts: [], spending: null })).toEqual([])
  })

  it('spots weekend spending', () => {
    const spending: { day: string; bani: number }[] = []
    for (let i = 1; i <= 28; i++) {
      const day = addDays(today, -i)
      const w = new Date(`${day}T12:00:00Z`).getUTCDay()
      spending.push({ day, bani: w === 0 || w === 6 ? 40000 : 10000 })
    }
    const p = findPatterns({ today, focus: [], sleep: [], workouts: [], spending })
    expect(p).toEqual(['Spending: 400 lei/day on weekends vs 100 lei/day on weekdays.'])
  })

  it('writes a sleep diary, the week ahead and focus by subject', () => {
    expect(sleepDiary([{ day: '2026-10-31', wakeTime: '07:20', onTime: false, bedTime: '00:40', bedOnTime: false, quality: 3 }], today)).toContain('10-31 bed 00:40 (late) → up 07:20 (late) · 3/5')
    expect(sleepDiary([], today)).toContain('nothing logged')
    const ev = [{ title: 'Lab', start: '2026-11-02T10:00:00', end: '2026-11-02T11:30:00' }]
    const w = weekAhead(ev, today, 2)
    expect(w).toContain('Mon 11-02: 1 blocks, 1.5h busy')
    expect(w).toContain('Tue 11-03: free')
    expect(focusBySubject([{ day: '2026-10-30', subject: 'Math', minutes: 90 }, { day: '2026-10-31', subject: 'Rust', minutes: 30 }, { day: '2026-09-01', subject: 'Old', minutes: 500 }], '2026-10-26')).toBe('Math 1h 30m, Rust 30m')
  })
})

describe('goal progress', () => {
  it('measures weekly targets', async () => {
    const { goalProgress, weekSoFar } = await import('./coachMind')
    const w = weekSoFar('2026-11-04', [{ day: '2026-11-02', minutes: 120 }, { day: '2026-11-04', minutes: 80 }, { day: '2026-11-01', minutes: 500 }], [{ day: '2026-11-03' }], [{ day: '2026-11-02' }, { day: '2026-11-03' }])
    expect(w).toEqual({ focusMin: 200, workouts: 1, tasks: 2, daysLeft: 5 })
    expect(goalProgress('6h focus', w)).toBe('this week 3.3h of 6h (56%), 32 min/day needed for 5 days')
    expect(goalProgress('3 workouts', w)).toBe('this week 1 of 3 workouts')
    expect(goalProgress('save 2000 lei', w)).toBeNull()
  })
})

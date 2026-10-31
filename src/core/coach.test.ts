import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { coachFacts, coachPrompt, coachText, worthSaying } from './coach'
import { progressReport, type ProgressInput } from './progress'

const today = '2026-10-31'
const base: ProgressInput = { today, focus: [], wakes: [], workouts: [], discipline: [], todoist: [], spending: null, mustdos: [] }

describe('coach', () => {
  it('speaks up when you slip, with one step', () => {
    const i: ProgressInput = {
      ...base,
      focus: [{ day: addDays(today, -3), minutes: 50 }],
      wakes: [0, 1, 2, 3].map((k) => ({ day: addDays(today, -k), onTime: false })),
      workouts: [{ day: addDays(today, -6) }]
    }
    const facts = coachFacts(i, progressReport(i))
    expect(facts.map((f) => f.id)).toEqual(['no-focus', 'late-wake', 'no-sport', 'no-plan'])
    expect(facts[0].text).toBe('No focus session for 3 days.')
    expect(worthSaying(facts)).toBe(true)
    const text = coachText(facts)
    expect(text).toContain('• No focus session for 3 days.')
    expect(text).toContain('👉 Do one 25-minute focus block')
    expect(coachPrompt(facts, progressReport(i), { mustdos: [], todoistToday: 4, when: 'morning' })).toContain('Todoist tasks due today or late: 4')
  })

  it('stays quiet on a good day', () => {
    const i: ProgressInput = {
      ...base,
      focus: [{ day: today, minutes: 60 }],
      workouts: [{ day: today }],
      mustdos: [1, 2, 3].map((k) => ({ day: addDays(today, -k), done: true })),
      discipline: [{ kind: 'start', day: addDays(today, -20) }]
    }
    const facts = coachFacts(i, progressReport(i))
    expect(worthSaying(facts)).toBe(false)
    expect(facts.map((f) => f.id)).toContain('good-streak')
  })
})

describe('wind-down', () => {
  it('only when wake-ups slip, with bedtime, wake time and the first thing', async () => {
    const { wakeSlipping, windDownText } = await import('./coach')
    const w = (k: number, onTime: boolean) => ({ day: addDays(today, -k), onTime })
    expect(wakeSlipping([w(0, true), w(1, false), w(2, true)], today)).toBeNull()
    const s = wakeSlipping([w(0, false), w(1, false), w(2, true), w(3, true)], today)
    expect(s).toEqual({ late: 2, of: 4 })
    const t = windDownText({ bedTarget: '23:00', wakeTarget: '07:00', late: 2, of: 4, first: 'Finish etica <now>' })
    expect(t).toContain('bedtime 23:00')
    expect(t).toContain('up at <b>07:00</b>')
    expect(t).toContain('Finish etica &lt;now&gt;')
  })
})

describe('deadline radar', () => {
  it('warns 1–3 days ahead about important tasks only', async () => {
    const { deadlineRadar } = await import('./todoist')
    const { deadlineFacts } = await import('./coach')
    const t = (id: string, content: string, due: string | null, extra: object = {}) => ({ id, content, priority: 1, due, dueTime: null, project: null, recurring: false, ...extra })
    const r = deadlineRadar(
      [
        t('1', 'Lab 3 report', '2026-11-01'),
        t('2', 'buy milk', '2026-11-01'),
        t('3', 'Etica course', '2026-11-03', { section: '🎓 University' }),
        t('4', 'sport', '2026-11-01', { recurring: true }),
        t('5', 'Pay rent', null, { deadline: '2026-11-02' }),
        t('6', 'Exam', '2026-11-10'),
        t('7', 'Today thing exam', today)
      ],
      today
    )
    expect(r.map((x) => x.task.id)).toEqual(['1', '5', '3'])
    const f = deadlineFacts(r)
    expect(f[0].text).toBe('“Lab 3 report” is due tomorrow (Sun).')
    expect(f[1].text).toBe('“Pay rent” is due in 2 days (Mon).')
  })
})

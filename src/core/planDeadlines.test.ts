import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { packDay } from './dayPacker'
import { blockWhy } from './planAudit'
import { dedupePlan } from './planDedupe'
import { dayLabel, planDeadlines, sessionsOn, type DayRoom, type DeadlineGoal } from './planDeadlines'

// Made-up data only. 2030-03-11 is a Monday; nothing reads the clock.
const today = '2030-03-11'
const rooms = (n: number, minutes = 120, weight = 2): DayRoom[] => Array.from({ length: n }, (_, i) => ({ day: addDays(today, i), minutes, weight }))
const etica: DeadlineGoal = { id: 7, title: 'Etica exam', subject: 'Etica', deadline: '2030-03-16', leftMin: 8 * 60 }

describe('deadlines planned backward', () => {
  it('cuts the hours into sessions over the days before the deadline, never on or after it', () => {
    const [p] = planDeadlines([etica], rooms(10), today)
    expect(p.sessions.reduce((t, s) => t + s.minutes, 0)).toBe(450)
    // 5 study days (Mon–Fri), at most 90 min a session, one session a day.
    expect(p.sessions.map((s) => s.day)).toEqual(['2030-03-11', '2030-03-12', '2030-03-13', '2030-03-14', '2030-03-15'])
    for (const s of p.sessions) expect(s.minutes).toBeLessThanOrEqual(90)
    // 8h don't fit in 5 × 90 min: said plainly, with the day.
    expect(p.shortMin).toBe(30)
    expect(p.line).toBe('Etica exam: not enough room before Saturday 16 Mar: 30 min short.')
    expect(p.sessions[1]).toMatchObject({ title: 'Etica: Etica exam', n: 2, of: 5, why: 'exam in 4 days, session 2 of 5', id: 'dl-7-20300312' })
  })

  it('spreads from the deadline back instead of cramming the last days', () => {
    const [p] = planDeadlines([{ ...etica, deadline: '2030-03-21', leftMin: 3 * 60 }], rooms(12), today)
    expect(p.sessions.length).toBe(2)
    // The last session is the day before the deadline; the other one is well before it.
    expect(p.sessions[1].day).toBe('2030-03-20')
    expect(p.sessions[0].day < '2030-03-16').toBe(true)
    expect(p.line).toBeNull()
  })

  it('heavy days of the week plan get the sessions first', () => {
    const r = rooms(10).map((x) => (x.day === '2030-03-13' ? { ...x, weight: 3 } : x))
    const [p] = planDeadlines([{ ...etica, deadline: '2030-03-16', leftMin: 90 }], r, today)
    expect(p.sessions.map((s) => s.day)).toEqual(['2030-03-13'])
  })

  it('an impossible deadline is reported, not squeezed past the limits', () => {
    // Limits leave only 30 min a day.
    const [p] = planDeadlines([etica], rooms(10, 30), today)
    for (const s of p.sessions) expect(s.minutes).toBeLessThanOrEqual(30)
    expect(p.shortMin).toBe(480 - 150)
    expect(p.line).toMatch(/not enough room before Saturday 16 Mar: 5h30 short/)
    // Behind a steady pace too: said in the same line.
    expect(planDeadlines([{ ...etica, behindH: 2.4 }], rooms(10, 30), today)[0].line).toMatch(/You are behind by 2h\.$/)
  })

  it('earlier deadlines take the room first', () => {
    const lab = { id: 'lab', title: 'Lab report', subject: 'Networks', deadline: '2030-03-13', leftMin: 120 }
    const [a, b] = planDeadlines([etica, lab], rooms(10, 60), today)
    expect(a.title).toBe('Lab report')
    expect(a.shortMin).toBe(0)
    // Monday and Tuesday are full with the lab report, so Etica starts Wednesday.
    expect(b.sessions[0].day).toBe('2030-03-13')
  })

  it('a missed session is re-booked: the hours left spread over the days left (same ids, no duplicates)', () => {
    const first = planDeadlines([{ ...etica, leftMin: 300 }], rooms(10), today)[0]
    // Monday's session was missed: on Tuesday the same 5h are planned over the 4 days left.
    const tue = addDays(today, 1)
    const again = planDeadlines([{ ...etica, leftMin: 300 }], rooms(9).map((r, i) => ({ ...r, day: addDays(tue, i) })), tue)[0]
    expect(again.sessions.reduce((t, s) => t + s.minutes, 0)).toBe(300)
    expect(again.sessions.every((s) => s.day >= tue)).toBe(true)
    expect(new Set(again.sessions.map((s) => s.id)).size).toBe(again.sessions.length)
    // Planning twice gives the same sessions.
    expect(planDeadlines([{ ...etica, leftMin: 300 }], rooms(10), today)).toEqual([first])
  })

  it('today\'s session is a normal block with its why line, and re-planning never duplicates it', () => {
    const [p] = planDeadlines([etica], rooms(10), today)
    const s = sessionsOn([p], today)
    const plan = packDay({ today, now: '08:00', events: [], tasks: [], top3: [], waterTarget: 2500, workoutDone: true, goals: s.map((x) => ({ title: x.title, minutes: x.minutes, id: x.id, why: x.why })) })
    const block = plan.blocks.find((b) => b.id === s[0].id)!
    expect(block.title).toBe('Etica: Etica exam')
    expect(blockWhy(block, plan)).toBe('exam in 5 days, session 1 of 5')
    // The same session from last night's draft and a new plan: one block.
    const twice = dedupePlan({ ...plan, blocks: [...plan.blocks, { ...block, start: '15:00' }] })
    expect(twice.blocks.filter((b) => b.title === 'Etica: Etica exam').length).toBe(1)
  })

  it('names the day plainly', () => {
    expect(dayLabel('2030-03-15')).toBe('Friday 15 Mar')
  })
})

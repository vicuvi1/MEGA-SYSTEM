import { describe, expect, it } from 'vitest'
import { auditPlan } from './planAudit'
import { autoReplan } from './planAuto'
import { ensureIds } from './planEdit'
import type { CalEvent } from './dayTime'
import type { DayProposal } from './rhythm'

// A crowded made-up day, like the smoke fixture: classes, a work window full of calls, 08:30 now.
const day = '2030-03-12'
const ev = (id: string, title: string, s: string, e: string): CalEvent => ({ id, calendarId: 'c', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false })
const events = [
  ev('e1', 'Deep block 1', '07:00', '09:00'),
  ev('e2', 'Lecture: Algorithms', '09:45', '11:15'),
  ev('e3', 'Lab: Programming', '13:30', '15:00'),
  ev('e4', 'Stand-up prep', '16:45', '17:00'),
  ev('e5', 'Team stand-up', '17:00', '17:15'),
  ev('e6', 'Sport (20 min)', '17:15', '17:35'),
  ev('e7', 'Calls + work window', '18:05', '22:00'),
  ev('e8', 'Client call', '18:30', '19:15'),
  ev('e9', 'Downstream review', '19:00', '20:00'),
  ev('e10', 'Interview prep', '20:00', '21:00'),
  ev('e11', 'AI study', '22:00', '22:40')
]
const plan = (): DayProposal =>
  ensureIds({
    day,
    headline: '',
    mustdos: ['Ship the settings screen', 'Revise algebra chapter 4', 'Gym: legs'],
    blocks: [
      { title: 'App dev', start: '07:30', minutes: 100, kind: 'focus', tasks: ['Ship the settings screen'] },
      { title: 'Draft the networking lab report', start: '09:20', minutes: 60, kind: 'focus', tasks: ['Draft the networking lab report'] },
      { title: 'Study algebra', start: '10:30', minutes: 90, kind: 'focus', tasks: ['Revise algebra chapter 4', 'Read chapter 4'] },
      { title: 'Quick tasks (1)', start: '12:10', minutes: 45, kind: 'quick', tasks: ['Pay the internet bill'] },
      { title: 'A CTF challenge', start: '13:05', minutes: 75, kind: 'focus', tasks: ['Try one beginner CTF challenge'] }
    ],
    training: { time: '14:30', what: 'Gym: legs' },
    waterMl: 2700,
    also: [
      { id: 't4', title: 'Draft the networking lab report', minutes: 60, priority: 4, overdue: true, at: '09:20' },
      { id: 't5', title: 'Update the CV projects section', minutes: 30, priority: 3 },
      { id: 't1', title: 'Pay the internet bill', minutes: 15, priority: 1, at: '12:10' }
    ]
  })
const ctx = { now: '08:30', bedtime: '23:30', events, endBy: '22:45' }
const titles = (p: DayProposal) => p.blocks.map((b) => b.title)

describe('a crowded day keeps its work', () => {
  it('the audit keeps the must-dos and the top tasks as blocks', () => {
    const a = auditPlan(plan(), ctx)
    expect(titles(a.plan)).toEqual(expect.arrayContaining(['App dev', 'Study algebra', 'Draft the networking lab report']))
    expect(a.plan.blocks.length).toBeGreaterThanOrEqual(4)
  })

  it('the automatic re-plan keeps the must-dos and the top tasks as blocks', () => {
    const r = autoReplan(plan(), 'proposed', ctx)
    expect(titles(r.plan)).toEqual(expect.arrayContaining(['App dev', 'Study algebra', 'Draft the networking lab report']))
    expect(r.plan.blocks.length).toBeGreaterThanOrEqual(3)
    // And the audit after it takes nothing more off.
    expect(auditPlan(r.plan, { ...ctx, fixPast: false }).plan.blocks.length).toBe(r.plan.blocks.length)
  })

  it('bad case: at 10:00 the late P1 lab report was thrown off while small tasks stayed; now the less important work gives way', () => {
    const r = autoReplan(plan(), 'proposed', { ...ctx, now: '10:00' })
    const t = titles(r.plan)
    // The must-dos and the overdue P1 task keep a block.
    expect(t).toEqual(expect.arrayContaining(['App dev', 'Study algebra', 'Draft the networking lab report']))
    // Never emptied: most of the work is still planned.
    expect(r.plan.blocks.length).toBeGreaterThanOrEqual(3)
    // Whatever gave way is on today's list, not lost.
    for (const x of ['Pay the internet bill', 'Try one beginner CTF challenge']) expect([...t, ...r.plan.blocks.flatMap((b) => b.tasks ?? []), ...(r.plan.also ?? []).map((a) => a.title)]).toContain(x)
    // And it settles: a second look changes nothing.
    expect(autoReplan(r.plan, 'proposed', { ...ctx, now: '10:00' }).note).toBeNull()
  })
})

// Telegram's −30 / +30 go through the plan-edit rules: a pinned block refuses,
// and an approved block moved in the calendar keeps its sync memory in step
// (so the app shows it as sent, with nothing waiting). Made-up plan.
import { describe, expect, it } from 'vitest'
import { planAfterMove, planKeyboard, planMoveCheck, PINNED_WORDS } from './tgPlan'
import { pending, planJobs } from './planSync'
import type { DayProposal } from './rhythm'

const plan = (): DayProposal => ({
  day: '2026-03-10',
  headline: 'Essay first',
  mustdos: ['Essay intro'],
  blocks: [
    { id: 'b1', title: 'Essay intro', start: '10:00', minutes: 60, ok: true, sync: { eventId: 'ev1', calendarId: 'primary', start: '10:00', minutes: 60, title: 'Essay intro' } },
    { id: 'b2', title: 'Lab report', start: '15:00', minutes: 50, locked: true }
  ],
  training: null,
  waterMl: 2500
})

describe('Telegram plan moves follow the plan-edit rules', () => {
  it('a pinned block refuses; a free one moves by its id; off the day refuses', () => {
    expect(planMoveCheck(plan(), 1, 30)).toEqual({ ok: false, why: PINNED_WORDS })
    expect(planMoveCheck(plan(), 0, 30)).toEqual({ ok: true, id: 'b1', to: '10:30' })
    expect(planMoveCheck(plan(), 0, -310)).toEqual({ ok: false, why: "Can't move it there" })
    expect(planMoveCheck(plan(), 5, 30)).toMatchObject({ ok: false })
  })

  it('after the calendar took the move, nothing is left to send (sync stays consistent)', () => {
    const moved = planAfterMove(plan(), 'b1', '10:30', true)
    const b = moved.blocks.find((x) => x.id === 'b1')!
    expect(b.start).toBe('10:30')
    expect(b.sync).toMatchObject({ eventId: 'ev1', start: '10:30', minutes: 60 })
    expect(pending({ ...b })).toBe(false)
    expect(planJobs(moved, { status: 'approved', taskId: () => undefined, nowMin: 8 * 60 }).jobs.filter((j) => j.id === 'b1')).toEqual([])
    // Without the calendar move the edit is waiting to be sent (the app's sync picks it up).
    const draft = planAfterMove(plan(), 'b1', '10:30', false)
    expect(pending(draft.blocks.find((x) => x.id === 'b1')!)).toBe(true)
    // A pinned block never moves, even here.
    expect(planAfterMove(plan(), 'b2', '16:00', true).blocks.find((x) => x.id === 'b2')!.start).toBe('15:00')
  })

  it('the keyboard shows a pin instead of −30 / +30', () => {
    const kb = planKeyboard(plan())
    expect(kb.inline_keyboard[0][0].text).toBe('10:00 −30')
    expect(kb.inline_keyboard[1].map((x) => x.text)).toEqual(['📌 15:00 Lab report', '✓ Done', 'Skip'])
  })
})

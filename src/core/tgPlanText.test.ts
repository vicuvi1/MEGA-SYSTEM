// Telegram parity: the plan message shows what the app card shows, each thing
// once (the owner saw "Also today" repeat blocks in Telegram), with the why
// lines, the reasons, the limits, deadline sessions and yesterday's score;
// and the end-of-day check as one message. Made-up plan, pinned clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alsoShown, readReviewData, reviewData, reviewKeyboard, reviewText, shownBlocks, tgPlanText } from './tgPlanText'
import { dedupePlan } from './planDedupe'
import { ensureIds } from './planEdit'
import { putItem, reviewItem, reviewRows, EMPTY_REVIEW } from './planReview'
import { fitsCallback } from './tgPlan'
import type { DayProposal } from './rhythm'

const DAY = '2026-11-06'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${DAY}T09:00:00`))
})
afterEach(() => vi.useRealTimers())

/** A plan with the duplicates the old Telegram text showed: a task in a block again in "Also today", a second block of the same thing. */
const messy = (): DayProposal => ({
  day: DAY,
  headline: 'Exam week',
  mustdos: ['Lab report', 'Lab report'],
  blocks: [
    { title: 'Lab report', start: '10:00', minutes: 60, kind: 'focus', tasks: ['Lab report'] },
    { title: 'Etica: chapter 4', start: '11:15', minutes: 90, kind: 'goal', why: 'exam in 5 days, session 2 of 4' },
    { title: 'Quick tasks', start: '14:00', minutes: 30, kind: 'quick', tasks: ['Book dentist', 'Reply to Ana'] },
    { title: 'Lab report (45 min)', start: '16:00', minutes: 45, kind: 'focus', tasks: ['Lab report'] }
  ],
  training: null,
  waterMl: 2500,
  also: [
    { id: 't1', title: 'Lab report', minutes: 60, priority: 4 },
    { id: 't2', title: 'Book dentist', minutes: 10, priority: 1 },
    { id: 't3', title: 'Reply to Ana', minutes: 10, priority: 1, at: '14:00' },
    { id: 't4', title: 'Water the plants', minutes: 10, priority: 1, project: 'Home' },
    { id: 't4', title: 'Water the plants', minutes: 10, priority: 1, project: 'Home' },
    { id: 't5', title: 'Weekly review', minutes: 30, priority: 2, event: '17:00', overdue: true }
  ]
})
const count = (s: string, x: string) => s.split(x).length - 1

describe('the Telegram plan text', () => {
  it('has no duplicates and shows the same blocks as the app plan', () => {
    const text = tgPlanText(messy())
    const app = dedupePlan(ensureIds(messy())).blocks.map((b) => `${b.start}`)
    const shown = shownBlocks(messy()).map((i) => messy().blocks[i].start)
    expect(shown).toEqual(app)
    expect(count(text, 'Lab report')).toBe(2) // once as a must-do, once as its block
    expect(text).not.toMatch(/16:00/)
    // "Also today" lists only tasks without a block, each once.
    const also = text.slice(text.indexOf('Also today'))
    expect(also).toMatch(/^Also today \(2\)/)
    expect(also).not.toMatch(/Book dentist|Reply to Ana|Lab report/)
    expect(count(text, 'Water the plants')).toBe(1)
    expect(alsoShown(messy()).map((a) => a.title)).toEqual(['Water the plants', 'Weekly review'])
  })

  it('gives each "Also today" task its reason, as the app does', () => {
    const text = tgPlanText(messy())
    expect(text).toMatch(/· Water the plants · 10 min · no slot yet · Home/)
    expect(text).toMatch(/· Weekly review · 30 min · at the 17:00 event · overdue/)
  })

  it('a short why line under each longer block (deadline sessions say which session); group tasks listed', () => {
    const text = tgPlanText(messy())
    expect(text).toMatch(/11:15–12:45 Etica: chapter 4\n {3}<i>exam in 5 days, session 2 of 4/)
    expect(text).toMatch(/10:00–11:00 Lab report\n {3}<i>.*must-do/)
    expect(text).toMatch(/14:00–14:30 Quick tasks\n {3}· Book dentist\n {3}· Reply to Ana/)
  })

  it("yesterday's plan score, the limits and what moved to tomorrow", () => {
    const yesterday = '2026-11-05'
    const p = { ...messy(), day: yesterday, blocks: [{ id: 'y1', title: 'Essay', start: '09:00', minutes: 60 }] }
    const row = reviewRows(p, { now: '23:00' })[0]
    const review = putItem(EMPTY_REVIEW, yesterday, reviewItem(row, 'done', { at: `${yesterday}T20:00:00Z`, minutes: 60 }), DAY)
    const text = tgPlanText({ ...messy(), deferred: [{ id: 't9', title: 'Tidy notes', why: 'You moved it to tomorrow' }] }, { review, today: DAY, limits: { maxFocusMin: 240, offAt: '18:00', protect: [], caps: [] } })
    expect(text).toMatch(/<i>Yesterday's plan: 100% realistic<\/i>/)
    expect(text).toMatch(/⏱ 3h of work · your limit 4h · off at 18:00/)
    expect(text).toMatch(/<b>Moved to tomorrow<\/b>\n· Tidy notes: You moved it to tomorrow/)
  })
})

describe('the end-of-day check on Telegram', () => {
  it('one message, one row of Done / Partly / Tomorrow / Drop per block, by block id', () => {
    const plan = ensureIds(messy())
    const rows = reviewRows(plan, { now: '15:00' })
    const kb = reviewKeyboard(rows)
    expect(kb.inline_keyboard).toHaveLength(rows.length)
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(['1 ✓ Done', '◐ Partly', '➡️ Tmrw', '✗ Drop'])
    expect(kb.inline_keyboard.flat().every((b) => fitsCallback(b.callback_data))).toBe(true)
    expect(readReviewData(kb.inline_keyboard[0][2].callback_data)).toEqual({ id: rows[0].id, outcome: 'slip' })
    expect(readReviewData(reviewData('dl-7-20261106', 'part'))).toEqual({ id: 'dl-7-20261106', outcome: 'part' })
    expect(readReviewData('pc|q|x')).toBeNull()
    const marked = putItem(EMPTY_REVIEW, DAY, reviewItem(rows[0], 'done', { at: `${DAY}T15:00:00Z`, minutes: 50 }), DAY)
    const text = reviewText(reviewRows(plan, { now: '15:00', store: marked }), marked, DAY)
    expect(text).toMatch(/1\. 10:00 Lab report \(60 min\) — ✅ Done · 50 min/)
    expect(text).toMatch(/1 of \d blocks checked: 1 done/)
    expect(text).toMatch(/Today's plan: \d+% realistic so far/)
  })
})

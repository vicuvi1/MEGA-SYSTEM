import { describe, expect, it } from 'vitest'
import { decideNow } from './doNow'
import type { NowAction } from './nextAction'

const at = (hm: string) => new Date(`2026-11-05T${hm}:00`).getTime()
const iso = (hm: string) => new Date(`2026-11-05T${hm}:00`).toISOString()
const mustdo: NowAction = { kind: 'mustdo', title: 'Lab report', detail: 'Your next must-do.', index: 0, subject: 'Lab report' }
const habit: NowAction = { kind: 'habit', title: 'Skincare', detail: 'A daily habit, not done yet.', id: 'skincare' }
const base = { now: at('10:00'), hour: 10, running: null, actions: [mustdo] }

describe('one "Do this now"', () => {
  it('a running timer wins, then a promise Ben waits on', () => {
    expect(decideNow({ ...base, running: { subject: 'Math' }, awaiting: 'Gym' }).kind).toBe('running')
    const d = decideNow({ ...base, awaiting: 'Gym at 18:00' })
    expect(d).toMatchObject({ kind: 'answer', title: 'Gym at 18:00' })
    expect(d.why).toMatch(/promised/)
  })
  it('a focus block on now beats the list, with when it ends as the reason', () => {
    const d = decideNow({ ...base, blockNow: { id: 'e1', title: 'Deep work: Algebra', start: iso('09:30'), end: iso('11:00') } })
    expect(d).toMatchObject({ kind: 'block', minutes: 60 })
    expect(d.why).toContain('11:00')
    // Skipped: back to the list.
    expect(decideNow({ ...base, blockNow: { id: 'e1', title: 'x', start: iso('09:30'), end: iso('11:00') }, skipped: ['block:e1'] }).kind).toBe('action')
  })
  it('the evening close replaces the review, once a day', () => {
    const review: NowAction = { kind: 'review', title: '2-minute review', detail: '' }
    expect(decideNow({ ...base, hour: 20, now: at('20:00'), actions: [review] }).kind).toBe('close-day')
    expect(decideNow({ ...base, hour: 20, now: at('20:00'), actions: [review], dayClosed: true })).toMatchObject({ kind: 'action', title: '2-minute review' })
  })
  it("Ben's plan to approve comes before the list (mornings)", () => {
    expect(decideNow({ ...base, planProposed: true }).kind).toBe('approve')
    expect(decideNow({ ...base, planProposed: true, hour: 18 }).kind).toBe('action')
  })
  it('the list gives its reason; a block starting soon beats a habit', () => {
    expect(decideNow(base)).toMatchObject({ kind: 'action', title: 'Lab report', why: 'Your next must-do.', button: '▶ 50 min focus' })
    const soon = { id: 'e2', title: 'Deep work', start: iso('10:30'), end: iso('11:20') }
    expect(decideNow({ ...base, actions: [habit], nextBlock: soon })).toMatchObject({ kind: 'block', tag: 'Next · 10:30' })
    expect(decideNow({ ...base, nextBlock: soon }).kind).toBe('action') // a must-do still first
  })
  it('skipping moves to the next item', () => {
    expect(decideNow({ ...base, actions: [mustdo, habit], skipped: ['mustdo:Lab report'] }).title).toBe('Skincare')
  })
})

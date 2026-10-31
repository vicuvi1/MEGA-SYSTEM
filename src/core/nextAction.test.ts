import { describe, expect, it } from 'vitest'
import { nowActions, type NowInput } from './nextAction'

const base: NowInput = { hour: 10, running: null, wakeLogged: true, plan: [], reviewDone: false, goalsBehind: [], todo: [], habits: [], today: '2026-10-31' }

describe('Now: the next thing to do', () => {
  it('a running focus session comes first, alone', () => {
    const a = nowActions({ ...base, running: { subject: 'Math', startedAt: '', planned: 50 }, wakeLogged: false })
    expect(a.map((x) => x.kind)).toEqual(['stop-focus'])
  })
  it('morning: wake-up, then the plan', () => {
    expect(nowActions({ ...base, wakeLogged: false }).map((x) => x.kind)).toEqual(['log-wake', 'plan'])
  })
  it('a must-do matching a goal you are behind on becomes focus time on it', () => {
    const [first] = nowActions({ ...base, plan: [{ text: 'Math exercises ch. 3', done: false }], goalsBehind: [{ title: 'Math exam', subject: 'Math', aheadH: -3 }] })
    expect(first).toMatchObject({ kind: 'mustdo', subject: 'Math', detail: expect.stringMatching(/3h behind/) })
  })
  it('then late or urgent Todoist tasks, then habits in the order that fits the time of day', () => {
    const a = nowActions({
      ...base,
      hour: 19,
      plan: [{ text: 'Essay', done: true }],
      reviewDone: true,
      todo: [{ id: '1', content: 'Pay rent', priority: 1, due: '2026-10-29' }, { id: '2', content: 'Later', priority: 1, due: '2026-11-02' }],
      habits: [{ id: 'oath', label: 'Morning oath', done: false }, { id: 'clean', label: 'Clean day check-in', done: false }]
    })
    expect(a.map((x) => x.title)).toEqual(['Pay rent', 'Clean day check-in', 'Morning oath'])
  })
  it('evening: the review; nothing left: done', () => {
    expect(nowActions({ ...base, hour: 21, plan: [{ text: 'Gym', done: false }] })[0].kind).toBe('review')
    expect(nowActions({ ...base, hour: 15, plan: [{ text: 'Gym', done: true }] })[0].kind).toBe('done')
  })
})

describe('focus habit', () => {
  it('is never "all done" while the 50 minutes of focus are not', () => {
    const a = nowActions({ ...base, hour: 20, habits: [{ id: 'focus', label: '50 minutes of focus', done: false }, { id: 'clean', label: 'Clean day check-in', done: true }] })
    expect(a[0]).toMatchObject({ kind: 'habit', id: 'focus' })
  })
})

import { describe, expect, it } from 'vitest'
import { benCardVisible, buildToday } from './islandTodos'

describe('one Today list', () => {
  const base = {
    now: { title: 'Deep work' },
    mustdos: [{ i: 0, text: 'Pay rent', done: true }, { i: 1, text: 'Call mum', done: false }, { i: 2, text: 'Gym', done: true }],
    top: [{ i: 0, text: 'Ship the thing', done: true }, { i: 1, text: 'Call mum', done: false }, { i: 2, text: 'Read', done: false }],
    todoist: [{ id: 'a', content: 'Call Mum!', time: null }, { id: 'b', content: 'Buy milk', time: '17:00' }, { id: 'b', content: 'Buy milk', time: '17:00' }]
  }
  it('orders now, must-dos, then Todoist, each task once, done folded', () => {
    const t = buildToday(base)
    expect(t.open.map((r) => r.text)).toEqual(['Deep work', 'Call mum', 'Buy milk'])
    expect(t.done).toBe(2)
  })
  it('the week top 3 is only a count', () => {
    expect(buildToday(base).week).toEqual({ done: 1, total: 2 })
  })
  it('the current block title is not repeated by a task', () => {
    const t = buildToday({ ...base, mustdos: [{ i: 0, text: 'deep work', done: false }] })
    expect(t.open.filter((r) => r.text.toLowerCase() === 'deep work')).toHaveLength(1)
  })
})

describe('Ben card age', () => {
  const now = Date.parse('2026-11-07T12:00:00Z')
  it('shows a fresh message, hides an old one', () => {
    expect(benCardVisible({ at: '2026-11-07T11:00:00Z' }, false, now)).toBe(true)
    expect(benCardVisible({ at: '2026-11-07T09:30:00Z' }, false, now)).toBe(false)
  })
  it('shows while Ben is busy and hides with nothing', () => {
    expect(benCardVisible({ at: '2026-11-07T01:00:00Z' }, true, now)).toBe(true)
    expect(benCardVisible(null, false, now)).toBe(false)
    expect(benCardVisible({ at: 'nonsense' }, false, now)).toBe(false)
  })
})

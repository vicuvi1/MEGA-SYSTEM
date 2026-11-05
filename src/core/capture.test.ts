import { describe, expect, it } from 'vitest'
import { parseCapture } from './capture'

describe('one capture box', () => {
  it('focus timers in any order', () => {
    expect(parseCapture('focus 50 algebra')).toEqual({ kind: 'focus', subject: 'algebra', minutes: 50 })
    expect(parseCapture('f lab report 25m')).toEqual({ kind: 'focus', subject: 'lab report', minutes: 25 })
    expect(parseCapture('focus 900 x')).toEqual({ kind: 'focus', subject: 'x', minutes: 180 })
    expect(parseCapture('focus algebra')?.kind).toBe('free') // no minutes: Ben decides
  })
  it('tasks, the clean check-in and the oath', () => {
    expect(parseCapture('task call mom tomorrow p1')).toEqual({ kind: 'task', text: 'call mom tomorrow p1' })
    expect(parseCapture('todo: read 10 pages')).toEqual({ kind: 'task', text: 'read 10 pages' })
    expect(parseCapture('clean')).toEqual({ kind: 'clean' })
    expect(parseCapture('check in')).toEqual({ kind: 'clean' })
    expect(parseCapture('oath')).toEqual({ kind: 'oath' })
  })
  it('everything else goes on (rules for money/water/reps, then Ben)', () => {
    expect(parseCapture('  45   lunch ')).toEqual({ kind: 'free', text: '45 lunch' })
    expect(parseCapture('water 500')).toEqual({ kind: 'free', text: 'water 500' })
    expect(parseCapture('cleaning the room')?.kind).toBe('free')
    expect(parseCapture('   ')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { skillStatus } from './skills'

const wk = (name: string, sets: number, reps: number) => ({ id: 1, day: '2026-11-05', ts: '', title: name, items: [{ exerciseId: name, name, unit: 'reps', amount: sets * reps, sets: Array.from({ length: sets }, () => ({ reps })) }], note: null }) as any

describe('skill paths', () => {
  it('a move unlocks the next when its test is passed', () => {
    const s = skillStatus([wk('Incline push-ups', 3, 15), wk('Push-ups', 3, 12)])
    const push = s.find((x) => x.id === 'push')!
    expect(push.level).toBe(2)
    expect(push.current.name).toBe('Diamond push-ups')
    expect(push.next?.name).toBe('Archer push-ups')
  })
  it('a session short of the test does not count; new users start at the first move', () => {
    const s = skillStatus([wk('Incline push-ups', 2, 15)])
    expect(s.find((x) => x.id === 'push')!.level).toBe(0)
    expect(skillStatus([]).every((x) => x.level === 0)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { pickWorkoutSlot, slotLine } from './workoutSlot'

const h = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

describe('workout slot (BD8)', () => {
  it('goes in the 12:00–16:00 gap before an evening shift', () => {
    const s = pickWorkoutSlot([{ s: h('09:00'), e: h('11:00') }, { s: h('11:30'), e: h('17:00') }, { s: h('17:00'), e: h('23:59'), light: true }], { minutes: 30 })
    expect(s).toMatchObject({ start: h('12:00'), minutes: 30, preferred: true })
    expect(slotLine(s!, '17:00')).toBe('12:00–12:30, before your shift')
  })
  it('moves around a class in the middle of the day', () => {
    // Free 08:00–12:10, class 12:10–15:20, free 15:20–16:50.
    const s = pickWorkoutSlot([{ s: h('08:00'), e: h('12:10') }, { s: h('15:20'), e: h('16:50') }], { minutes: 45 })
    expect(s).toMatchObject({ start: h('15:30'), minutes: 45, preferred: true })
  })
  it('never ends after 22:00 and never in the work window', () => {
    expect(pickWorkoutSlot([{ s: h('21:30'), e: h('23:30') }], { minutes: 30 })).toBeNull()
    expect(pickWorkoutSlot([{ s: h('12:00'), e: h('16:00'), light: true }], { minutes: 30 })).toBeNull()
    const late = pickWorkoutSlot([{ s: h('20:00'), e: h('23:00') }], { minutes: 30 })
    expect(late!.start + late!.minutes).toBeLessThanOrEqual(h('22:00'))
  })
  it('takes a shorter session when only a short gap is free', () => {
    expect(pickWorkoutSlot([{ s: h('13:00'), e: h('13:45') }], { minutes: 45 })).toMatchObject({ start: h('13:15'), minutes: 20 })
  })
})

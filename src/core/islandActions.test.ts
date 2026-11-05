import { describe, expect, it } from 'vitest'
import { clipWorthSaving, nextFreeSlot, taskMinutes } from './islandActions'

describe('clipboard catch', () => {
  it('offers dated things', () => {
    expect(clipWorthSaving('Exam 12 Dec, chapters 3–5')).toBe('Exam 12 Dec, chapters 3–5')
    expect(clipWorthSaving('Call with Maxim tomorrow 15:00')).toBeTruthy()
    expect(clipWorthSaving('Lab 4 deadline vineri')).toBeTruthy()
    expect(clipWorthSaving('Predare proiect 20.11')).toBeTruthy()
  })
  it('never offers links, code, keys, secrets or plain text', () => {
    expect(clipWorthSaving('https://example.com/a/b?c=1')).toBeNull()
    expect(clipWorthSaving('const x = () => { return 1 }')).toBeNull()
    expect(clipWorthSaving('sk_live_9f8d7s6a5d4f3g2h1')).toBeNull()
    expect(clipWorthSaving('my password is 12.03.1999')).toBeNull()
    expect(clipWorthSaving('just some words here')).toBeNull()
    expect(clipWorthSaving('x'.repeat(300))).toBeNull()
  })
})

describe('booking a dropped task', () => {
  const T = Date.parse('2026-11-04T14:02:00')
  const b = (s: string, e: string) => ({ title: 'x', start: Date.parse(`2026-11-04T${s}:00`), end: Date.parse(`2026-11-04T${e}:00`) })
  it('finds the next free quarter hour that fits', () => {
    expect(new Date(nextFreeSlot([], T)!.start).toTimeString().slice(0, 5)).toBe('14:15')
    expect(new Date(nextFreeSlot([b('14:00', '15:00')], T)!.start).toTimeString().slice(0, 5)).toBe('15:00')
    expect(new Date(nextFreeSlot([b('14:00', '15:00'), b('15:10', '16:00')], T, 30)!.start).toTimeString().slice(0, 5)).toBe('16:00')
    expect(nextFreeSlot([b('14:00', '22:00')], T)).toBeNull()
  })
  it('reads a length from the task', () => {
    expect(taskMinutes('Read chapter 4 45m')).toBe(45)
    expect(taskMinutes('Lab report 2h')).toBe(120)
    expect(taskMinutes('Call mom')).toBe(50) // the one default (core/booking.ts)
  })
})

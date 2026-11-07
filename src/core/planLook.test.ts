import { describe, expect, it } from 'vitest'
import { appDuplicates, blockLook, lookTitle, planEventId, plainTitle, sameTitle } from './planLook'
import type { CalEvent } from './dayTime'

const day = '2030-03-12'
const ev = (id: string, title: string, s: string, e: string, ours = true): CalEvent => ({ id, calendarId: 'primary', title, start: `${day}T${s}:00`, end: `${day}T${e}:00`, allDay: false, ours })

describe('how a plan block looks in the calendar', () => {
  it('colour and emoji by kind', () => {
    expect(blockLook('Write the lab report intro', 'focus')).toMatchObject({ kind: 'deep', emoji: '🎯', colorId: '9' })
    expect(blockLook('Algebra: Pass the exam', 'goal')).toMatchObject({ kind: 'study', emoji: '📚', colorId: '7' })
    expect(blockLook('Read chapter 4', 'focus')).toMatchObject({ kind: 'study' })
    expect(blockLook('Quick tasks (4)', 'quick')).toMatchObject({ kind: 'chores', emoji: '🧹', colorId: '5' })
    expect(blockLook('Laundry and dishes')).toMatchObject({ kind: 'chores' })
    expect(blockLook('Workout · 45 min', null, true)).toMatchObject({ kind: 'sport', emoji: '💪', colorId: '10' })
    expect(blockLook('Coffee break')).toMatchObject({ kind: 'break', emoji: '☕', colorId: '2' })
    expect(blockLook('Lunch')).toMatchObject({ kind: 'meal', colorId: '6' })
    // Every kind has its own colour.
    const ids = ['Deep work', 'Study', 'Chores', 'Gym', 'Break', 'Dinner'].map((t) => blockLook(t).colorId)
    expect(new Set(ids).size).toBe(6)
  })

  it('the emoji goes in front once, and comes off for the block name', () => {
    expect(lookTitle('Write the essay', 'focus')).toBe('📚 Write the essay')
    expect(lookTitle('🔥 My own name')).toBe('🔥 My own name')
    expect(lookTitle('Workout · 45 min', null, true)).toBe('💪 Workout · 45 min')
    expect(plainTitle('🎯 Ship the settings screen')).toBe('Ship the settings screen')
    expect(plainTitle('🍽️ Lunch')).toBe('Lunch')
    expect(sameTitle('☕ Break', 'Break')).toBe(true)
  })
})

describe('one event per block', () => {
  it('the event id is the same for the same day and block, and Google accepts it', () => {
    const a = planEventId(day, 'b1x9k')
    expect(a).toBe(planEventId(day, 'b1x9k'))
    expect(a).not.toBe(planEventId(day, 'b2'))
    expect(a).not.toBe(planEventId('2030-03-13', 'b1x9k'))
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it('the clean-up only removes copies the app made, never your own events', () => {
    const events = [
      ev('a1', '🎯 Essay', '09:00', '10:00'),
      ev('a2', '🎯 Essay', '09:00', '10:00'),
      ev('a3', 'Essay', '09:00', '10:00'), // the same block from an older approval (no emoji)
      ev('mine1', '🎯 Essay', '09:00', '10:00', false), // made by you: same title and time, never touched
      ev('b1', '📚 Read', '11:00', '12:00'),
      ev('b2', '📚 Read', '11:00', '12:30'), // another length: not a copy
      ev('mine2', 'Dentist', '15:00', '15:30', false),
      ev('mine3', 'Dentist', '15:00', '15:30', false)
    ]
    expect(appDuplicates(events).map((e) => e.id).sort()).toEqual(['a2', 'a3'])
    // The block's own event is the one kept.
    expect(appDuplicates(events, new Set(['a3'])).map((e) => e.id).sort()).toEqual(['a1', 'a2'])
    expect(appDuplicates(events.filter((e) => !e.ours))).toEqual([])
  })
})

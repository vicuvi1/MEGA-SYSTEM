import { describe, expect, it } from 'vitest'
import { foodLoggedAlert, rememberSeen } from './islandFood'
import { alertGate, alertPriority } from './islandModel'

const NOW = Date.parse('2030-03-12T13:05:00Z')
const meal = { id: 'fd-p1abc', name: 'Rice + chicken', type: 'lunch', kcal: 680, protein: 42, at: '2030-03-12T13:04:00Z' }

describe("the island's food notice", () => {
  it('says what was logged, with OK and Undo', () => {
    const a = foodLoggedAlert(meal, NOW, {})!
    expect(a).toMatchObject({ id: 'food:fd-p1abc', kind: 'food', title: 'Lunch logged', text: 'Lunch logged: 42 g protein, 680 kcal' })
    expect(a.actions.map((x) => x.action)).toEqual([{ kind: 'dismiss', id: 'food:fd-p1abc' }, { kind: 'foodUndo', mealId: 'fd-p1abc', alertId: 'food:fd-p1abc' }])
  })
  it('once: not when old, dismissed or already seen', () => {
    expect(foodLoggedAlert(meal, NOW + 11 * 60_000, {})).toBeNull()
    expect(foodLoggedAlert(meal, NOW, { 'food:fd-p1abc': NOW + 1000 })).toBeNull()
    expect(foodLoggedAlert(meal, NOW, {}, rememberSeen([], 'fd-p1abc'))).toBeNull()
    expect(foodLoggedAlert(null, NOW, {})).toBeNull()
    expect(foodLoggedAlert({ ...meal, id: 'x' }, NOW, {})).toBeNull()
  })
  it('drops down like a plan card: quiet hours drop it, a call makes it a dot', () => {
    expect(alertPriority('food')).toBe('normal')
    const prefs = { kinds: {} as any }
    expect(alertGate({ kind: 'food', prefs, quiet: true, call: false, lastPeekAt: 0, now: NOW })).toBe('drop')
    expect(alertGate({ kind: 'food', prefs, quiet: false, call: true, lastPeekAt: 0, now: NOW })).toBe('silent')
    expect(alertGate({ kind: 'food', prefs, quiet: false, call: false, lastPeekAt: 0, now: NOW })).toBe('peek')
  })
})

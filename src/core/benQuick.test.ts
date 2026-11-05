import { describe, expect, it } from 'vitest'
import { amountIn, codeFix, preLookups, quickKind, quickReply, rangeOf, topicOf } from './benQuick'

const today = '2026-11-05' // a Thursday

describe('Ben without the AI (B3, B9, B10)', () => {
  it('reads time ranges', () => {
    expect(rangeOf('this week', today)).toMatchObject({ from: '2026-11-02', to: today })
    expect(rangeOf('last week', today)).toMatchObject({ from: '2026-10-26', to: '2026-11-01' })
    expect(rangeOf('yesterday', today)).toMatchObject({ from: '2026-11-04', to: '2026-11-04' })
    expect(rangeOf('last month', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(rangeOf('how much did I study in October', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31', label: 'October' })
    expect(rangeOf('in december', today)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(rangeOf('hello', today)).toBeNull()
  })
  it('knows the topic', () => {
    expect(topicOf('spent this week?')).toBe('spending')
    expect(topicOf('how much did I study')).toBe('focus')
    expect(topicOf('workouts this month')).toBe('workouts')
  })
  it('answers short questions from the data, never logs or real asks', () => {
    expect(quickKind('What now?', today)).toEqual({ kind: 'now' })
    expect(quickKind('water?', today)).toEqual({ kind: 'water' })
    expect(quickKind('my streak', today)).toEqual({ kind: 'streak' })
    expect(quickKind('spent this week?', today)).toMatchObject({ kind: 'lookup', need: 'spending 2026-11-02 2026-11-05' })
    expect(quickKind('spent 50 on pizza', today)).toBeNull()
    expect(quickKind('why did I spend so much this week?', today)).toBeNull()
    expect(quickKind('plan my week', today)).toBeNull()
    expect(quickKind('how many tasks do I have left today?', today)).toBeNull()
    expect(quickKind('tasks done this week?', today)).toMatchObject({ kind: 'lookup', topic: 'tasks' })
  })
  it('looks history up before asking the AI', () => {
    expect(preLookups('How much did I study in October?', today)).toEqual(['focus 2026-10-01 2026-10-31'])
    expect(preLookups('I studied a lot', today)).toEqual([])
  })
  it('writes the replies', () => {
    const now = new Date('2026-11-05T15:00:00')
    expect(quickReply({ kind: 'water' }, { water: { ml: 500, target: 2700 } }, now)?.reply).toContain("You're behind")
    expect(quickReply({ kind: 'now' }, { move: { kind: 'focus', title: '25 min on Algebra', sub: 'Your must-do.', subject: 'Algebra', minutes: 25 } })?.buttons[0].do).toBe('focus:25:Algebra')
    expect(quickReply({ kind: 'streak' }, { streaks: { training: 4, clean: 10, focusWeekMin: 135 } })?.reply).toContain('2h 15m')
    expect(quickReply({ kind: 'lookup', need: 'x', label: 'this week', topic: 'spending' }, { found: 'Spending …: 320 lei' })?.reply).toContain('320 lei')
    expect(quickReply({ kind: 'lookup', need: 'x', label: 'this week', topic: 'spending' }, { found: 'Spending: Finance Helper data not available.' })).toBeNull()
  })
  it('fixes corrections in code', () => {
    expect(codeFix('undo that')).toBe('undo')
    expect(codeFix('Undo')).toBe('undo')
    expect(codeFix("that was water, not money")).toBe('water')
    expect(codeFix('the water was cold today and I hated it')).toBeNull()
    expect(amountIn('💸 Water 250 lei · Food')).toBe(250)
    expect(amountIn('💸 at 12:30 pizza 9')).toBeNull()
  })
})

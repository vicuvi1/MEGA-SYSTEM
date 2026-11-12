import { describe, expect, it } from 'vitest'
import { altTarget, ARCHIVE_PAGES, isHidden, readSimple, simpleMenu, toggleShown } from './simpleMode'
import { isSettingKey } from './settingsKeys'

describe('Simple mode', () => {
  it('is on by default, with the budget on and the afternoon nudge off', () => {
    expect(readSimple(null)).toEqual({ on: true, budget: true, afternoon: false, shown: [] })
    expect(readSimple('not json')).toEqual({ on: true, budget: true, afternoon: false, shown: [] })
    expect(readSimple('{"on":false}')).toEqual({ on: false, budget: true, afternoon: false, shown: [] })
  })

  it('hides the unused modules while on', () => {
    expect(isHidden(readSimple(null), 'loot')).toBe(true)
    expect(isHidden(readSimple({ on: false }), 'loot')).toBe(false)
  })

  it('the menu is Today, Study Time, Sport Track and Money; everything else is under Archive (nothing lost)', () => {
    const m = simpleMenu(readSimple(null))!
    expect(m.main).toEqual(['today', 'study', 'body', 'money'])
    expect(m.archive).not.toContain('money')
    expect(m.archive).toEqual([...ARCHIVE_PAGES])
    for (const p of ['calendar', 'coach', 'goals', 'season', 'career', 'progress', 'shop', 'sleep', 'locker', 'discipline', 'music', 'custom', 'tasks']) expect(m.archive).toContain(p)
    expect(simpleMenu(readSimple({ on: false }))).toBeNull()
  })

  it('a page brought back from the Archive joins the menu, in archive order; unknown pages are dropped', () => {
    const s = readSimple({ shown: ['music', 'calendar', 'nope', 'today', 'money'] })
    expect(s.shown).toEqual(['calendar', 'music'])
    const m = simpleMenu(s)!
    expect(m.main).toEqual(['today', 'study', 'body', 'money', 'calendar', 'music'])
    expect(m.archive).not.toContain('music')
    expect(toggleShown(s, 'music', false)).toEqual(['calendar'])
    expect(toggleShown(s, 'sleep', true)).toEqual(['calendar', 'sleep', 'music'])
  })

  it('Alt+number follows the menu as shown', () => {
    const full = ['today', 'calendar', 'tasks', 'study', 'coach']
    expect(altTarget(readSimple(null), full, [], 1)).toBe('today')
    expect(altTarget(readSimple(null), full, [], 2)).toBe('study')
    expect(altTarget(readSimple(null), full, [], 3)).toBe('body')
    expect(altTarget(readSimple(null), full, [], 4)).toBe('money')
    expect(altTarget(readSimple(null), full, [], 5)).toBeNull()
    expect(altTarget(readSimple({ shown: ['sleep'] }), full, [], 5)).toBe('sleep')
    expect(altTarget(readSimple({ on: false }), full, ['calendar'], 2)).toBe('tasks')
  })

  it('is a registered setting', () => {
    expect(isSettingKey('simple_mode')).toBe(true)
  })
})

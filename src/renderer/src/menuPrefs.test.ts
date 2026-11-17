import { describe, expect, it } from 'vitest'
import { DEFAULT_MODULES, menuPages, setModule } from '@core/modules'
import { canHidePage, editablePages, setPageHidden } from './menuPrefs'

const KNOWN = ['today', 'money', 'sleep', 'body', 'discipline', 'study', 'settings']

describe('hide or show menu pages', () => {
  it('Today and Settings can never be hidden', () => {
    expect(canHidePage('today')).toBe(false)
    expect(canHidePage('settings')).toBe(false)
    expect(setPageHidden([], 'today', true)).toEqual([])
    expect(setPageHidden(['sleep'], 'settings', true)).toEqual(['sleep'])
    expect(canHidePage('money')).toBe(true)
  })

  it('hides once, shows again, never duplicates', () => {
    const a = setPageHidden([], 'money', true)
    expect(setPageHidden(a, 'money', true)).toEqual(['money'])
    expect(setPageHidden(a, 'money', false)).toEqual([])
  })

  it('a page that comes back is in the same place', () => {
    const mods = DEFAULT_MODULES
    const before = menuPages(mods, KNOWN)
    const hidden = setPageHidden([], 'sleep', true)
    expect(menuPages(mods, KNOWN, hidden)).toEqual(before.filter((x) => x !== 'sleep'))
    expect(menuPages(mods, KNOWN, setPageHidden(hidden, 'sleep', false))).toEqual(before)
  })

  it('edit mode lists hidden pages too, only of modules that are on', () => {
    const list = editablePages(DEFAULT_MODULES, KNOWN)
    expect(list).toEqual(menuPages(DEFAULT_MODULES, KNOWN, []))
    expect(list).not.toContain('study')
    expect(editablePages(setModule(DEFAULT_MODULES, 'study', true), KNOWN)).toContain('study')
  })
})

import { describe, expect, it } from 'vitest'
import { MODULES, SYSTEM_PAGES } from './modules'
import { buildNav, cleanNavPrefs, MAX_PINS, movePin, NAV_PAGES, shortcutOrder, togglePin } from './navLayout'

const none = cleanNavPrefs(null)

describe('sidebar sections', () => {
  it('keeps every page the old sidebar had, plus Notebook, each once', () => {
    for (const m of MODULES) expect(NAV_PAGES).toContain(m.id)
    expect(NAV_PAGES).toContain('notebook')
    expect(new Set(NAV_PAGES).size).toBe(NAV_PAGES.length)
    const known = new Set([...MODULES, ...SYSTEM_PAGES].map((m) => m.id))
    for (const id of NAV_PAGES) expect(known.has(id)).toBe(true)
  })
  it('starts with Today, then Plan, Body, Money, Me and More', () => {
    expect(buildNav(none).map((s) => s.id)).toEqual(['top', 'plan', 'body', 'money', 'me', 'more'])
    expect(buildNav(none)[0].ids).toEqual(['today'])
  })
  it('moves pinned pages into Pinned, in your order, and out of their own section', () => {
    const p = togglePin(togglePin(none, 'music'), 'goals')
    const nav = buildNav(p)
    expect(nav[1]).toEqual({ id: 'pinned', title: 'Pinned', ids: ['music', 'goals'] })
    expect(nav.find((s) => s.id === 'plan')!.ids).not.toContain('goals')
    expect(nav.find((s) => s.id === 'more')!.ids).not.toContain('music')
  })
  it('leaves out hidden pages but never Today, and drops a section left empty', () => {
    const nav = buildNav(none, new Set(['today', 'money', 'shop']))
    expect(nav[0].ids).toEqual(['today'])
    expect(nav.find((s) => s.id === 'money')).toBeUndefined()
  })
  it('reorders pins by step or onto another pin, and ignores moves off the ends', () => {
    const p = { pins: ['goals', 'music', 'tasks'] as const, more: false } as any
    expect(movePin(p, 'tasks', -1).pins).toEqual(['goals', 'tasks', 'music'])
    expect(movePin(p, 'goals', 'tasks').pins).toEqual(['music', 'tasks', 'goals'])
    expect(movePin(p, 'goals', -1)).toBe(p)
    expect(movePin(p, 'coach', 1)).toBe(p)
  })
  it('cleans what storage holds', () => {
    expect(cleanNavPrefs({ pins: ['today', 'nope', 'goals', 'goals', 7], more: 'yes' })).toEqual({ pins: ['goals'], more: false })
    expect(cleanNavPrefs({ pins: NAV_PAGES, more: true }).pins).toHaveLength(MAX_PINS)
    expect(togglePin(none, 'today')).toBe(none)
  })
  it('Alt+1…9 follow what you see: More only counts while it is open', () => {
    const nav = buildNav(togglePin(none, 'coach'))
    expect(shortcutOrder(nav, false).slice(0, 3)).toEqual(['today', 'coach', 'calendar'])
    expect(shortcutOrder(nav, false)).not.toContain('music')
    expect(shortcutOrder(nav, true)).toContain('music')
  })
})

import { describe, expect, it } from 'vitest'
import { autoPage, cleanPagesPrefs, dayPartOf, DEFAULT_PAGES, keyDir, stepPage, swipeDir, visiblePages, wheelDir } from './pages'

describe('island pages (PL6)', () => {
  it('cleans saved prefs: keeps unknown pages for later, adds missing ones, Day always on', () => {
    const p = cleanPagesPrefs({ order: [{ id: 'fun', on: true }, { id: 'day', on: false }, { id: 'BAD id' }, { id: 'captions', on: true }], follow: 'nope' })
    expect(p.order.map((x) => x.id)).toEqual(['fun', 'day', 'captions', 'music', 'home', 'pc'])
    expect(p.order.find((x) => x.id === 'day')!.on).toBe(true)
    expect(p.follow).toBe('off')
    expect(cleanPagesPrefs(null)).toEqual(DEFAULT_PAGES)
  })
  it('shows registered, switched-on pages in your order; new registered pages go last', () => {
    const p = cleanPagesPrefs({ order: [{ id: 'fun', on: true }, { id: 'music', on: false }] })
    expect(visiblePages(p, ['day', 'music', 'fun', 'captions'])).toEqual(['fun', 'day', 'captions'])
    expect(visiblePages(p, [])).toEqual([])
  })
  it('follows the time of day or the profile', () => {
    const shown = ['day', 'music', 'home', 'fun']
    expect(dayPartOf(8)).toBe('morning')
    expect(dayPartOf(23)).toBe('night')
    expect(dayPartOf(3)).toBe('night')
    const t = cleanPagesPrefs({ follow: 'time' })
    expect(autoPage(t, { hour: 19 }, shown)).toBe('fun')
    expect(autoPage(t, { hour: 23 }, shown)).toBe('music')
    const pr = cleanPagesPrefs({ follow: 'profile', byProfile: { gaming: 'home' } })
    expect(autoPage(pr, { hour: 9, profile: 'gaming' }, shown)).toBe('home')
    expect(autoPage(pr, { hour: 9, profile: 'none' }, shown)).toBeNull()
    // A page that isn't shown is never opened.
    expect(autoPage(cleanPagesPrefs({ follow: 'time' }), { hour: 19 }, ['day'])).toBeNull()
    expect(autoPage(DEFAULT_PAGES, { hour: 19 }, shown)).toBeNull()
  })
  it('steps and stops at the ends', () => {
    const s = ['day', 'music', 'fun']
    expect(stepPage(s, 'day', 1)).toBe('music')
    expect(stepPage(s, 'day', -1)).toBe('day')
    expect(stepPage(s, 'fun', 1)).toBe('fun')
  })
  it('a sideways drag or flick turns the page; up and down does not', () => {
    expect(swipeDir(-150, 10, 300, 440)).toBe(1)
    expect(swipeDir(150, 10, 300, 440)).toBe(-1)
    expect(swipeDir(-60, 5, 60, 440)).toBe(1) // a quick flick
    expect(swipeDir(-60, 5, 600, 440)).toBe(0) // slow and short
    expect(swipeDir(-120, 200, 300, 440)).toBe(0) // mostly a scroll
  })
  it('wheel: sideways or Shift turns the page, plain scrolling does not', () => {
    expect(wheelDir(40, 2, false)).toBe(1)
    expect(wheelDir(-40, 2, false)).toBe(-1)
    expect(wheelDir(0, 100, false)).toBe(0)
    expect(wheelDir(0, 100, true)).toBe(1)
    expect(wheelDir(3, 0, false)).toBe(0)
  })
  it('keys: Ctrl+arrows anywhere, [ ] outside a text box', () => {
    expect(keyDir('ArrowRight', true, true)).toBe(1)
    expect(keyDir('ArrowLeft', false, false)).toBe(0)
    expect(keyDir(']', false, false)).toBe(1)
    expect(keyDir('[', false, true)).toBe(0)
  })
})

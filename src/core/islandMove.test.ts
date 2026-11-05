// H1: moving and hiding the island (pure part).
import { describe, expect, it } from 'vitest'
import {
  clampFree, cleanHide, cleanPanelSize, cleanSpots, dragTo, dropSpot, fitShift, hideFor, hideText, hideTick, moveModeKey, nextMorning, nudgeStep, PANEL_MAX, PANEL_MIN,
  rememberSpot, resizePanel, rushing, screenKey, SHOWN, SPOTS_MAX, toggleHide
} from './islandMove'

const sb = { x: 0, y: 0, width: 1920, height: 1080 }
const wa = { x: 0, y: 0, width: 1920, height: 1040 }

describe('dropping it', () => {
  it('snaps only in the top zone', () => {
    expect(dropSpot({ x: 200, y: 40 }, sb)).toBe('top-left')
    expect(dropSpot({ x: 960, y: 10 }, sb)).toBe('top')
    expect(dropSpot({ x: 1800, y: 100 }, sb)).toBe('top-right')
  })
  it('anywhere else it stays where you let go (the sides too)', () => {
    expect(dropSpot({ x: 960, y: 500 }, sb)).toBe('free')
    expect(dropSpot({ x: 5, y: 600 }, sb)).toBe('free')
    expect(dropSpot({ x: 1915, y: 600 }, sb)).toBe('free')
  })
  it('works on a second screen with its own origin', () => {
    const right = { x: 1920, y: -200, width: 2560, height: 1440 }
    expect(dropSpot({ x: 1920 + 1280, y: -150 }, right)).toBe('top')
    expect(dropSpot({ x: 1920 + 1280, y: 300 }, right)).toBe('free')
  })
  it('the window follows the pointer with the same grip', () => {
    expect(dragTo({ x: 500, y: 300 }, { x: 250, y: 20 })).toEqual({ x: 250, y: 280 })
  })
})

describe('floating where you dropped it', () => {
  const size = { width: 500, height: 660 }
  const keep = { x: 130, y: 0, w: 240, h: 44 }
  it('stays exactly there when the pill is on the screen', () => {
    expect(clampFree({ x: 700, y: 600 }, size, wa, keep)).toEqual({ x: 700, y: 600 })
  })
  it('may hang off the edge, but the pill stays on the screen', () => {
    expect(clampFree({ x: -400, y: 0 }, size, wa, keep)).toEqual({ x: -130, y: 0 })
    expect(clampFree({ x: 1900, y: 0 }, size, wa, keep)).toEqual({ x: 1920 - 370, y: 0 })
    expect(clampFree({ x: 0, y: 2000 }, size, wa, keep)).toEqual({ x: 0, y: 1040 - 44 })
    expect(clampFree({ x: 0, y: -50 }, size, wa, keep)).toEqual({ x: 0, y: 0 })
  })
  it('without a known pill, the top middle counts', () => {
    expect(clampFree({ x: -1000, y: 0 }, size, wa).x).toBe(-130)
  })
  it('slides to show an open panel near an edge, and not otherwise', () => {
    const panel = [{ x: 40, y: 0, w: 420, h: 500 }]
    expect(fitShift({ x: 600, y: 100 }, panel, wa)).toEqual({ x: 0, y: 0 })
    expect(fitShift({ x: 600, y: 800 }, panel, wa)).toEqual({ x: 0, y: -260 })
    expect(fitShift({ x: -100, y: 0 }, panel, wa)).toEqual({ x: 60, y: 0 })
    expect(fitShift({ x: 1700, y: 0 }, panel, wa)).toEqual({ x: -240, y: 0 })
    expect(fitShift({ x: 0, y: 0 }, [], wa)).toEqual({ x: 0, y: 0 })
  })
})

describe('move mode', () => {
  it('arrows nudge, Shift is bigger, Alt is finer', () => {
    expect(nudgeStep('ArrowLeft')).toEqual({ x: -2, y: 0 })
    expect(nudgeStep('ArrowDown', { shift: true })).toEqual({ x: 0, y: 20 })
    expect(nudgeStep('ArrowUp', { alt: true })).toEqual({ x: 0, y: -1 })
    expect(nudgeStep('a')).toBeNull()
  })
  it('Enter saves, Esc puts it back', () => {
    expect(moveModeKey('Enter')).toBe('save')
    expect(moveModeKey('Escape')).toBe('cancel')
    expect(moveModeKey('ArrowRight')).toEqual({ nudge: { x: 2, y: 0 } })
    expect(moveModeKey('x')).toBeNull()
  })
})

describe('per screen', () => {
  it('keys a screen by id and size', () => {
    expect(screenKey({ id: 7, bounds: { x: 0, y: 0, width: 2560.4, height: 1440 } })).toBe('7:2560x1440')
  })
  it('remembers at most 8 screens, the newest last', () => {
    let all = {}
    for (let i = 0; i < 10; i++) all = rememberSpot(all, `k${i}`, { place: 'free', pos: { cx: 0.5, top: i, cy: 0.5 } })
    expect(Object.keys(all)).toHaveLength(SPOTS_MAX)
    expect(Object.keys(all).at(-1)).toBe('k9')
  })
  it('cleans saved spots', () => {
    const c = cleanSpots({ a: { place: 'free', pos: { cx: 3, top: 50 } }, b: { place: 'bottom' }, c: { place: 'top', pos: {}, size: { w: 5, h: 5000 } } })
    expect(c.a.pos).toEqual({ cx: 1, top: 50, cy: 0.5 })
    expect(c.b).toBeUndefined()
    expect(c.c.size).toEqual({ w: PANEL_MIN.w, h: PANEL_MAX.h })
    expect(cleanSpots(null)).toEqual({})
  })
})

describe('free resize (IN39)', () => {
  it('keeps the panel between its smallest and largest size', () => {
    expect(resizePanel({ w: 420, h: 520 }, { x: 40, y: -30 })).toEqual({ w: 460, h: 490 })
    expect(resizePanel({ w: 420, h: 520 }, { x: -999, y: 9999 })).toEqual({ w: PANEL_MIN.w, h: PANEL_MAX.h })
    expect(resizePanel({ w: 420, h: 520 }, { x: 400, y: 400 }, { w: 600, h: 700 })).toEqual({ w: 600, h: 700 })
    expect(cleanPanelSize({ w: NaN, h: 'x' as any })).toEqual({ w: 420, h: 520 })
  })
})

describe('hiding', () => {
  const now = new Date(2026, 10, 5, 14, 0).getTime()
  it('for an hour, until tomorrow, until you bring it back, or as a dot', () => {
    expect(hideFor('1h', now)).toEqual({ mode: 'hidden', until: now + 3600_000 })
    expect(hideFor('tomorrow', now).until).toBe(new Date(2026, 10, 6, 6, 0).getTime())
    expect(hideFor('manual', now)).toEqual({ mode: 'hidden', until: 0 })
    expect(hideFor('dot', now)).toEqual({ mode: 'dot', until: 0 })
  })
  it('before 06:00, "tomorrow" means this morning', () => {
    const early = new Date(2026, 10, 5, 2, 0).getTime()
    expect(nextMorning(early)).toBe(new Date(2026, 10, 5, 6, 0).getTime())
  })
  it('the same shortcut hides and brings it back', () => {
    const h = toggleHide(SHOWN, now)
    expect(h.mode).toBe('hidden')
    expect(toggleHide(h, now)).toEqual(SHOWN)
    expect(toggleHide({ mode: 'dot', until: 0 }, now)).toEqual(SHOWN)
  })
  it('comes back by itself when the time is up', () => {
    const h = hideFor('1h', now)
    expect(hideTick(h, now + 1000)).toBe(h)
    expect(hideTick(h, now + 3600_000)).toEqual(SHOWN)
    expect(hideTick(hideFor('manual', now), now + 9e9).mode).toBe('hidden')
  })
  it('a saved state that ran out while the PC was off is shown', () => {
    expect(cleanHide({ mode: 'hidden', until: now - 1 }, now)).toEqual(SHOWN)
    expect(cleanHide({ mode: 'dot', until: 0 }, now)).toEqual({ mode: 'dot', until: 0 })
    expect(cleanHide('junk', now)).toEqual(SHOWN)
  })
  it('says how long', () => {
    expect(hideText(hideFor('1h', now), now)).toBe('Hidden until 15:00')
    expect(hideText(hideFor('tomorrow', now), now)).toBe('Hidden until tomorrow 06:00')
    expect(hideText(hideFor('manual', now), now)).toBe('Hidden until you bring it back')
  })
})

describe('out of the way when the mouse rushes at it', () => {
  const pill = { x: 800, y: 0, w: 300, h: 40 }
  it('a fast move toward it counts', () => {
    expect(rushing({ x: 950, y: 300, t: 0 }, { x: 950, y: 120, t: 50 }, pill)).toBe(true)
  })
  it('slow moves, far moves and moves away do not', () => {
    expect(rushing({ x: 950, y: 300, t: 0 }, { x: 950, y: 280, t: 50 }, pill)).toBe(false)
    expect(rushing({ x: 950, y: 900, t: 0 }, { x: 950, y: 700, t: 50 }, pill)).toBe(false)
    expect(rushing({ x: 950, y: 60, t: 0 }, { x: 950, y: 240, t: 50 }, pill)).toBe(false)
    expect(rushing({ x: 950, y: 300, t: 0 }, { x: 950, y: 120, t: 0 }, pill)).toBe(false)
  })
})

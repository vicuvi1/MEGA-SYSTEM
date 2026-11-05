import { describe, expect, it } from 'vitest'
import {
  cleanDeskPrefs, dragStale, hotRects, isAltGrCombo, islandSize, migrateShortcuts, overRects, parseWatcherLine, placeIsland, rateLimit, rectsToDip, sampleSeconds
} from './islandWin'

const wa = { x: 0, y: 0, width: 1920, height: 1040 }
const pos = { cx: 0.5, top: 0, cy: 0.5 }

describe('island window size and place', () => {
  it('scales with the size setting', () => {
    expect(islandSize({ width: 500, height: 660 }, 1.15, wa)).toEqual({ width: 575, height: 759 })
  })
  it('is never taller or wider than the work area', () => {
    const small = { x: 0, y: 0, width: 1280, height: 620 }
    expect(islandSize({ width: 500, height: 660 }, 1.15, small)).toEqual({ width: 575, height: 620 })
    expect(islandSize({ width: 500, height: 660 }, 1, { x: 0, y: 0, width: 400, height: 300 })).toEqual({ width: 400, height: 300 })
  })
  it('top: centered at the top of the work area', () => {
    expect(placeIsland({ wa: { ...wa, y: 40 }, width: 500, height: 660, place: 'top', pos, sidePillY: 40 })).toEqual({ x: 710, y: 40 })
  })
  it('never goes above the screen when the window is taller than the space', () => {
    const short = { x: 0, y: 30, width: 1280, height: 500 }
    const p = placeIsland({ wa: short, width: 500, height: 759, place: 'free', pos: { cx: 0.5, top: 900, cy: 0.5 }, sidePillY: 40 })
    expect(p.y).toBe(30)
    const side = placeIsland({ wa: short, width: 500, height: 759, place: 'right', pos: { cx: 0.5, top: 0, cy: 0.1 }, sidePillY: 46 })
    expect(side).toEqual({ x: 780, y: 30 })
  })
  it('works on a second screen to the left (negative x)', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 }
    expect(placeIsland({ wa: left, width: 500, height: 660, place: 'left', pos, sidePillY: 40 }).x).toBe(-1920)
    expect(placeIsland({ wa: left, width: 500, height: 660, place: 'free', pos: { cx: 0, top: 100, cy: 0 }, sidePillY: 40 })).toEqual({ x: -1920, y: 100 })
  })
})

describe('click areas', () => {
  it('reads the new list and the old single rect', () => {
    expect(hotRects({ rects: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 'no' }] })).toEqual([{ x: 1, y: 2, w: 3, h: 4 }])
    expect(hotRects({ x: 10, y: 20, width: 30, height: 40 })).toEqual([{ x: 10, y: 20, w: 30, h: 40 }])
    expect(hotRects({ rects: [] })).toEqual([])
    expect(hotRects(null)).toBeNull()
    expect(hotRects({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull()
  })
  it('turns CSS pixels into window pixels with the real zoom', () => {
    expect(rectsToDip([{ x: 100, y: 10, w: 200, h: 40 }], 1.25)).toEqual([{ x: 125, y: 12.5, w: 250, h: 50 }])
    expect(rectsToDip([{ x: 100, y: 10, w: 200, h: 40 }], 0)).toEqual([{ x: 100, y: 10, w: 200, h: 40 }])
  })
  it('knows when the pointer is over an area', () => {
    const r = [{ x: 100, y: 10, w: 200, h: 40 }, { x: 0, y: 300, w: 50, h: 50 }]
    expect(overRects(150, 30, r)).toBe(true)
    expect(overRects(97, 30, r)).toBe(true)
    expect(overRects(90, 30, r)).toBe(false)
    expect(overRects(20, 320, r)).toBe(true)
    expect(overRects(150, 30, [{ x: 100, y: 10, w: 0, h: 40 }])).toBe(false)
  })
})

describe('shortcuts', () => {
  it('spots Ctrl+Alt combos (AltGr on Windows)', () => {
    expect(isAltGrCombo('Control+Alt+Q')).toBe(true)
    expect(isAltGrCombo('Control+Alt+Space')).toBe(true)
    expect(isAltGrCombo('Control+Shift+Space')).toBe(false)
    expect(isAltGrCombo('Alt+Q')).toBe(false)
  })
  it('moves old Ctrl+Alt shortcuts once, keeps the rest', () => {
    expect(migrateShortcuts({ shortcut: 'Control+Alt+Space', quietShortcut: 'Control+Alt+Q' }, 0)).toEqual({ shortcut: 'Control+Shift+Space', quietShortcut: 'Alt+Shift+Q' })
    expect(migrateShortcuts({ shortcut: 'Control+Alt+L', quietShortcut: '' }, 1)).toEqual({ shortcut: 'Control+Shift+Space', quietShortcut: '' })
    expect(migrateShortcuts({ shortcut: 'Alt+Q', quietShortcut: 'Control+Shift+Q' }, 0)).toEqual({ shortcut: 'Alt+Q', quietShortcut: 'Control+Shift+Q' })
    // Chosen again after the move: kept.
    expect(migrateShortcuts({ shortcut: 'Control+Alt+Space', quietShortcut: 'Control+Alt+Q' }, 2)).toEqual({ shortcut: 'Control+Alt+Space', quietShortcut: 'Control+Alt+Q' })
  })
  it('cleans the PC-only settings', () => {
    expect(cleanDeskPrefs(null)).toMatchObject({ fullscreen: 'hide', captureShortcut: 'Alt+Shift+N', voiceShortcut: 'Alt+Shift+B' })
    expect(cleanDeskPrefs({ fullscreen: 'dot', captureShortcut: '', voiceShortcut: 'nope' })).toMatchObject({ fullscreen: 'dot', captureShortcut: '', voiceShortcut: 'Alt+Shift+B' })
  })
})

describe('the Windows watcher', () => {
  it('reads its lines', () => {
    expect(parseWatcherLine('qs=5 media=0')).toEqual({ qs: 5, media: false, fs: null, app: null })
    expect(parseWatcherLine('qs=2 media=1 fs=-960,540 app=chrome|Lofi - YouTube')).toEqual({ qs: 2, media: true, fs: { x: -960, y: 540 }, app: { proc: 'chrome', title: 'Lofi - YouTube' } })
    expect(parseWatcherLine('qs=5 media=0 app=code|')).toEqual({ qs: 5, media: false, fs: null, app: { proc: 'code', title: null } })
    expect(parseWatcherLine('hello')).toBeNull()
  })
  it('counts the real seconds between looks', () => {
    expect(sampleSeconds(10_000, 0)).toBe(4)
    expect(sampleSeconds(20_000, 10_000)).toBe(10)
    expect(sampleSeconds(100_000, 10_000)).toBe(15)
  })
})

describe('small helpers', () => {
  it('rate-limits log lines per key', () => {
    const ok = rateLimit(2000)
    expect(ok('a', 0)).toBe(true)
    expect(ok('a', 1000)).toBe(false)
    expect(ok('b', 1000)).toBe(true)
    expect(ok('a', 2500)).toBe(true)
  })
  it('ends a drag that stopped moving', () => {
    expect(dragStale({ now: 5000, lastMove: 0, startedAt: 0 })).toBe(false)
    expect(dragStale({ now: 10_001, lastMove: 0, startedAt: 0 })).toBe(true)
    expect(dragStale({ now: 130_000, lastMove: 129_000, startedAt: 0 })).toBe(true)
  })
})

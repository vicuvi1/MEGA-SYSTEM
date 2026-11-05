// The island's placement, screens and per-PC settings (IF1, IF2, IF3, IF6, IP5).
import { describe, expect, it } from 'vitest'
import {
  chooseDisplay, cleanDeskPrefs, displayKey, displayLabel, followTick, hideOverApp, islandBase, isPlacement, noteRecentApp, parseWatcherLine, placeIsland,
  rememberLayout, LAYOUTS_MAX, type IslandLayout
} from './islandWin'

const wa = { x: 0, y: 0, width: 1920, height: 1040 }
const pos = { cx: 0.5, top: 0, cy: 0.5 }

describe('positions (IF1)', () => {
  it('top left, center and right sit at the top edge', () => {
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top-left', pos, sidePillY: 40 })).toEqual({ x: 0, y: 0 })
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top', pos, sidePillY: 40 })).toEqual({ x: 710, y: 0 })
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top-right', pos, sidePillY: 40 })).toEqual({ x: 1420, y: 0 })
  })
  it('adds your exact offset and still stays on the screen', () => {
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top', pos, sidePillY: 40, offset: { x: 30, y: 12 } })).toEqual({ x: 740, y: 12 })
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top-right', pos, sidePillY: 40, offset: { x: 300, y: -50 } })).toEqual({ x: 1420, y: 0 })
    expect(placeIsland({ wa, width: 500, height: 660, place: 'top-left', pos, sidePillY: 40, offset: { x: 24, y: 8 } })).toEqual({ x: 24, y: 8 })
    // A second screen on the left (negative x) works the same.
    const left = { x: -1920, y: 0, width: 1920, height: 1040 }
    expect(placeIsland({ wa: left, width: 500, height: 660, place: 'top-right', pos, sidePillY: 40 })).toEqual({ x: -500, y: 0 })
  })
  it('knows the positions', () => {
    expect(['top', 'top-left', 'top-right', 'left', 'right', 'free'].every(isPlacement)).toBe(true)
    expect(isPlacement('bottom')).toBe(false)
  })
})

describe('size (IF3)', () => {
  it('the window is wide enough for your widest view', () => {
    expect(islandBase({ peekWidth: 400, panelWidth: 460 })).toEqual({ width: 500, height: 660 })
    expect(islandBase({ peekWidth: 400, panelWidth: 620 })).toEqual({ width: 660, height: 660 })
    expect(islandBase({})).toEqual({ width: 500, height: 660 })
  })
})

describe('which screen (IF2)', () => {
  const base = { ids: [1, 2, 3], primaryId: 1, savedId: 2, followId: null, currentId: null }
  it('fixed, main, or follow', () => {
    expect(chooseDisplay({ ...base, mode: 'fixed' })).toBe(2)
    expect(chooseDisplay({ ...base, mode: 'fixed', savedId: 9 })).toBe(1)
    expect(chooseDisplay({ ...base, mode: 'main' })).toBe(1)
    expect(chooseDisplay({ ...base, mode: 'mouse', followId: 3 })).toBe(3)
    expect(chooseDisplay({ ...base, mode: 'window', followId: null, currentId: 2 })).toBe(2)
    expect(chooseDisplay({ ...base, mode: 'mouse', followId: 7, currentId: 7 })).toBe(1)
  })
  it('moves only once the new screen has held for a moment', () => {
    let st = { candidate: null as number | null, since: 0 }
    let r = followTick(st, 2, 1, 0)
    expect(r.moveTo).toBeNull()
    st = r.st
    r = followTick(st, 2, 1, 1000)
    expect(r.moveTo).toBeNull()
    r = followTick(r.st, 2, 1, 2000)
    expect(r.moveTo).toBe(2)
    // A quick trip across and back doesn't move it.
    r = followTick({ candidate: null, since: 0 }, 2, 1, 0)
    r = followTick(r.st, 1, 1, 1000)
    expect(r.st.candidate).toBeNull()
    r = followTick(r.st, 2, 1, 1600)
    expect(r.moveTo).toBeNull()
  })
})

describe('layouts per set of screens (IP5)', () => {
  const laptop = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  const docked = [{ id: 7, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }, ...laptop]
  it('the same set of screens gives the same key, whatever the order', () => {
    expect(displayKey(docked)).toBe(displayKey([...docked].reverse()))
    expect(displayKey(docked)).not.toBe(displayKey(laptop))
    expect(displayKey(laptop)).toBe('1:1920x1080')
  })
  it('remembers up to 8 setups, the newest last', () => {
    const l: IslandLayout = { place: 'top-right', pos, offset: { x: 0, y: 0 }, displayId: 7 }
    let all: Record<string, IslandLayout> = {}
    for (let i = 0; i < 10; i++) all = rememberLayout(all, `k${i}`, l)
    expect(Object.keys(all)).toHaveLength(LAYOUTS_MAX)
    expect(Object.keys(all).at(-1)).toBe('k9')
    all = rememberLayout(all, 'k5', { ...l, place: 'left' })
    expect(Object.keys(all).at(-1)).toBe('k5')
    expect(all.k5.place).toBe('left')
  })
  it('labels screens for people', () => {
    expect(displayLabel({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }, 0)).toBe('Screen 1 · 1920 × 1080 (main)')
  })
})

describe('apps it hides over (IF6)', () => {
  it('hides when one of your apps is in front on its screen', () => {
    expect(hideOverApp({ proc: 'VLC', hideApps: ['vlc'], onIslandScreen: true })).toBe(true)
    expect(hideOverApp({ proc: 'vlc', hideApps: ['vlc'], onIslandScreen: false })).toBe(false)
    expect(hideOverApp({ proc: 'chrome', hideApps: ['vlc'], onIslandScreen: true })).toBe(false)
    expect(hideOverApp({ proc: null, hideApps: ['vlc'], onIslandScreen: true })).toBe(false)
  })
  it('keeps a short list of recent apps, newest first, without itself', () => {
    let l: string[] = []
    for (const p of ['chrome', 'Code', 'explorer', 'Life System', 'chrome.exe']) l = noteRecentApp(l, p)
    expect(l).toEqual(['chrome', 'code'])
  })
  it('reads the program in front and its screen from the watcher', () => {
    expect(parseWatcherLine('qs=5 media=0 fgm=2880,720 fgp=vlc app=vlc|movie fgp=nope')).toMatchObject({ fg: { x: 2880, y: 720 }, proc: 'vlc' })
    expect(parseWatcherLine('qs=5 media=0')!.proc).toBeUndefined()
  })
})

describe('PC-only settings', () => {
  it('cleans offset, screen mode, apps, layouts and any real shortcut', () => {
    const p = cleanDeskPrefs({
      offset: { x: 12.4, y: 'a' }, monitor: 'mouse', perScreen: false, hideApps: ['VLC.exe', 'vlc', '', 42], captureShortcut: 'ctrl+shift+k', voiceShortcut: 'Shift+K',
      layouts: { a: { place: 'top-left', pos: { cx: 2 }, offset: { x: 1, y: 2 }, displayId: 3 }, b: { place: 'nowhere' } }
    })
    expect(p.offset).toEqual({ x: 12, y: 0 })
    expect(p.monitor).toBe('mouse')
    expect(p.perScreen).toBe(false)
    expect(p.hideApps).toEqual(['vlc', '42'])
    expect(p.captureShortcut).toBe('Control+Shift+K')
    expect(p.voiceShortcut).toBe('Alt+Shift+B')
    expect(Object.keys(p.layouts)).toEqual(['a'])
    expect(p.layouts.a.pos.cx).toBe(1)
  })
})

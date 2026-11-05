// Island 2: your own tiles, buttons, shortcuts and colours (made-up data).
import { describe, expect, it } from 'vitest'
import {
  addButton, addTile, bumpCount, buttonAction, buttonText, cleanKit, countOf, DEFAULT_KIT, kitShortcuts, lookClasses, moveItem, registrable, removeButton,
  removeTile, safeHttps, seasonOf, shortcutConflicts, tileAction, TILES_MAX, updateTile
} from './islandTiles'

let r = 0
const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)

describe('tiles (IN34)', () => {
  it('adds each kind, with sensible defaults', () => {
    let k = DEFAULT_KIT
    k = addTile(k, { kind: 'counter', label: 'Coffee' }, rand)
    k = addTile(k, { kind: 'timer', minutes: 50 }, rand)
    k = addTile(k, { kind: 'exercise', name: 'Squats', n: 20 }, rand)
    k = addTile(k, { kind: 'water' }, rand)
    k = addTile(k, { kind: 'link', url: 'https://example.com/course' }, rand)
    k = addTile(k, { kind: 'page', page: 'money' }, rand)
    k = addTile(k, { kind: 'note', text: 'Stand up straight' }, rand)
    expect(k.tiles.map((t) => t.kind)).toEqual(['counter', 'timer', 'exercise', 'water', 'link', 'page', 'note'])
    expect(k.tiles[1].minutes).toBe(50)
    expect(k.tiles[3].n).toBe(250)
    expect(new Set(k.tiles.map((t) => t.id)).size).toBe(7)
  })
  it('refuses broken ones: no http links, no unknown pages, no nameless exercise', () => {
    expect(addTile(DEFAULT_KIT, { kind: 'link', url: 'http://example.com' }).tiles).toEqual([])
    expect(addTile(DEFAULT_KIT, { kind: 'link', url: 'javascript:alert(1)' }).tiles).toEqual([])
    expect(addTile(DEFAULT_KIT, { kind: 'page', page: 'admin' }).tiles).toEqual([])
    expect(addTile(DEFAULT_KIT, { kind: 'exercise', name: '' }).tiles).toEqual([])
    expect(safeHttps('https://user:pw@example.com')).toBeNull()
  })
  it('keeps at most 16', () => {
    let k = DEFAULT_KIT
    for (let i = 0; i < 20; i++) k = addTile(k, { kind: 'water' }, rand)
    expect(k.tiles).toHaveLength(TILES_MAX)
  })
  it('reorders and removes (and forgets its count)', () => {
    let k = cleanKit({ tiles: [{ id: 'a', kind: 'counter' }, { id: 'b', kind: 'water' }, { id: 'c', kind: 'note' }] })
    expect(moveItem(k.tiles, 'c', -1).map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(moveItem(k.tiles, 'a', -1).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    k = bumpCount(k, 'a', 1, '2026-11-05')
    k = removeTile(k, 'a')
    expect(k.tiles.map((t) => t.id)).toEqual(['b', 'c'])
    expect(k.counts).toEqual({})
  })
  it('edits a tile and keeps it valid', () => {
    const k = cleanKit({ tiles: [{ id: 'a', kind: 'timer', minutes: 25 }] })
    expect(updateTile(k, 'a', { minutes: 999 }).tiles[0].minutes).toBe(180)
    expect(updateTile(k, 'a', { kind: 'link' } as any).tiles[0].kind).toBe('timer')
  })
  it('counters count today and start at 0 on a new day', () => {
    let k = cleanKit({ tiles: [{ id: 'a', kind: 'counter', n: 2 }] })
    k = bumpCount(k, 'a', 2, '2026-11-05')
    k = bumpCount(k, 'a', 2, '2026-11-05')
    expect(countOf(k, 'a', '2026-11-05')).toBe(4)
    expect(countOf(k, 'a', '2026-11-06')).toBe(0)
    expect(countOf(bumpCount(k, 'a', -9, '2026-11-05'), 'a', '2026-11-05')).toBe(0)
  })
  it('a tap goes through the normal paths', () => {
    const k = cleanKit({ tiles: [{ id: 'a', kind: 'exercise', name: 'Push-ups', n: 10 }, { id: 'b', kind: 'timer', label: 'Deep work', minutes: 50 }, { id: 'c', kind: 'note', text: 'x' }, { id: 'd', kind: 'link', url: 'https://example.com' }] })
    expect(tileAction(k.tiles[0], 'tap1')).toEqual({ id: 'tap1', kind: 'reps', ex: 'push-ups', name: 'Push-ups', n: 10 })
    expect(tileAction(k.tiles[0], 'tap1', { exId: 'ex7' })).toMatchObject({ ex: 'ex7' })
    expect(tileAction(k.tiles[1], 'tap2')).toEqual({ id: 'tap2', kind: 'start', subject: 'Deep work', minutes: 50 })
    expect(tileAction(k.tiles[2], 'tap3')).toBeNull()
    expect(tileAction(k.tiles[3], 'tap4')).toEqual({ kind: 'kitLink', url: 'https://example.com/' })
  })
})

describe('your own buttons (IN35)', () => {
  it('names itself and logs through reps or water, undoable by its tap id', () => {
    let k = DEFAULT_KIT
    k = addButton(k, { act: { do: 'reps', name: 'squats', n: 25 } }, rand)
    k = addButton(k, { act: { do: 'hold', name: 'Plank', sec: 60 } }, rand)
    k = addButton(k, { act: { do: 'walk', min: 10 } }, rand)
    k = addButton(k, { act: { do: 'water', ml: 330 }, ring: true }, rand)
    expect(k.buttons.map((b) => b.label)).toEqual(['+25 squats', 'Plank 60 s', 'Walk 10 min', '+330 ml'])
    expect(buttonAction(k.buttons[0], 'u1')).toEqual({ id: 'u1', kind: 'reps', ex: 'squats', name: 'squats', n: 25 })
    expect(buttonAction(k.buttons[1], 'u2')).toMatchObject({ kind: 'reps', name: 'Plank (seconds)', n: 60 })
    expect(buttonAction(k.buttons[2], 'u3')).toMatchObject({ kind: 'reps', name: 'Walk (minutes)', n: 10 })
    expect(buttonAction(k.buttons[3], 'u4')).toEqual({ id: 'u4', kind: 'water', ml: 330 })
    expect(k.buttons[3].ring).toBe(true)
    expect(removeButton(k, k.buttons[0].id).buttons).toHaveLength(3)
  })
  it('refuses made-up kinds and clamps the numbers', () => {
    expect(addButton(DEFAULT_KIT, { act: { do: 'coins', n: 1e9 } as any }).buttons).toEqual([])
    expect(buttonText(addButton(DEFAULT_KIT, { act: { do: 'reps', name: 'jumps', n: 99999 } }).buttons[0].act)).toBe('+500 jumps')
  })
})

describe('shortcuts per tile (IN41)', () => {
  const k = cleanKit({
    tiles: [{ id: 'a', kind: 'water', shortcut: 'ctrl+shift+w' }, { id: 'b', kind: 'counter', shortcut: 'Control+Shift+W' }, { id: 'c', kind: 'note', shortcut: 'nonsense' }],
    buttons: [{ id: 'x', act: { do: 'reps', name: 'push-ups', n: 10 }, shortcut: 'Control+Alt+P' }, { id: 'y', act: { do: 'walk', min: 10 }, shortcut: 'Control+Shift+Space' }]
  })
  it('keeps only real shortcuts', () => {
    expect(kitShortcuts(k).map((s) => s.id)).toEqual(['a', 'b', 'x', 'y'])
  })
  it('finds clashes: twice the same, the island\'s own, AltGr', () => {
    const p = shortcutConflicts(kitShortcuts(k), [{ accelerator: 'Control+Shift+Space', what: 'open the island' }])
    expect(p.map((x) => [x.id, x.why.split(' ')[0]])).toEqual([['b', 'used'], ['x', 'Ctrl+Alt+letter'], ['y', 'already']])
    expect(registrable(kitShortcuts(k), p).map((s) => s.id)).toEqual(['a', 'x'])
  })
})

describe('colours (IN40)', () => {
  it('a colour set, high contrast and the season', () => {
    expect(lookClasses({ palette: 'lime', contrast: false, seasonal: false }, new Date(2026, 0, 1))).toBe('')
    expect(lookClasses({ palette: 'ocean', contrast: true, seasonal: true }, new Date(2026, 6, 1))).toBe('acc-ocean hi-contrast season-summer')
    expect([0, 3, 6, 9, 11].map((m) => seasonOf(new Date(2026, m, 5)))).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter'])
  })
  it('a saved kit with junk comes back clean', () => {
    const k = cleanKit({ look: { palette: 'neon' }, dock: { on: 'yes' }, clipboard: 1, tiles: 'x', counts: { z: { day: 'bad', n: 3 } } })
    expect(k.look.palette).toBe('lime')
    expect(k.dock.on).toBe(false)
    expect(k.clipboard).toBe(false)
    expect(k.tiles).toEqual([])
    expect(k.counts).toEqual({})
  })
})

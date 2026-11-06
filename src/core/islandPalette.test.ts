import { describe, expect, it } from 'vitest'
import { cleanPower, cyclePower, filterPalette, pageKey, paletteItems, POWER_DEFAULT, startsTyping, type PaletteCtx } from './islandPalette'

const ctx: PaletteCtx = {
  pages: [{ id: 'day', title: 'Day', icon: '☀️' }, { id: 'music', title: 'Music', icon: '🎵' }, { id: 'system', title: 'System', icon: '🖥️' }],
  autos: [{ id: 'a1', name: 'Study mode', icon: '📚', fields: 0 }, { id: 'a2', name: 'Send a link', icon: '🔗', fields: 1 }],
  stations: [{ id: 's1', name: 'Lo-fi beats' }],
  chips: { water: [250, 500], reps: [10], focus: [25] },
  reps: [{ id: 'push', name: 'Push-ups' }],
  running: false,
  playing: false,
  musicLoaded: true
}

describe('the power row', () => {
  it('keeps four different slots and fills the rest with the defaults', () => {
    expect(cleanPower(null)).toEqual(POWER_DEFAULT)
    expect(cleanPower(['music', 'music', 'nope', 'ben'])).toEqual(['music', 'ben', 'focus', 'water'])
    expect(cleanPower(['focus', 'water', 'note', 'auto', 'reps'])).toHaveLength(4)
  })
  it('editing a slot moves it to the next action not already in the row', () => {
    expect(cyclePower(['focus', 'water', 'note', 'auto'], 0)).toEqual(['reps', 'water', 'note', 'auto'])
    expect(cyclePower(['focus', 'water', 'note', 'auto'], 3)).toEqual(['focus', 'water', 'note', 'reps'])
  })
})

describe('the palette', () => {
  const items = paletteItems(ctx)
  it('offers pages with their number keys, logs, automations, stations and island steps', () => {
    expect(items.find((x) => x.id === 'page:music')?.hint).toBe('2')
    expect(items.some((x) => x.id === 'do:water500')).toBe(true)
    expect(items.some((x) => x.id === 'do:reps10' && x.label === 'Log 10 Push-ups')).toBe(true)
    expect(items.find((x) => x.id === 'auto:a1')?.run).toEqual({ kind: 'tap', action: { kind: 'auto', op: 'run', id: 'a1' }, label: 'Study mode' })
    // One that asks for values opens the Day page, where its little form is.
    expect(items.find((x) => x.id === 'auto:a2')?.run).toEqual({ kind: 'page', id: 'day' })
    expect(items.some((x) => x.id === 'st:s1')).toBe(true)
  })
  it('a running timer offers stop and +5 instead of starting one', () => {
    const r = paletteItems({ ...ctx, running: true })
    expect(r.some((x) => x.id === 'do:stop')).toBe(true)
    expect(r.some((x) => x.id.startsWith('do:focus'))).toBe(false)
  })
  it('finds entries by the start of their words, best match first', () => {
    expect(filterPalette(items, 'sys')[0].id).toBe('page:system')
    expect(filterPalette(items, 'water 500')[0].id).toBe('do:water500')
    expect(filterPalette(items, 'lo-fi').some((x) => x.id === 'st:s1')).toBe(true)
    expect(filterPalette(items, 'quiet')[0].id).toBe('ui:quiet')
    expect(filterPalette(items, 'zzzz')).toEqual([])
  })
  it('nothing typed: pages and quick actions', () => {
    const d = filterPalette(items, '')
    expect(d[0].id).toBe('page:day')
    expect(d.every((x) => x.group !== 'Island')).toBe(true)
  })
})

describe('keys', () => {
  it('1–9 jump to a page that exists', () => {
    expect(pageKey('1', 3)).toBe(0)
    expect(pageKey('3', 3)).toBe(2)
    expect(pageKey('4', 3)).toBeNull()
    expect(pageKey('a', 3)).toBeNull()
  })
  it('letters start typing; digits, "/", brackets and shortcuts do not', () => {
    const none = { ctrl: false, alt: false, meta: false }
    expect(startsTyping('w', none)).toBe(true)
    expect(startsTyping('?', none)).toBe(true)
    expect(startsTyping('5', none)).toBe(false)
    expect(startsTyping('/', none)).toBe(false)
    expect(startsTyping(']', none)).toBe(false)
    expect(startsTyping('Enter', none)).toBe(false)
    expect(startsTyping('w', { ...none, ctrl: true })).toBe(false)
  })
})

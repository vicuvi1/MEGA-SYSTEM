import { describe, expect, it, vi } from 'vitest'
import { bindQuick, cleanQuickShortcut, keyLabel, quickBounds, QUICK_DEFAULT, QUICK_FALLBACK, type ShortcutApi } from './quickKeys'

/** A fake globalShortcut: `taken` are held by other apps (register says no). */
function fakeGs(taken: string[] = []) {
  const mine = new Map<string, () => void>()
  const gs: ShortcutApi & { mine: Map<string, () => void>; press(acc: string): void } = {
    mine,
    register: vi.fn((acc: string, fn: () => void) => {
      if (taken.includes(acc) || mine.has(acc)) return false
      mine.set(acc, fn)
      return true
    }),
    unregister: vi.fn((acc: string) => void mine.delete(acc)),
    isRegistered: vi.fn((acc: string) => mine.has(acc)),
    press: (acc: string) => mine.get(acc)?.()
  }
  return gs
}

describe('quick add shortcut', () => {
  it('registers Alt+Space by default and the press opens the box', () => {
    const gs = fakeGs()
    const open = vi.fn()
    const r = bindQuick(gs, QUICK_DEFAULT, open, null)
    expect(r).toEqual({ active: 'Alt+Space', fellBack: false, tried: ['Alt+Space'] })
    gs.press('Alt+Space')
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('falls back to Ctrl+Shift+Space when another app has it', () => {
    const gs = fakeGs(['Alt+Space'])
    expect(bindQuick(gs, QUICK_DEFAULT, () => {}, null)).toMatchObject({ active: QUICK_FALLBACK, fellBack: true })
  })
  it('never takes a shortcut the island owns, or a Ctrl+Alt (AltGr) one', () => {
    expect(bindQuick(fakeGs(), 'Alt+Shift+Space', () => {}, null, ['Alt+Shift+Space'])).toMatchObject({ active: QUICK_FALLBACK, fellBack: true })
    expect(bindQuick(fakeGs(), 'Control+Alt+Q', () => {}, null)).toMatchObject({ active: QUICK_FALLBACK })
  })
  it('both taken: off, and says what it tried', () => {
    const gs = fakeGs(['Alt+Space', QUICK_FALLBACK])
    expect(bindQuick(gs, QUICK_DEFAULT, () => {}, null)).toEqual({ active: null, fellBack: false, tried: ['Alt+Space', QUICK_FALLBACK] })
  })
  it('a change releases the old one first; "" turns it off', () => {
    const gs = fakeGs()
    bindQuick(gs, QUICK_DEFAULT, () => {}, null)
    const r = bindQuick(gs, 'Alt+Shift+Q', () => {}, 'Alt+Space')
    expect(gs.unregister).toHaveBeenCalledWith('Alt+Space')
    expect(r.active).toBe('Alt+Shift+Q')
    expect([...gs.mine.keys()]).toEqual(['Alt+Shift+Q'])
    expect(bindQuick(gs, '', () => {}, 'Alt+Shift+Q').active).toBeNull()
    expect(gs.mine.size).toBe(0)
  })
  it('a register that throws is a "no", never a crash', () => {
    const gs = fakeGs()
    gs.register = () => {
      throw new Error('bad accelerator')
    }
    expect(bindQuick(gs, QUICK_DEFAULT, () => {}, null).active).toBeNull()
  })
  it('cleans saved choices', () => {
    expect(cleanQuickShortcut('alt+space')).toBe('Alt+Space')
    expect(cleanQuickShortcut('')).toBe('')
    expect(cleanQuickShortcut('nonsense+++')).toBe(QUICK_DEFAULT)
    expect(cleanQuickShortcut(undefined)).toBe(QUICK_DEFAULT)
    expect(keyLabel('Control+Shift+Space')).toBe('Ctrl+Shift+Space')
    expect(keyLabel(null)).toBe('Off')
  })
  it('places the box centered near the top third, the toast at the bottom', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(quickBounds('box', area)).toEqual({ x: 630, y: 229, width: 660, height: 200 })
    const t = quickBounds('toast', area)
    expect(t.x + t.width / 2).toBe(960)
    expect(t.y + t.height).toBeLessThanOrEqual(1040)
    expect(quickBounds('box', { x: 1920, y: 0, width: 400, height: 800 }).width).toBe(368)
  })
})

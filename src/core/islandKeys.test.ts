import { describe, expect, it } from 'vitest'
import { isAltGrCombo, keyLabel, normalizeAccelerator, pressToAccelerator, shortcutClash } from './islandKeys'

const press = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}, key = '') => ({ key: key || code, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

describe('island shortcuts (IF9)', () => {
  it('accepts any real shortcut, written one way', () => {
    expect(normalizeAccelerator('ctrl+shift+k')).toBe('Control+Shift+K')
    expect(normalizeAccelerator('Shift+Alt+Space')).toBe('Alt+Shift+Space')
    expect(normalizeAccelerator('CommandOrControl+F5')).toBe('Control+F5')
    expect(normalizeAccelerator('Super+Alt+1')).toBe('Alt+Super+1')
    expect(normalizeAccelerator('Control++')).toBe('Control+Plus')
    expect(normalizeAccelerator('F13')).toBe('F13')
  })
  it('refuses what would break typing or is not a shortcut', () => {
    for (const bad of ['K', 'Shift+K', 'F5', 'Control+Shift', 'Control+K+J', 'Control+Control+K', 'Control+Hack', '', 'Control+', 42, null]) expect(normalizeAccelerator(bad)).toBeNull()
  })
  it('records a key press by its physical key', () => {
    expect(pressToAccelerator(press('ControlLeft', { ctrlKey: true }, 'Control'))).toEqual({ waiting: true })
    expect(pressToAccelerator(press('KeyN', { altKey: true, shiftKey: true }, 'N'))).toEqual({ accelerator: 'Alt+Shift+N' })
    // A German keyboard types "z" for KeyY: the shortcut is the key Windows registers.
    expect(pressToAccelerator(press('KeyY', { ctrlKey: true }, 'z'))).toEqual({ accelerator: 'Control+Y' })
    expect(pressToAccelerator(press('Space', { ctrlKey: true, shiftKey: true }, ' '))).toEqual({ accelerator: 'Control+Shift+Space' })
    expect(pressToAccelerator(press('KeyK', { shiftKey: true }, 'K'))).toMatchObject({ invalid: expect.stringContaining('Shift alone') })
    expect(pressToAccelerator(press('KeyK', {}, 'k'))).toMatchObject({ invalid: expect.any(String) })
  })
  it('warns about Ctrl+Alt+letter (AltGr) and clashes', () => {
    expect(isAltGrCombo('Control+Alt+Q')).toBe(true)
    expect(isAltGrCombo('Control+Alt+Shift+Q')).toBe(false)
    expect(shortcutClash('ctrl+shift+space', ['Alt+Shift+Q', 'Control+Shift+Space'])).toBe(true)
    expect(shortcutClash('', ['', ''])).toBe(false)
    expect(keyLabel('Control+Super+K')).toBe('Ctrl + Win + K')
  })
})

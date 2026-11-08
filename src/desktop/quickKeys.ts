// Quick add's global shortcut and window place (pure, tested in quickKeys.test.ts).
// Alt+Space by default; when another app already has it (or you picked one the
// island uses), Ctrl+Shift+Space is used instead and Settings says so.
import { isAltGrCombo, normalizeAccelerator } from '../core/islandKeys'

export const QUICK_DEFAULT = 'Alt+Space'
export const QUICK_FALLBACK = 'Control+Shift+Space'
export const QUICK_CHOICES = [QUICK_DEFAULT, QUICK_FALLBACK, 'Alt+Shift+Space', 'Alt+Shift+Q', ''] as const

/** The part of Electron's globalShortcut this needs (a fake in tests). */
export interface ShortcutApi {
  register(accelerator: string, fn: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

export interface BindResult {
  /** The shortcut that works now, or null (off, or every choice was taken). */
  active: string | null
  /** True when yours was taken and the fallback is used. */
  fellBack: boolean
  /** Every accelerator tried, in order. */
  tried: string[]
}

/** A saved choice, cleaned: '' = off, a real accelerator, else the default. */
export function cleanQuickShortcut(v: unknown): string {
  if (v === '') return ''
  return normalizeAccelerator(v) ?? QUICK_DEFAULT
}

const same = (a: string, b: string) => a.toLowerCase().replace(/ctrl/g, 'control') === b.toLowerCase().replace(/ctrl/g, 'control')

/**
 * Registers quick add's shortcut: yours first, then the fallback. `current` is
 * released first; `avoid` are shortcuts other parts of the app own (the island's).
 * Never throws.
 */
export function bindQuick(gs: ShortcutApi, wanted: string, onPress: () => void, current: string | null, avoid: string[] = []): BindResult {
  if (current) {
    try {
      gs.unregister(current)
    } catch {
      /* already gone */
    }
  }
  const tried: string[] = []
  if (!wanted) return { active: null, fellBack: false, tried }
  const list = [wanted, QUICK_FALLBACK].filter((a, i, all) => a && all.findIndex((b) => same(a, b)) === i)
  for (const acc of list) {
    tried.push(acc)
    // The island's own shortcuts, and Ctrl+Alt+<key> (AltGr types @, ł, € with it on many keyboards).
    if (avoid.some((a) => a && same(a, acc)) || isAltGrCombo(acc)) continue
    let ok = false
    try {
      ok = !gs.isRegistered(acc) && gs.register(acc, onPress)
    } catch {
      ok = false
    }
    if (ok) return { active: acc, fellBack: !same(acc, wanted), tried }
  }
  return { active: null, fellBack: false, tried }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const BOX_SIZE = { width: 660, height: 200 }
export const TOAST_SIZE = { width: 480, height: 76 }

/** Where the window goes: the box near the top third of the screen the mouse is on; the toast at its bottom center. */
export function quickBounds(mode: 'box' | 'toast', area: Rect): Rect {
  const size = mode === 'box' ? BOX_SIZE : TOAST_SIZE
  const width = Math.min(size.width, Math.max(320, area.width - 32))
  const x = Math.round(area.x + (area.width - width) / 2)
  const y = mode === 'box' ? Math.round(area.y + area.height * 0.22) : Math.round(area.y + area.height - size.height - 24)
  return { x, y, width, height: size.height }
}

/** Shown as "Alt+Space" / "Ctrl+Shift+Space" in Settings and the tray. */
export const keyLabel = (acc: string | null) => (acc ? acc.replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl') : 'Off')

// Keyboard shortcuts for the desktop island, as Electron "accelerators"
// ("Control+Shift+Space"). Pure, so the settings page (recording a shortcut)
// and the desktop (registering it) check them the same way.

/** The modifiers, in the order they are written. */
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super'] as const
type Mod = (typeof MOD_ORDER)[number]
const MOD_ALIASES: Record<string, Mod> = {
  control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  super: 'Super', meta: 'Super', win: 'Super', cmd: 'Super', command: 'Super'
}

/** Keys a global shortcut may use (a safe part of what Electron knows). */
const NAMED_KEYS: Record<string, string> = {
  space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', enter: 'Enter', return: 'Enter',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  plus: 'Plus'
}
const PUNCT = [',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`']
const NUMPAD = /^num([0-9])$/i
const FKEY = /^f([1-9]|1[0-9]|2[0-4])$/i

/** One key (not a modifier) in its written form, or null when not allowed. */
function keyName(k: string): string | null {
  if (!k) return null
  if (/^[a-z]$/i.test(k)) return k.toUpperCase()
  if (/^[0-9]$/.test(k)) return k
  const f = FKEY.exec(k)
  if (f) return `F${f[1]}`
  const n = NUMPAD.exec(k)
  if (n) return `num${n[1]}`
  if (PUNCT.includes(k)) return k
  return NAMED_KEYS[k.toLowerCase()] ?? null
}

/**
 * "ctrl+shift+n" → "Control+Shift+N"; null when it isn't a shortcut the
 * island may take: exactly one key, known modifiers, and at least one of
 * Ctrl, Alt or Win (Shift alone types capitals). F13–F24 may stand alone.
 */
export function normalizeAccelerator(acc: unknown): string | null {
  if (typeof acc !== 'string' || !acc || acc.length > 60) return null
  // "Control++" means Control and the plus key.
  const parts = acc.replace(/\+\+$/, '+Plus').split('+').map((p) => p.trim())
  if (parts.some((p) => !p)) return null
  const mods = new Set<Mod>()
  let key: string | null = null
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()]
    if (m) {
      if (mods.has(m)) return null
      mods.add(m)
      continue
    }
    if (key) return null
    key = keyName(p)
    if (!key) return null
  }
  if (!key) return null
  const strong = mods.has('Control') || mods.has('Alt') || mods.has('Super')
  const lonely = /^F(1[3-9]|2[0-4])$/.test(key)
  if (!strong && !lonely) return null
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')
}

/** Ctrl+Alt+<key> without Shift/Win: what AltGr types on many keyboards (@, ł, €…). */
export const isAltGrCombo = (acc: string) => {
  const parts = acc.split('+').map((p) => p.trim().toLowerCase())
  const ctrl = parts.some((p) => p === 'control' || p === 'ctrl' || p === 'commandorcontrol' || p === 'cmdorctrl')
  return ctrl && parts.includes('alt') && !parts.includes('shift') && !parts.includes('super')
}

/** "Control+Shift+Space" → "Ctrl + Shift + Space" (for people). */
export const keyLabel = (acc: string) => (acc ? acc.replace('Control', 'Ctrl').replace('Super', 'Win').replace(/\+/g, ' + ') : 'No shortcut')

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Enter', NumpadEnter: 'Enter',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`'
}

export interface KeyPress { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
/**
 * A key press in the settings' "record a shortcut" field → what it means:
 * `waiting` (only modifiers so far), a valid `accelerator`, or `invalid`
 * with the reason in plain words. Uses the physical key (code), so a
 * German or Polish layout records the same letter Windows registers.
 */
export function pressToAccelerator(e: KeyPress): { waiting: true } | { accelerator: string } | { invalid: string; text: string } {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return { waiting: true }
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  const code = e.code ?? ''
  const key =
    /^Key[A-Z]$/.test(code) ? code.slice(3)
    : /^Digit[0-9]$/.test(code) ? code.slice(5)
    : /^Numpad[0-9]$/.test(code) ? `num${code.slice(6)}`
    : /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code
    : CODE_KEYS[code] ?? (e.key && e.key.length === 1 ? e.key.toUpperCase() : '')
  const text = [...mods, key || e.key].join('+')
  if (!key) return { invalid: 'That key can’t be used in a shortcut.', text }
  const acc = normalizeAccelerator([...mods, key].join('+'))
  if (!acc) return { invalid: mods.length ? 'Add Ctrl, Alt or Win: Shift alone types capitals.' : 'Hold Ctrl, Alt or Win with the key.', text }
  return { accelerator: acc }
}

/** Two island shortcuts on the same keys: the second can't work. */
export function shortcutClash(acc: string, others: string[]): boolean {
  const a = normalizeAccelerator(acc)
  return !!a && others.some((o) => normalizeAccelerator(o) === a)
}

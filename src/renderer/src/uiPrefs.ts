// Per-viewer look-and-feel choices (theme, sounds, name). Kept in localStorage:
// they are conveniences, not data, and the app works the same without them.
import { useEffect, useState } from 'react'

export interface UiPrefs {
  theme: 'dark' | 'light' | 'system'
  sound: boolean
  name: string
}

const KEY = 'ls.ui'
const DEFAULTS: UiPrefs = { theme: 'dark', sound: true, name: '' }

function load(): UiPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<(p: UiPrefs) => void>()

export function getUiPrefs(): UiPrefs {
  return current
}

export function setUiPrefs(p: Partial<UiPrefs>): void {
  current = { ...current, ...p }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // storage unavailable: the choice lasts until restart
  }
  applyTheme()
  listeners.forEach((l) => l(current))
}

export function useUiPrefs(): [UiPrefs, (p: Partial<UiPrefs>) => void] {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    return () => {
      listeners.delete(setP)
    }
  }, [])
  return [p, setUiPrefs]
}

const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** Sets html[data-theme] from the choice (system follows Windows). */
export function applyTheme(): void {
  const t = current.theme === 'system' ? (systemDark?.matches === false ? 'light' : 'dark') : current.theme
  document.documentElement.dataset.theme = t
}

systemDark?.addEventListener('change', () => current.theme === 'system' && applyTheme())

// ---------- Last place ----------

export interface LastPlace {
  page: string
  view: Record<string, 'app' | 'system'>
}

export function loadLastPlace(): LastPlace | null {
  try {
    return JSON.parse(localStorage.getItem('ls.last') ?? 'null')
  } catch {
    return null
  }
}

export function saveLastPlace(p: LastPlace): void {
  try {
    localStorage.setItem('ls.last', JSON.stringify(p))
  } catch {
    // not critical
  }
}

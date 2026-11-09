// The sidebar's pins and More fold, kept on this device only (a per-viewer convenience).
import { useSyncExternalStore } from 'react'
import { cleanNavPrefs, NAV_KEY, type NavPrefs } from './navLayout'

let cache: NavPrefs | null = null
const listeners = new Set<() => void>()

export function readNavPrefs(): NavPrefs {
  if (cache) return cache
  try {
    cache = cleanNavPrefs(JSON.parse(localStorage.getItem(NAV_KEY) || '{}'))
  } catch {
    cache = cleanNavPrefs(null)
  }
  return cache
}

export function writeNavPrefs(next: NavPrefs): void {
  cache = cleanNavPrefs(next)
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify(cache))
  } catch {
    /* private window: kept until the page closes */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useNavPrefs(): [NavPrefs, (fn: (p: NavPrefs) => NavPrefs) => void] {
  const prefs = useSyncExternalStore(subscribe, readNavPrefs, readNavPrefs)
  return [prefs, (fn) => writeNavPrefs(fn(readNavPrefs()))]
}

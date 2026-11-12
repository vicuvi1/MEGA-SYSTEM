// The module switch on this screen (core/modules.ts): read from the synced `modules_on`
// setting, updated at once when Settings → Modules changes it and when another device syncs.
// `modulesNow()` is the same answer for code outside React (the island feed, pop-ups, capture).
import { useEffect, useState } from 'react'
import { DEFAULT_MODULES, isOn, type ModuleId, type ModulesOn } from '@core/modules'
import { life } from './bridge'
import { useLive } from './live'

let cached: ModulesOn = DEFAULT_MODULES
let loadedAt = 0
let loading: Promise<ModulesOn> | null = null

/** The desktop app: the Dynamic island module decides whether the island window exists at all (src/desktop/island.ts). */
let islandSent: boolean | null = null
function tellDesktop(v: ModulesOn): void {
  if (typeof window === 'undefined' || !window.desktop?.islandModule) return
  const on = isOn(v, 'island')
  if (on === islandSent) return
  islandSent = on
  window.desktop.islandModule(on)
}

function take(v: ModulesOn): ModulesOn {
  const changed = JSON.stringify(v) !== JSON.stringify(cached)
  cached = v
  loadedAt = Date.now()
  tellDesktop(v)
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-modules-changed', { detail: v }))
  return v
}

/** Reads the setting again (at most one read at a time). */
export function loadModules(): Promise<ModulesOn> {
  if (!life.modules) return Promise.resolve(cached)
  return (loading ??= life.modules
    .get()
    .then(take)
    .catch(() => cached)
    .finally(() => {
      loading = null
    }))
}

if (typeof window !== 'undefined')
  window.addEventListener('life-modules-changed', (e) => {
    const v = (e as CustomEvent<ModulesOn>).detail
    if (v) {
      cached = v
      loadedAt = Date.now()
      tellDesktop(v)
    }
  })

/** The modules as last read (re-read in the background when older than a minute). */
export function modulesNow(): ModulesOn {
  if (Date.now() - loadedAt > 60_000) void loadModules()
  return cached
}

/** Is this module on (outside React)? */
export const moduleOn = (id: ModuleId): boolean => isOn(modulesNow(), id)

export function useModules(): ModulesOn {
  const [m, setM] = useState<ModulesOn>(cached)
  useEffect(() => {
    void loadModules().then(setM)
    const on = (e: Event) => {
      const v = (e as CustomEvent<ModulesOn>).detail
      if (v) setM(v)
    }
    window.addEventListener('life-modules-changed', on)
    return () => window.removeEventListener('life-modules-changed', on)
  }, [])
  useLive(() => void loadModules().then(setM), { external: true })
  return m
}

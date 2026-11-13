// Simple mode on this screen (core/simpleMode.ts): read from the synced `simple_mode`
// setting, updated when Settings changes it or another device syncs.
import { useEffect, useState } from 'react'
import type { SimpleMode } from '@core/simpleMode'
import { coinsShownNow, setSimpleNow, simpleNow } from './simpleCache'
import { life } from './bridge'
import { useLive } from './live'

export { coinsShownNow }

/** The one switch for the coin display (Settings, Show coins and rewards). Earning is never affected. */
export function useShowCoins(): boolean {
  return useSimple().coins
}

export function useSimple(): SimpleMode {
  const [m, setM] = useState<SimpleMode>(simpleNow)
  const load = () =>
    void life.notifications
      ?.simple?.()
      .then((v) => {
        setSimpleNow(v)
        setM(v)
      })
      .catch(() => {})
  useEffect(() => {
    load()
    const on = (e: Event) => {
      const v = (e as CustomEvent<SimpleMode>).detail
      if (v) {
        setSimpleNow(v)
        setM(v)
      }
    }
    window.addEventListener('life-simple-changed', on)
    return () => window.removeEventListener('life-simple-changed', on)
  }, [])
  useLive(load, { external: true })
  return m
}

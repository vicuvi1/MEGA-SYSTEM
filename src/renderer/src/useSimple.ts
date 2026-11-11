// Simple mode on this screen (core/simpleMode.ts): read from the synced `simple_mode`
// setting, updated when Settings changes it or another device syncs.
import { useEffect, useState } from 'react'
import { DEFAULT_SIMPLE, type SimpleMode } from '@core/simpleMode'
import { life } from './bridge'
import { useLive } from './live'

let cached: SimpleMode = DEFAULT_SIMPLE

export function useSimple(): SimpleMode {
  const [m, setM] = useState<SimpleMode>(cached)
  const load = () =>
    void life.notifications
      ?.simple?.()
      .then((v) => {
        cached = v
        setM(v)
      })
      .catch(() => {})
  useEffect(() => {
    load()
    const on = (e: Event) => {
      const v = (e as CustomEvent<SimpleMode>).detail
      if (v) {
        cached = v
        setM(v)
      }
    }
    window.addEventListener('life-simple-changed', on)
    return () => window.removeEventListener('life-simple-changed', on)
  }, [])
  useLive(load, { external: true })
  return m
}

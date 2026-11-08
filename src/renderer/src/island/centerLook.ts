// Custom Center → the island's look. The app window puts the mode's looks in
// the snapshot (`snap.center.looks`, already island look values); this plugs
// them into the ONE look adapter with `setLookSource`, and calls
// `looksChanged()` whenever they change (a save on the Center page, a mode you
// tapped, a mode that started by its times). With no Center, the source gives
// nothing and the island keeps its defaults.
import { useEffect, useLayoutEffect } from 'react'
import type { CenterIsland } from '@core/islandCenter'
import { looksChanged, setLookSource } from './lookAdapter'

let current: CenterIsland | null = null

/** Keeps the island's look in step with the Custom Center's mode. */
export function useCenterLooks(c: CenterIsland | null | undefined): void {
  useEffect(() => setLookSource({ looks: () => current?.looks ?? null }), [])
  const key = c ? `${c.key}|${JSON.stringify(c.looks)}` : ''
  useLayoutEffect(() => {
    current = c ?? null
    looksChanged()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

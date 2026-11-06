// One water log: the shared one (Ben, Sporty, Telegram, the island and every
// screen read and add to it), mirrored into Sport Track's copy on this
// device. No screen keeps its own counter.
import { useCallback, useEffect, useState } from 'react'
import { life } from './bridge'
import { play } from './soundKit'
import { readSport, updateSport } from './sportTrack'
import { WATER_TARGET_ML } from '@core/defaults'
import { celebrate } from './fx'
import { WATER_KIND, type LogEntry } from '@core/bodyLog'

export interface Water { ml: number; target: number }

const local = (): Water => {
  const s = readSport() as any
  return { ml: Number(s?.water?.currentMl) || 0, target: Number(s?.water?.targetMl) || WATER_TARGET_ML }
}

/** Today's water from the shared log (Sport Track's copy until it loads). */
export async function readWater(): Promise<Water> {
  const st = await life.coach?.status?.().catch(() => null)
  const l = local()
  if (!st) return l
  return { ml: Math.max(st.today.waterMl, 0), target: st.today.waterTarget || l.target }
}

/**
 * Adds (or with a negative number, takes back) water: one row in the shared
 * log (body_log). `source`: where it came from (island, sport…; this device
 * by default); `id`: a fixed row id, so the same tap sent twice counts once.
 */
export async function addWater(ml: number, opts: { source?: string; id?: string } = {}): Promise<Water> {
  const r = life.coach?.water ? await life.coach.water(ml, opts) : null
  if (ml > 0) celebrate(null, 'water')
  // This device's copy shows the log's sum (never adds on its own: no second counter).
  const data = updateSport((d) => {
    if (d.water) d.water.currentMl = Math.max(0, r ? r.ml : (Number(d.water.currentMl) || 0) + ml)
  }, { log: !r, source: opts.source })
  changed()
  return r ?? { ml: Number((data as any)?.water?.currentMl) || 0, target: Number((data as any)?.water?.targetMl) || WATER_TARGET_ML }
}

function changed(): void {
  window.dispatchEvent(new CustomEvent('life-body-changed'))
  window.dispatchEvent(new CustomEvent('life-water-changed'))
}

/** Today's water entries (time, amount, from where), oldest first. */
export async function waterEntries(): Promise<LogEntry[]> {
  return (await life.coach?.bodyLog?.entries(WATER_KIND).catch(() => null)) ?? []
}

/** Removes a wrong water entry, or brings a removed one back. True when it went through. */
export async function toggleWaterEntry(id: string): Promise<{ removed: boolean } | null> {
  const r = (await life.coach?.bodyLog?.toggle(id).catch(() => null)) ?? null
  if (!r) return null
  const w = await readWater()
  updateSport((d) => {
    if (d.water) d.water.currentMl = w.ml
  }, { log: false })
  changed()
  return r
}

/** Removes one entry (the island's Undo); false when it was already removed or isn't there. */
export async function removeWaterEntry(id: string): Promise<boolean> {
  const list = await waterEntries()
  const e = list.find((x) => x.id === id)
  if (!e || e.removed) return false
  return !!(await toggleWaterEntry(id))?.removed
}

export function useWater(): Water & { add: (ml: number) => Promise<Water>; set: (ml: number) => Promise<Water> } {
  const [w, setW] = useState<Water>(() => (typeof localStorage === 'undefined' ? { ml: 0, target: WATER_TARGET_ML } : local()))
  const load = useCallback(() => void readWater().then(setW).catch(() => {}), [])
  useEffect(() => {
    load()
    window.addEventListener('life-water-changed', load)
    window.addEventListener('life-sport-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('life-sport-changed', load)
      window.removeEventListener('life-water-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [load])
  const add = useCallback(async (ml: number) => {
    if (ml > 0) play('water')
    setW((cur) => ({ ...cur, ml: Math.max(0, cur.ml + ml) }))
    const next = await addWater(ml)
    setW(next)
    return next
  }, [])
  const set = useCallback(async (ml: number) => add(Math.max(0, ml) - w.ml), [add, w.ml])
  return { ...w, add, set }
}

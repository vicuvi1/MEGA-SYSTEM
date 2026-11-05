// One water log: the shared one (Ben, Sporty, Telegram, the island and every
// screen read and add to it), mirrored into Sport Track's copy on this
// device. No screen keeps its own counter.
import { useCallback, useEffect, useState } from 'react'
import { life } from './bridge'
import { readSport, updateSport } from './sportTrack'

export interface Water { ml: number; target: number }

const local = (): Water => {
  const s = readSport() as any
  return { ml: Number(s?.water?.currentMl) || 0, target: Number(s?.water?.targetMl) || 2700 }
}

/** Today's water from the shared log (Sport Track's copy until it loads). */
export async function readWater(): Promise<Water> {
  const st = await life.coach?.status?.().catch(() => null)
  const l = local()
  if (!st) return l
  return { ml: Math.max(st.today.waterMl, 0), target: st.today.waterTarget || l.target }
}

/** Adds (or with a negative number, takes back) water in the shared log. */
export async function addWater(ml: number): Promise<Water> {
  const r = life.coach?.water ? await life.coach.water(ml) : null
  const data = updateSport((d) => {
    if (d.water) d.water.currentMl = Math.max(0, r ? r.ml : (Number(d.water.currentMl) || 0) + ml)
  })
  window.dispatchEvent(new CustomEvent('life-body-changed'))
  window.dispatchEvent(new CustomEvent('life-water-changed'))
  return r ?? { ml: Number((data as any)?.water?.currentMl) || 0, target: Number((data as any)?.water?.targetMl) || 2700 }
}

export function useWater(): Water & { add: (ml: number) => Promise<Water>; set: (ml: number) => Promise<Water> } {
  const [w, setW] = useState<Water>(() => (typeof localStorage === 'undefined' ? { ml: 0, target: 2700 } : local()))
  const load = useCallback(() => void readWater().then(setW).catch(() => {}), [])
  useEffect(() => {
    load()
    window.addEventListener('life-water-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('life-water-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [load])
  const add = useCallback(async (ml: number) => {
    setW((cur) => ({ ...cur, ml: Math.max(0, cur.ml + ml) }))
    const next = await addWater(ml)
    setW(next)
    return next
  }, [])
  const set = useCallback(async (ml: number) => add(Math.max(0, ml) - w.ml), [add, w.ml])
  return { ...w, add, set }
}

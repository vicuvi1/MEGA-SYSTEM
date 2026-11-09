// Loads Body → Growth's numbers once for every screen that shows them (the
// Growth tab, the Body header chip, Today's chip): the database part from
// life.coach.bodyComp.history() and Sport Track's state on this device, then
// the pure level from core/growthLevels.ts. Reloaded after any body, sport,
// food, sleep or photo change. Reads only; nothing here is stored except the
// last level this device celebrated (a display marker, not a counter).
import { useEffect, useState } from 'react'
import { firstDay, type GrowthInput } from '@core/growthBody'
import { growthLevel, type GrowthLevel } from '@core/growthLevels'
import { life } from '../../bridge'
import { readSport } from '../../sportTrack'
import { listPhotos } from '../bodyPhotos'

export interface GrowthNow {
  input: GrowthInput
  level: GrowthLevel
}

const EVENTS = ['life-body-changed', 'life-sport-changed', 'life-external-changed', 'life-sleep-changed', 'life-photos-changed', 'storage']

let cache: Promise<GrowthNow | null> | null = null
const subs = new Set<(g: GrowthNow | null) => void>()

async function load(): Promise<GrowthNow | null> {
  const hist = life.coach?.bodyComp?.history
  if (!hist) return null
  const data = await hist()
  let lastPhotoDay: string | null = null
  try {
    const ph = await listPhotos()
    lastPhotoDay = ph.map((p) => p.day).sort().pop() ?? null
  } catch {
    lastPhotoDay = null
  }
  const input: GrowthInput = { ...data, sport: readSport() ?? {}, lastPhotoDay }
  return { input, level: growthLevel(input, firstDay(input)) }
}

function refresh(): void {
  cache = load().catch(() => null)
  void cache.then((g) => subs.forEach((f) => f(g)))
}

let wired = false
function wire(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  let t: ReturnType<typeof setTimeout> | null = null
  const later = () => {
    if (t) clearTimeout(t)
    t = setTimeout(refresh, 250)
  }
  for (const e of EVENTS) window.addEventListener(e, later)
}

/** Growth numbers (null until loaded, or where the body log is not there). */
export function useGrowth(): GrowthNow | null {
  const [g, setG] = useState<GrowthNow | null>(null)
  useEffect(() => {
    wire()
    let live = true
    const on = (x: GrowthNow | null) => live && setG(x)
    subs.add(on)
    if (!cache) refresh()
    else void cache.then(on)
    return () => {
      live = false
      subs.delete(on)
    }
  }, [])
  return g
}

const SEEN = 'life_growth_seen'
/** The last level this device showed (null: never shown, so nothing to celebrate yet). */
export function seenLevel(): number | null {
  try {
    const v = localStorage.getItem(SEEN)
    return v == null ? null : Number(v)
  } catch {
    return null
  }
}
export function markSeen(index: number): void {
  try {
    localStorage.setItem(SEEN, String(index))
  } catch {
    /* private window */
  }
}

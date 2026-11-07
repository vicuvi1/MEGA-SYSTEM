// The Season page's data: one view from life.saga, reloaded when the saga,
// the wallet or the goals change. Free evenings for the side quest come from
// this week's calendar when Google is connected.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import type { SagaView, SideFacts } from '../web/sagaStore'
import type { CalEvent } from '@core/dayTime'

/** Evenings left this week with nothing after 18:00, and whether a weekend day is mostly free. */
export function freeTime(events: CalEvent[], now = new Date()): Pick<SideFacts, 'freeEvenings' | 'freeDay'> {
  const days: Date[] = []
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  const toSunday = (7 - d.getDay()) % 7
  for (let i = 0; i <= toSunday; i++) days.push(new Date(d.getTime() + i * 864e5))
  const busy = (day: Date, fromH: number, toH: number) =>
    events.some((e) => {
      const s = new Date(e.start)
      const en = new Date(e.end)
      const a = new Date(day)
      a.setHours(fromH, 0, 0, 0)
      const b = new Date(day)
      b.setHours(toH, 0, 0, 0)
      return s < b && en > a && !e.allDay
    })
  const freeEvenings = days.filter((x) => !busy(x, 18, 22)).length
  const weekend = days.filter((x) => x.getDay() === 0 || x.getDay() === 6)
  const freeDay = weekend.length ? weekend.some((x) => !busy(x, 10, 17)) : null
  return { freeEvenings, freeDay }
}

export function useSaga(): { v: SagaView | null; reload: () => void; error: string | null } {
  const [v, setV] = useState<SagaView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [side, setSide] = useState<SideFacts | undefined>(undefined)
  const reload = useCallback(() => {
    if (!life.saga) {
      setError('Seasons are not available here')
      return
    }
    life.saga
      .view(side)
      .then((x) => {
        setV(x)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [side])
  useEffect(reload, [reload])
  useLive(reload)
  useEffect(() => {
    const on = () => reload()
    for (const n of ['life-saga-changed', 'life-goals-changed', 'life-wallet-changed']) window.addEventListener(n, on)
    return () => {
      for (const n of ['life-saga-changed', 'life-goals-changed', 'life-wallet-changed']) window.removeEventListener(n, on)
    }
  }, [reload])
  // This week's calendar (when connected) for the side quest's free evenings.
  useEffect(() => {
    let off = false
    const g = life.google
    if (!g) return
    void g
      .status()
      .then(async (st) => {
        if (!st?.connected || off) return
        const now = new Date()
        const end = new Date(now.getTime() + 8 * 864e5)
        const evs = await g.events(now.toISOString(), end.toISOString()).catch(() => null)
        if (evs && !off) setSide((s) => ({ ...s, ...freeTime(evs, now) }))
      })
      .catch(() => {})
    return () => {
      off = true
    }
  }, [])
  return { v, reload, error }
}

/** The local-only adventure photos ("Did it" pictures never leave this device). */
const PHOTO = (id: string) => `ls.saga.adv.${id}`
export function advPhoto(id: string): string | null {
  try {
    return localStorage.getItem(PHOTO(id))
  } catch {
    return null
  }
}
export function setAdvPhoto(id: string, url: string | null): boolean {
  try {
    if (url) localStorage.setItem(PHOTO(id), url)
    else localStorage.removeItem(PHOTO(id))
    return true
  } catch {
    return false
  }
}

/** A picture made small on this device (a JPEG data URL under `maxLen`). */
export async function smallPicture(file: File, maxSide = 640, maxLen = 110_000): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG, PNG or WebP)')
  if (file.size > 25 * 1024 * 1024) throw new Error('That picture is too big (25 MB at most)')
  const src = await new Promise<string>((ok, bad) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result))
    fr.onerror = () => bad(new Error('Could not read that picture'))
    fr.readAsDataURL(file)
  })
  const img = new Image()
  img.src = src
  await img.decode()
  for (const [side, q] of [[maxSide, 0.8], [maxSide * 0.8, 0.7], [maxSide * 0.6, 0.62], [maxSide * 0.45, 0.55]] as const) {
    const k = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k))
    c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k))
    const g = c.getContext('2d')
    if (!g) throw new Error('Could not read that picture')
    g.drawImage(img, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', q)
    if (url.length <= maxLen) return url
  }
  throw new Error('That picture is too detailed to keep small; try another one')
}

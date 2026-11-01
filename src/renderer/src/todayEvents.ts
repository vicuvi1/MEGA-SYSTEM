// Today's Google Calendar events, shared by the timeline and the Now card
// (one fetch, everyone redraws). Reloads live: when data changes and every
// ~30 s for changes made in Google Calendar itself.
import { useEffect, useState } from 'react'
import type { CalEvent } from '@core/dayTime'
import { life } from './bridge'
import { useLive } from './live'

const pad = (n: number) => String(n).padStart(2, '0')
export const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface Snapshot {
  day: string
  connected: boolean | null
  events: CalEvent[]
}
let snap: Snapshot = { day: '', connected: null, events: [] }
let inflight: Promise<void> | null = null
const subs = new Set<(s: Snapshot) => void>()

export function reloadToday(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    const day = localToday()
    const on = !!(await life.google?.status().catch(() => null))?.connected
    const events = on ? await life.google!.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => snap.events) : []
    snap = { day, connected: on, events }
    subs.forEach((f) => f(snap))
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Today's events (changes after a reload); `reload` after you changed one. */
export function useTodayEvents(): Snapshot & { reload: () => Promise<void> } {
  const [s, setS] = useState(snap)
  useEffect(() => {
    subs.add(setS)
    if (snap.day !== localToday() || snap.connected === null) void reloadToday()
    else setS(snap)
    return () => {
      subs.delete(setS)
    }
  }, [])
  useLive(() => void reloadToday(), { external: true, data: false })
  return { ...s, reload: reloadToday }
}

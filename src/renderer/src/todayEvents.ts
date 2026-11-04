// Today's Google Calendar events, shared by the timeline and the Now card
// (one fetch, everyone redraws). Reloads live: when data changes and every
// ~30 s for changes made in Google Calendar itself.
import { addDays, dayKey } from '@core/dates'
import { useEffect, useState } from 'react'
import type { CalEvent } from '@core/dayTime'
import { life } from './bridge'
import { useLive } from './live'

/** Today, the app's way: the day ends at 04:00, so at 01:30 it is still "today" for your plan. */
export const localToday = () => dayKey(new Date())
/** The calendar date (midnight to midnight): the timeline and booking use this one. */
export const calendarToday = () => dayKey(new Date(), undefined, 0)

interface Snapshot {
  day: string
  connected: boolean | null
  events: CalEvent[]
  /** The calendar didn't answer (slow or offline): shown with a Retry. */
  error?: string | null
}
let snap: Snapshot = { day: '', connected: null, events: [], error: null }
let inflight: Promise<void> | null = null
const subs = new Set<(s: Snapshot) => void>()

export function reloadToday(): Promise<void> {
  if (inflight) return inflight
  // Never wait forever: a calendar that doesn't answer in 20 s counts as
  // "didn't answer" (the last events stay; the next reload tries again).
  const limit = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('Your calendar did not answer')), ms))])
  inflight = (async () => {
    const day = localToday()
    let status: { connected?: boolean } | null = null
    let error: string | null = null
    try {
      status = (await limit<{ connected?: boolean } | null>(life.google ? life.google.status() : Promise.resolve({ connected: false }), 20_000)) as { connected?: boolean } | null
    } catch (e) {
      error = (e as Error).message
    }
    // No answer: keep what we knew (never claim "not connected" because it was slow).
    const on = status ? !!status.connected : snap.connected ?? true
    let events = snap.day === day ? snap.events : []
    if (on && !error) {
      try {
        events = await limit(life.google!.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${addDays(calendarToday(), 1)}T04:00:00`).toISOString()), 20_000)
      } catch (e) {
        error = (e as Error).message
      }
    } else if (!on) events = []
    snap = { day, connected: on, events, error }
    // Health: Ben tells you when the calendar keeps failing.
    if (on) void life.system?.beat('calendar', !error, error ?? undefined).catch(() => {})
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

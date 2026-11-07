// BD17: a small, optional check-off for daily basics: creatine (3–5 g, any
// time of day) and vitamin D in the darker months. Each tick is a row in the
// one body log (kind `supp:<id>`, amount 1), so it syncs and undoes like
// water. A streak, and NO points: honest logging is the whole point.
// Pure and tested.
import { addDays } from './dates'
import { liveIds, type BodyEvent } from './bodyLog'

export const SUPP_PREFIX = 'supp:'
export const suppKind = (id: string) => `${SUPP_PREFIX}${id}`

export interface Supp {
  id: string
  name: string
  dose: string
  emoji: string
  why: string
  /** Only in these months (1–12); every month when missing. */
  months?: number[]
}

export const SUPPS: Supp[] = [
  { id: 'creatine', name: 'Creatine', dose: '3–5 g', emoji: '⚡', why: 'One of the best-proven supplements for strength and muscle. It only works when you take it every day; any time is fine.' },
  { id: 'vitd', name: 'Vitamin D', dose: 'as on the label', emoji: '☀️', why: 'Little sun from October to March. Ask a doctor or pharmacist about the dose.', months: [10, 11, 12, 1, 2, 3] }
]

/** The supplements that apply this month (vitamin D only in the darker months). */
export function suppsFor(day: string, on: string[]): Supp[] {
  const month = Number(day.slice(5, 7))
  return SUPPS.filter((s) => on.includes(s.id) && (!s.months || s.months.includes(month)))
}

/** The days a supplement was ticked (removed ticks don't count). */
export function takenDays(events: BodyEvent[], id: string): Set<string> {
  const mine = events.filter((e) => e.kind === suppKind(id))
  const live = liveIds(mine)
  const days = new Map<string, number>()
  for (const e of mine) if (!e.undoes && live.has(e.id)) days.set(e.day, (days.get(e.day) ?? 0) + (Number(e.amount) || 0))
  return new Set([...days.entries()].filter(([, n]) => n > 0).map(([d]) => d))
}

/** The live tick for today, if any (to take it back). */
export function todaysTick(events: BodyEvent[], id: string, day: string): string | null {
  const mine = events.filter((e) => e.kind === suppKind(id) && e.day === day)
  const live = liveIds(mine)
  return mine.find((e) => !e.undoes && live.has(e.id) && e.amount > 0)?.id ?? null
}

/** Days in a row up to today (a day not ticked yet today doesn't break it). */
export function suppStreak(days: Set<string>, today: string): number {
  let d = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(d) && n < 3650) {
    n++
    d = addDays(d, -1)
  }
  return n
}

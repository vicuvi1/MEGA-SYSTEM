// Strength: sets × reps × kg, personal records and an estimated max (pure).
// Typed like "bench 3x8x60", "squat 5x5 @100", "deadlift 100kg 3x5",
// "pull-ups 4x8" (bodyweight). The estimated 1-rep max uses Epley
// (kg × (1 + reps/30)), counted for sets of 1–12 reps.
import type { Workout, WorkoutSet } from './body'

export interface ParsedSets { name: string; sets: WorkoutSet[] }

const num = (s: string) => Number(s.replace(',', '.'))

export function parseSets(raw: string): ParsedSets | null {
  const t = raw.trim().replace(/\s+/g, ' ')
  // name, then "3x8x60" / "3x8 @60" / "60kg 3x8" / "3x8" (bodyweight)
  const m = /^(.+?)\s+(?:(\d+(?:[.,]\d+)?)\s*kg\s+)?(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*(?:[x×]|@)\s*(\d+(?:[.,]\d+)?)\s*(?:kg)?)?$/i.exec(t)
  if (!m) return null
  const name = m[1].trim()
  const kg = m[2] ? num(m[2]) : m[5] ? num(m[5]) : undefined
  const sets = Number(m[3])
  const reps = Number(m[4])
  if (!name || sets < 1 || sets > 20 || reps < 1 || reps > 200 || (kg != null && !(kg > 0 && kg < 1000))) return null
  return { name: name[0].toUpperCase() + name.slice(1), sets: Array.from({ length: sets }, () => (kg != null ? { reps, weight: kg } : { reps })) }
}

export const e1rm = (reps: number, kg: number) => (reps >= 1 && reps <= 12 && kg > 0 ? Math.round(kg * (1 + reps / 30) * 10) / 10 : 0)

export interface LiftSummary {
  name: string
  /** One point per training day: the best estimated max that day. */
  points: { day: string; e1rm: number }[]
  bestE1rm: number
  bestWeight: number
  lastDay: string
  /** The newest day set a record (estimated max or heaviest weight). */
  newPr: boolean
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Every weighted lift in the workouts, newest activity first. */
export function strengthSummary(workouts: Workout[]): LiftSummary[] {
  const by = new Map<string, { name: string; days: Map<string, { e: number; w: number }> }>()
  for (const w of [...workouts].sort((a, b) => a.day.localeCompare(b.day))) {
    for (const it of w.items) {
      const weighted = (it.sets ?? []).filter((s) => (s.weight ?? 0) > 0)
      if (!weighted.length) continue
      const k = key(it.name)
      const g = by.get(k) ?? { name: it.name, days: new Map() }
      const d = g.days.get(w.day) ?? { e: 0, w: 0 }
      for (const s of weighted) {
        d.e = Math.max(d.e, e1rm(s.reps, s.weight!))
        d.w = Math.max(d.w, s.weight!)
      }
      g.days.set(w.day, d)
      by.set(k, g)
    }
  }
  const out: LiftSummary[] = []
  for (const g of by.values()) {
    const days = [...g.days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const last = days[days.length - 1]
    const before = days.slice(0, -1)
    const prevE = Math.max(0, ...before.map(([, v]) => v.e))
    const prevW = Math.max(0, ...before.map(([, v]) => v.w))
    out.push({
      name: g.name,
      points: days.map(([day, v]) => ({ day, e1rm: v.e })),
      bestE1rm: Math.max(...days.map(([, v]) => v.e)),
      bestWeight: Math.max(...days.map(([, v]) => v.w)),
      lastDay: last[0],
      newPr: before.length > 0 && (last[1].e > prevE || last[1].w > prevW)
    })
  }
  return out.sort((a, b) => b.lastDay.localeCompare(a.lastDay))
}

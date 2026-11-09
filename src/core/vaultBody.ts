// Photo Locker: the week's body numbers shown under a progress photo, read-only
// from the body log (body_comp / body_metrics day points). Pure.
import { mondayOf, type DayPoint } from './bodyComp'
import { addDays } from './dates'

export interface WeekBody {
  /** Monday of the photo's week. */
  week: string
  /** Average weight that week (kg, 1 decimal), and how many weigh-ins. */
  weight: number | null
  weighIns: number
  /** The last waist that week (cm). */
  waist: number | null
}

/** The photo's week (Mon–Sun) from the day points; null when nothing was logged that week. */
export function weekBody(points: DayPoint[], day: string): WeekBody | null {
  const week = mondayOf(day)
  const end = addDays(week, 6)
  const inWeek = points.filter((p) => p.day >= week && p.day <= end).sort((a, b) => (a.day < b.day ? -1 : 1))
  const w = inWeek.map((p) => p.weight).filter((v): v is number => typeof v === 'number' && v > 0)
  const waist = [...inWeek].reverse().find((p) => typeof p.waist === 'number' && p.waist > 0)?.waist ?? null
  if (!w.length && waist == null) return null
  return { week, weight: w.length ? Math.round((w.reduce((t, v) => t + v, 0) / w.length) * 10) / 10 : null, weighIns: w.length, waist }
}

/** "78.4 kg (3 weigh-ins) · waist 81 cm", or null. */
export function weekBodyLine(b: WeekBody | null): string | null {
  if (!b) return null
  const parts: string[] = []
  if (b.weight != null) parts.push(`${b.weight} kg${b.weighIns > 1 ? ` (${b.weighIns} weigh-ins)` : ''}`)
  if (b.waist != null) parts.push(`waist ${b.waist} cm`)
  return parts.length ? `That week: ${parts.join(' · ')}` : null
}

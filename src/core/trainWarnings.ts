// Body → Training: calm warnings, each one a plain rule.
//   tired  a move got weaker 2 sessions in a row, or every set felt "Hard"
//          for a week → an extra rest day or a lighter week (70%, one tap)
//   food   under ~2,000 kcal on 3 of the last 5 logged days while training
//          → eat more to grow (a link to Food)
// Each can be dismissed for a week (`trainWarnDismiss` in Sport Track's
// state, synced with it). The lighter week is `trainLighter` there too.
// Pure and tested (trainWarnings.test.ts). Read-only on food. No points.
import type { SportEx } from './sportLadders'
import { sessionsOf, shiftDay, type SetLog } from './sportSets'
import { daysBetween } from './trainWeek'

export type WarnId = 'tired' | 'food'

export interface TrainWarning {
  id: WarnId
  title: string
  line: string
  /** What the one button does. */
  action: 'lighter' | 'food'
}

/** Days a dismissed warning stays hidden. */
export const DISMISS_DAYS = 7
/** "Not eating enough to grow": under this many kcal on a logged day. */
export const LOW_KCAL = 2000
/** A lighter week: 70% of your usual reps for 7 days. */
export const LIGHTER = { pct: 70, days: 7 }

/** A session's strength on one exercise: the best set, 2.5 kg of backpack counted as one rep. */
export function sessionScore(sets: { reps: number; kg?: number }[]): number {
  return Math.max(0, ...sets.map((s) => (Number(s.reps) || 0) + (Number(s.kg) || 0) / 2.5))
}

export interface Drop {
  exId: string
  name: string
  /** The last three session scores, oldest first. */
  values: number[]
}

/**
 * Exercises that got weaker 2 sessions in a row (the last 3 sessions, all in the last 21 days, each lower
 * than the one before). Today is left out: a session in progress isn't finished yet.
 */
export function strengthDrops(log: SetLog | null | undefined, exercises: SportEx[], today: string): Drop[] {
  const yday = shiftDay(today, -1)
  const out: Drop[] = []
  for (const e of Array.isArray(exercises) ? exercises : []) {
    const id = String(e.id)
    const days = sessionsOf(log, id, yday).slice(-3)
    if (days.length < 3 || daysBetween(days[0].day, today) > 21) continue
    const values = days.map((d) => sessionScore((log?.[d.day]?.[id] ?? []).filter((s) => s && !s.test)))
    if (values[2] < values[1] && values[1] < values[0])
      out.push({
        exId: id,
        name: String(e.name || 'a move'),
        values: values.map((v) => Math.round(v * 10) / 10)
      })
  }
  return out
}

/**
 * Every set with an effort tap in the last 7 days was "Hard": at least 8 such sets over at least 2 days,
 * and none "OK" or "Easy".
 */
export function allHardWeek(log: SetLog | null | undefined, today: string): boolean {
  const from = shiftDay(today, -6)
  let hard = 0
  let other = 0
  const days = new Set<string>()
  for (const [day, m] of Object.entries(log ?? {})) {
    if (day < from || day > today) continue
    for (const list of Object.values(m ?? {}))
      for (const s of Array.isArray(list) ? list : []) {
        if (!s?.feel) continue
        if (s.feel === 'hard') {
          hard++
          days.add(day)
        } else other++
      }
  }
  return hard >= 8 && days.size >= 2 && other === 0
}

/**
 * Under ~2,000 kcal on 3 or more of the last 5 days before today that have food logged (today is still
 * going, a day with nothing logged says nothing).
 */
export function lowFood(perDay: { day: string; kcal: number }[] | null | undefined, today: string): { low: number; of: number } | null {
  const from = shiftDay(today, -5)
  const days = (perDay ?? []).filter((d) => d.day >= from && d.day < today && Number(d.kcal) > 0)
  const low = days.filter((d) => d.kcal < LOW_KCAL).length
  return low >= 3 ? { low, of: days.length } : null
}

/** Shown again only a week after "Dismiss". */
export const isDismissed = (dismissed: Record<string, string> | null | undefined, id: WarnId, today: string) => {
  const d = dismissed?.[id]
  return !!d && daysBetween(d, today) < DISMISS_DAYS
}

/** The lighter week, if one is running today. */
export function lighterOn(st: any, today: string): { until: string } | null {
  const l = st?.trainLighter
  return l && typeof l.until === 'string' && typeof l.from === 'string' && l.from <= today && today <= l.until ? { until: l.until } : null
}

/** Reps for a lighter day: 70%, at least 1. */
export const lighterReps = (reps: number) => Math.max(1, Math.round(reps * (LIGHTER.pct / 100)))

export interface WarnInput {
  log: SetLog | null | undefined
  exercises: SportEx[]
  today: string
  /** Sessions in the last 7 days (else the plan's count). */
  perWeek: number
  /** The food counter's last days (null: not loaded or no food counter). */
  food: { day: string; kcal: number }[] | null
  dismissed: Record<string, string> | null | undefined
  /** A lighter week is running (the tired warning is already handled). */
  lighter: boolean
}

const nice = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** The warnings to show now, calm wording, at most one of each. */
export function trainWarnings(i: WarnInput): TrainWarning[] {
  const out: TrainWarning[] = []
  if (!i.lighter && !isDismissed(i.dismissed, 'tired', i.today)) {
    const drop = strengthDrops(i.log, i.exercises, i.today)[0]
    if (drop)
      out.push({
        id: 'tired',
        title: 'Time for some extra rest?',
        line: `${nice(drop.name)} went down 2 sessions in a row (${drop.values.map(num).join(' → ')}). That usually means tired, not weaker. Take an extra rest day, or a lighter week.`,
        action: 'lighter'
      })
    else if (allHardWeek(i.log, i.today))
      out.push({
        id: 'tired',
        title: 'Time for some extra rest?',
        line: 'Every set felt hard this week. Take an extra rest day, or a lighter week, and come back stronger.',
        action: 'lighter'
      })
  }
  if (!isDismissed(i.dismissed, 'food', i.today) && i.perWeek >= 2) {
    const f = lowFood(i.food, i.today)
    if (f)
      out.push({
        id: 'food',
        title: 'Eat a bit more',
        line: `You're training ${i.perWeek}×/week but not eating enough to grow. Under ${LOW_KCAL.toLocaleString('en-US')} kcal on ${f.low} of the last ${f.of} days you logged.`,
        action: 'food'
      })
  }
  return out
}

// ---------- saving (changes Sport Track's state in place) ----------

/** "Dismiss for a week". */
export function dismissWarning(st: any, id: WarnId, today: string): void {
  st.trainWarnDismiss = { ...(st.trainWarnDismiss ?? {}), [id]: today }
}

/** A lighter week from today (or none: `on` false ends it). */
export function setLighter(st: any, today: string, now: number, on = true): void {
  st.trainLighter = on ? { from: today, until: shiftDay(today, LIGHTER.days - 1), at: now } : { from: today, until: shiftDay(today, -1), at: now }
}

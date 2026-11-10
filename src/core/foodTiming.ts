// Food and the clock (pure, tested; tests pin the clock):
// - his usual meal times, learned from his own logs (the median time of each
//   meal type over the last 3 weeks, 3+ days needed);
// - the next meal: how much and what, from what is left today and the time
//   until training or sleep;
// - the workout note: he trained with no protein in the hours before or since;
// - "Protein left today" with real foods to close the gap, for every Telegram food reply.
// Minutes are minutes into the app day (it turns at 04:00, so 00:30 is 24:30).
import { addDays } from './dates'
import type { FoodMeal, MealType } from './food'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
/** Minutes into the app day of a moment (00:00–03:59 count as 24:00–27:59). */
export const appMin = (d: Date) => {
  const m = d.getHours() * 60 + d.getMinutes()
  return m < 240 ? m + 1440 : m
}
/** "13:05" from minutes into the app day. */
export const hm = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const k = Math.floor(s.length / 2)
  return s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2)
}

/** At least this many days with that meal before its time counts as "usual". */
export const USUAL_MIN_DAYS = 3

/**
 * His usual time for breakfast, lunch and dinner: the median of the first meal
 * of that type on each of the last 21 days (3+ days needed, else null).
 * Snacks have no usual time. Supplements and removed meals don't count.
 */
export function usualMealTimes(meals: (Pick<FoodMeal, 'at' | 'day' | 'type' | 'supp'> & { removed?: boolean })[], today: string): Record<'breakfast' | 'lunch' | 'dinner', number | null> {
  const from = addDays(today, -21)
  const out = { breakfast: null as number | null, lunch: null as number | null, dinner: null as number | null }
  for (const type of ['breakfast', 'lunch', 'dinner'] as const) {
    const first = new Map<string, number>()
    for (const m of meals) {
      if (m.type !== type || m.supp || m.removed || m.day < from || m.day >= today) continue
      const d = new Date(m.at)
      if (!Number.isFinite(d.getTime())) continue
      const min = appMin(d)
      const was = first.get(m.day)
      if (was == null || min < was) first.set(m.day, min)
    }
    if (first.size >= USUAL_MIN_DAYS) out[type] = median([...first.values()])
  }
  return out
}

/** His usual training start: the median first-set time of the last 14 days he trained (3+ days), else null. */
export function usualTrainStart(starts: { day: string; at: string }[], today: string): number | null {
  const mins = starts.filter((s) => s.day < today && s.day >= addDays(today, -14)).map((s) => new Date(s.at)).filter((d) => Number.isFinite(d.getTime())).map(appMin)
  return mins.length >= USUAL_MIN_DAYS ? median(mins) : null
}

// ---- the next meal ----

export interface NextMealIn {
  now: Date
  kcalLeft: number
  proteinLeft: number
  /** Bedtime, minutes into the app day. */
  bed: number
  /** Training planned or usual today (minutes into the app day), when he hasn't trained yet. */
  trainAt: number | null
  /** When today's training ended (last set), minutes into the app day, or null. */
  trainEnd: number | null
  /** Food ideas from what to eat next ("200 g chicken breast"), best first. */
  ideas: string[]
}
export interface NextMeal {
  line: string
  kcal: number
  protein: number
  why: 'done' | 'bed' | 'pre' | 'snack' | 'post' | 'split'
}

/**
 * One next-meal suggestion: goals done → nothing; under an hour to bed → a light
 * protein snack; training within the hour → a small snack; within 3 h → a
 * pre-workout meal; trained within 2 h → protein + carbs now; else what is left
 * split over the meals that fit before bed (one every 4 h, at most 3).
 */
export function nextMeal(i: NextMealIn): NextMeal {
  const now = appMin(i.now)
  const k = Math.max(0, Math.round(i.kcalLeft))
  const p = Math.max(0, Math.round(i.proteinLeft))
  const idea = i.ideas[0] ? `: ${i.ideas[0].replace(/\.$/, '')}` : ''
  if (k <= 100 && p <= 5) return { line: 'Goals done for today. Water, and a light snack only if you are hungry.', kcal: 0, protein: 0, why: 'done' }
  const toBed = i.bed - now
  if (toBed <= 60) {
    const pp = Math.min(p, 40)
    return { line: pp >= 10 ? `Close to bed: if you eat, keep it light, ${pp} g protein${idea}.` : 'Close to bed: skip big meals now; start tomorrow with a good breakfast.', kcal: Math.min(k, 300), protein: pp, why: 'bed' }
  }
  if (i.trainEnd != null && now - i.trainEnd >= 0 && now - i.trainEnd <= 120) {
    const pp = Math.max(30, Math.min(40, p))
    return { line: `After training (${hm(i.trainEnd)}): ${pp} g protein and some carbs within the hour${idea}.`, kcal: Math.min(k, 700), protein: pp, why: 'post' }
  }
  if (i.trainAt != null && i.trainAt - now > 0 && i.trainAt - now <= 60) return { line: `Training at ${hm(i.trainAt)}: only a small snack now (a banana or a yoghurt, about 150 kcal).`, kcal: Math.min(k, 150), protein: Math.min(p, 10), why: 'snack' }
  if (i.trainAt != null && i.trainAt - now > 60 && i.trainAt - now <= 180) {
    const kk = Math.min(k, 600)
    const pp = Math.min(p, 30)
    return { line: `Before training at ${hm(i.trainAt)}: about ${fmt(kk)} kcal with ${pp} g protein, mostly carbs (rice, bread, a banana), eaten now.`, kcal: kk, protein: pp, why: 'pre' }
  }
  const meals = Math.max(1, Math.min(3, Math.floor((toBed - 60) / 240) + 1))
  const kk = Math.round(k / meals / 10) * 10
  const pp = Math.round(p / meals)
  const left = meals > 1 ? ` (${meals} meals left before bed)` : ''
  return { line: `Next meal${left}: about ${fmt(kk)} kcal and ${pp} g protein${idea}.`, kcal: kk, protein: pp, why: 'split' }
}

// ---- the workout note ----

/** Protein close enough to training counts from this many grams. */
export const WORKOUT_PROTEIN_G = 20
/**
 * A note when he trained today with no protein (20 g+) in the 3 hours before or
 * since, while it still helps (up to 3 h after the last set). Null otherwise.
 */
export function workoutNote(i: { now: Date; start: Date | null; end: Date | null; protein: { at: Date; g: number }[]; idea?: string }): string | null {
  if (!i.start || !i.end) return null
  const now = i.now.getTime()
  const end = i.end.getTime()
  if (now < end || now - end > 3 * 3600_000) return null
  const big = i.protein.filter((x) => x.g >= WORKOUT_PROTEIN_G).map((x) => x.at.getTime())
  const before = big.some((t) => t >= i.start!.getTime() - 3 * 3600_000 && t <= i.start!.getTime())
  const after = big.some((t) => t >= end && t <= now)
  if (after) return null
  const idea = i.idea ? ` (${i.idea.replace(/\.$/, '')})` : ' (a shake or 250 g brânză de vaci)'
  const at = hm(appMin(i.start))
  if (!before) return `You trained at ${at} with no protein in the 3 hours before or since. Have 30–40 g protein in the next hour${idea}.`
  if (now - end >= 60 * 60_000) return `${Math.round((now - end) / 60_000)} min since training and no protein yet: have 30–40 g soon${idea}.`
  return null
}

// ---- protein left today, for Telegram ----

/** "🥩 58 g protein left today: 200 g chicken breast, or 3 eggs + 300 g skyr." (or "Protein done for today"). */
export function proteinLeftLine(o: { protein: number; goal: number; ideas: string[] }): string {
  const left = Math.round(o.goal - o.protein)
  if (!(o.goal > 0)) return ''
  if (left <= 0) return `🥩 Protein done for today: ${fmt(o.protein)} / ${fmt(o.goal)} g.`
  const fix = o.ideas.slice(0, 2).map((x) => x.replace(/\.$/, ''))
  return `🥩 ${left} g protein left today${fix.length ? `: ${fix.join(', or ')}` : ''}.`
}

/** The meal type a reminder kind follows (morning → breakfast, lunch → lunch, evening → dinner). */
export const KIND_TYPE: Record<'morning' | 'lunch' | 'evening', MealType> = { morning: 'breakfast', lunch: 'lunch', evening: 'dinner' }

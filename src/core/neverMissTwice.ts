// "Never miss twice" (pure, D4): missing one day is life, missing two is the
// start of a new habit. When yesterday had no focus or no training (and
// today doesn't either yet), Today offers a smaller version first, and Ben
// says it once.
import { addDays } from './dates'

export interface MissTwiceInput {
  today: string
  /** Focus minutes per day. */
  focus: { day: string; minutes: number }[]
  /** Days with a logged workout. */
  workoutDays: string[]
  /** Days you took as rest (they don't count as missed). */
  restDays: string[]
}
export interface MissTwiceItem {
  id: 'focus' | 'workout'
  /** What happened yesterday. */
  missed: string
  /** The smaller version for today. */
  small: string
}

const FOCUS_MIN = 15

export function neverMissTwice(i: MissTwiceInput): MissTwiceItem[] {
  const y = addDays(i.today, -1)
  const min = (day: string) => i.focus.filter((f) => f.day === day).reduce((t, f) => t + f.minutes, 0)
  const out: MissTwiceItem[] = []
  // Only when there was a habit to keep: some focus in the week before yesterday.
  const hadFocus = Array.from({ length: 7 }, (_, k) => min(addDays(y, -1 - k))).some((m) => m >= FOCUS_MIN)
  if (hadFocus && min(y) < FOCUS_MIN && min(i.today) < FOCUS_MIN) out.push({ id: 'focus', missed: 'No focus yesterday', small: '15 minutes of focus' })
  const trained = (d: string) => i.workoutDays.includes(d) || i.restDays.includes(d)
  const hadTraining = Array.from({ length: 7 }, (_, k) => addDays(y, -1 - k)).some((d) => i.workoutDays.includes(d))
  if (hadTraining && !trained(y) && !trained(i.today)) out.push({ id: 'workout', missed: 'No training yesterday', small: '10 push-ups' })
  return out
}

/** Ben's one line about it (or null). */
export function missTwiceLine(items: MissTwiceItem[]): string | null {
  if (!items.length) return null
  const what = items.map((x) => x.missed.toLowerCase().replace(/^no /, '')).join(' and ')
  return `Yesterday slipped (no ${what}). One day is fine, two is a pattern. Today just do the small version: ${items.map((x) => x.small).join(' and ')}. That's all it takes to keep the chain.`
}

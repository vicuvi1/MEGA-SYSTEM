// The island's Day page, short and without repeats (2026-11-09: "it feels
// heavy, 2 sections for the to-do list and 2 water things"). One to-do list
// (the Today card, core/islandTodos.ts), one water control, one place for the
// timer, one for push-ups. Your Custom Center widgets win: a water counter
// you placed replaces the built-in water control, a push-up counter the
// push-up button, a timer widget the focus button. Everything else that used
// to sit on the Day page lives behind "More" (drawn only when opened).
// Pure, tested (islandDay.test.ts).
import type { InstantId } from './islandLooks'

/** The one row of quick actions on the Day page. */
export type QuickId = 'water' | 'reps' | 'focus'

/** What your Custom Center widgets already cover (on the open island or the pill). */
export interface CenterCovers {
  water: boolean
  reps: boolean
  timer: boolean
}
export function centerCovers(cards: readonly { kind: string; track?: string }[] | null | undefined): CenterCovers {
  const c = cards ?? []
  return {
    water: c.some((w) => w.kind === 'counter' && w.track === 'water'),
    reps: c.some((w) => w.kind === 'counter' && w.track === 'reps'),
    timer: c.some((w) => w.kind === 'timer')
  }
}

/**
 * The Day page's quick row: water, push-ups, focus, each once. Gone when a
 * widget of yours does the same; focus is gone while a timer runs (the timer
 * card has Stop and +5); push-ups only when you track an exercise.
 */
export function quickRow(o: { covers: CenterCovers; running: boolean; hasReps: boolean; locked?: boolean }): QuickId[] {
  if (o.locked) return []
  const out: QuickId[] = []
  if (!o.covers.water) out.push('water')
  if (o.hasReps && !o.covers.reps) out.push('reps')
  if (!o.running && !o.covers.timer) out.push('focus')
  return out
}

/**
 * The hover peek's instant buttons without repeats: the peek already has its
 * own ▶ button (Start / Focus), so no second "▶ 25 min"; your counters in the
 * pill (Custom Center) replace the built-in water and push-up buttons.
 */
export function peekInstant(ids: readonly InstantId[], covers: Pick<CenterCovers, 'water' | 'reps'>): InstantId[] {
  return ids.filter((id) => {
    if (id === 'focus25') return false
    if (id === 'water250') return !covers.water
    if (id === 'push10' || id === 'push25' || id === 'push50') return !covers.reps
    return true
  })
}

/** The Day page, top to bottom (each only when it has something). */
export const DAY_MAIN = ['alert', 'timer', 'sleep', 'today', 'quick', 'center', 'ben'] as const
/** Behind "More" (not drawn until opened): the rest of the old Day page. */
export const DAY_MORE = ['health', 'protein', 'points', 'tiles', 'automations', 'calendar', 'clipboard', 'files', 'clock', 'media', 'eyes', 'pill'] as const
export type DayPart = (typeof DAY_MAIN)[number] | (typeof DAY_MORE)[number]

/** The parts of the main Day page that show something right now (for the smoke test and docs). */
export function dayParts(o: { alert: boolean; running: boolean; sleep: boolean; today: boolean; quick: number; center: boolean; ben: boolean }): DayPart[] {
  const has: Record<(typeof DAY_MAIN)[number], boolean> = { alert: o.alert, timer: o.running, sleep: o.sleep, today: o.today, quick: o.quick > 0, center: o.center, ben: o.ben }
  return DAY_MAIN.filter((p) => has[p])
}

// Island v2: instant buttons. One click on the island logs it, no window:
// +10 / +25 / +50 push-ups, +250 ml, start a 25 min focus. They log through
// the island's normal actions (`reps`, `water`, `start`), so Sport Track,
// the water count and points follow exactly the same rules as anywhere else;
// nothing here pays anything. What the click changes shows at once (the
// island's optimistic snapshot), and Undo takes it back through the usual
// undo (and shows that at once too: `inverseAction`).
// Pure and tested with a pinned clock (islandInstant.test.ts).
import type { IslandAction, IslandSnapshot } from './islandModel'
import type { InstantId } from './islandLooks'
import type { ScrubKind } from './islandScrub'

export interface InstantBtn {
  id: InstantId
  label: string
  title: string
  action: IslandAction
  /** The counter you can scroll to change before logging. */
  scrub: ScrubKind
}

/** The exercise the push-up buttons log: your Sport Track push-ups if you have them, else the first exercise, else Push-ups. */
export function pushupsOf(s: Pick<IslandSnapshot, 'reps'>): { id: string; name: string } {
  const r = s.reps.find((x) => /push[\s-]?ups?/i.test(x.name)) ?? s.reps[0]
  return r ? { id: r.id, name: r.name } : { id: 'pushups', name: 'Push-ups' }
}

/** The action for a counter's value (what a scrolled counter logs on click). */
export function scrubAction(kind: ScrubKind, value: number, s: Pick<IslandSnapshot, 'reps' | 'now'>): IslandAction {
  if (kind === 'water') return { kind: 'water', ml: value }
  if (kind === 'focus') return { kind: 'start', subject: s.now?.title ?? 'Focus', minutes: value }
  const p = pushupsOf(s)
  return { kind: 'reps', id: p.id, name: p.name, n: value }
}

/** The instant buttons for your list, ready to tap. None while locked; no "start" while a timer runs. */
export function instantButtons(ids: InstantId[], s: Pick<IslandSnapshot, 'reps' | 'now' | 'running' | 'locked'>): InstantBtn[] {
  if (s.locked) return []
  const p = pushupsOf(s)
  const out: InstantBtn[] = []
  for (const id of ids) {
    if (id === 'push10' || id === 'push25' || id === 'push50') {
      const n = id === 'push10' ? 10 : id === 'push25' ? 25 : 50
      out.push({ id, label: `+${n}`, title: `Log ${n} ${p.name}`, action: scrubAction('reps', n, s), scrub: 'reps' })
    } else if (id === 'water250') out.push({ id, label: '+250 ml', title: 'Log a glass of water (250 ml)', action: { kind: 'water', ml: 250 }, scrub: 'water' })
    else if (id === 'focus25' && !s.running) out.push({ id, label: '▶ 25 min', title: `Start a 25 min focus${s.now ? `: ${s.now.title}` : ''}`, action: scrubAction('focus', 25, s), scrub: 'focus' })
  }
  return out
}

/** What undoing a tap changes, to show at once until the app's next picture (null: nothing to show). */
export function inverseAction(a: IslandAction): IslandAction | null {
  if (a.kind === 'water') return { kind: 'water', ml: -a.ml }
  if (a.kind === 'center' && a.op === 'count') return { ...a, amount: -a.amount }
  if (a.kind === 'reps') return { ...a, n: -a.n }
  if (a.kind === 'start') return { kind: 'stop' }
  if (a.kind === 'extend') return { kind: 'extend', minutes: -a.minutes }
  return null
}

/** Two clicks on the same button this close together are one click (a double-click logs once). */
export const INSTANT_GUARD_MS = 450

/** Should this click log? (false: the same button was just clicked). */
export function instantAllowed(last: { key: string; at: number } | null, key: string, now: number): boolean {
  return !last || last.key !== key || now - last.at >= INSTANT_GUARD_MS
}

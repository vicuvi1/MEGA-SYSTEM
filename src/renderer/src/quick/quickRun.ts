// Quick add's writes: each route goes through the app's EXISTING path (the
// same functions the Today page, Sport Track and the island use), so points,
// streaks and the sync rules stay exactly as they are. The one queue
// (core/quickQueue.ts) shows each line as done at once, writes in the
// background, retries with the same id, and offers Undo for 5 s.
import { createQuickQueue, QuickRefused, type QItem } from '@core/quickQueue'
import { canReplay, doneLine, type Route, type RouteCtx } from '@core/quickRoute'
import { repsKind } from '@core/bodyLog'
import { calendarDay } from '@core/dates'
import { life } from '../bridge'
import { applyShared, readSport } from '../sportTrack'
import { addWater, removeWaterEntry } from '../water'
import { capture } from '../capture'

const QUEUE_KEY = 'ls.quickQueue'
const LAST_KEY = 'ls.quickLast'
const COUNTER_KEY = 'ls.quickCounter'
const SOURCE = 'quick'

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private window: fine */
  }
}
const tell = (...names: string[]) => names.forEach((n) => window.dispatchEvent(new CustomEvent(n)))

/** The body log row id for this item (same on every try). */
const rowId = (id: string) => `qa-${id}`.slice(0, 60)
/** The meal id for this item (the food counter's own format). */
const mealId = (id: string) => `fd-${id.replace(/[^a-z0-9]/g, '').slice(0, 24)}`

/** The exercise "+50" adds to on this device ('' = push-ups). */
export const quickCounter = (): string => lsGet(COUNTER_KEY) ?? ''
export const setQuickCounter = (id: string) => lsSet(COUNTER_KEY, id)

/** The last lines you sent (newest first), for Up arrow = repeat. */
export function quickHistory(): string[] {
  try {
    const v = JSON.parse(lsGet(LAST_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}
function remember(line: string) {
  lsSet(LAST_KEY, JSON.stringify([line, ...quickHistory().filter((x) => x !== line)].slice(0, 10)))
}

const hm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** What the router needs: the checklist, your own habits, today and the time. */
export async function quickContext(): Promise<RouteCtx> {
  const sport = readSport() as any
  let exercises: { id: string; name: string }[] = Array.isArray(sport?.exercises)
    ? sport.exercises.filter((e: any) => e && !e.archived).map((e: any) => ({ id: String(e.id ?? e.name ?? ''), name: String(e.name ?? e.id ?? '') })).filter((e: { id: string }) => e.id)
    : []
  // This device's copy hasn't synced yet: the shared copy has the same checklist.
  if (!exercises.length) exercises = (await life.coach?.bodyLog?.exercises?.().catch(() => null)) ?? []
  const habits = await (life.extras?.habits?.() ?? Promise.resolve(null))
    .then((v) => (v?.rows ?? []).map((h) => ({ id: h.id, name: h.name, done: h.done })))
    .catch(() => [])
  // Saved foods and meals: "standard day", "breakfast", "2 eggs" log them.
  const saved = (await life.coach?.food?.savedNow?.().catch(() => undefined)) ?? undefined
  // Tasks say "tomorrow" by the calendar (midnight), like Todoist.
  return { today: calendarDay(), now: hm(), exercises, counter: quickCounter() || null, habits, saved }
}

/** Only some routes can be taken back from the toast (money goes through the rules, which have their own Undo). */
export const canUndo = (r: Route) => r.kind !== 'money' && r.kind !== 'ask'

async function run(r: Route, id: string): Promise<unknown> {
  switch (r.kind) {
    case 'reps': {
      // Sport Track's own path: one row in the body log (its id ignores a second copy), then the sums here.
      const log = life.coach?.bodyLog
      if (!log) throw new QuickRefused('Reps need the app to be signed in')
      const shared = await log.log([{ kind: repsKind(r.exId), amount: r.n, id: rowId(id) }], SOURCE)
      if (!shared) throw new QuickRefused('Open Sport Track once so it has your exercises')
      applyShared(shared)
      tell('life-body-changed')
      return rowId(id)
    }
    case 'water': {
      await addWater(r.ml, { source: SOURCE, id: rowId(id) })
      return rowId(id)
    }
    case 'food': {
      const food = life.coach?.food
      if (!food) throw new QuickRefused('Food needs the app to be signed in')
      // The standard day: each slot is its own meal, with its own fixed id (so a retry saves each once).
      if (r.meals?.length) {
        const ids = r.meals.map((_, i) => `${mealId(id).slice(0, 26)}${i}`)
        for (const [i, m] of r.meals.entries()) await food.add({ items: m.items, name: m.name, type: m.type, id: ids[i], source: 'saved', slot: m.slot })
        tell('life-body-changed', 'life-food-changed')
        return ids
      }
      await food.add({ items: r.items, name: r.name, id: mealId(id), source: r.saved ? 'saved' : 'quick-add' })
      tell('life-body-changed', 'life-food-changed')
      return mealId(id)
    }
    case 'task': {
      if (!life.todoist) throw new QuickRefused('Connect Todoist to add tasks')
      const t = await life.todoist.quickAdd(r.task.todoist)
      tell('life-external-changed')
      return t?.id ?? null
    }
    case 'focus': {
      const st = await life.focus.state().catch(() => null)
      if (st?.running) throw new QuickRefused(`A focus timer is already running (${st.running.subject})`)
      await life.focus.start(r.subject, r.minutes, null)
      tell('life-focus-changed')
      return r.subject
    }
    case 'note': {
      if (!life.notes) throw new QuickRefused('Notebook is not available here')
      const first = r.text.split(/[.!?\n]/)[0].trim().slice(0, 60) || 'Quick note'
      const save = (title: string) => life.notes!.save({ title, body: r.text })
      // A title another note has is refused: add the time to make it unique.
      const n = await save(first).catch(() => save(`${first} · ${new Date().toTimeString().slice(0, 8)}`))
      tell('life-notes-changed')
      return n.id
    }
    case 'habit': {
      if (!life.extras?.tapHabit) throw new QuickRefused('Habits are not available here')
      // The habit's own tap: logs today once and pays the habit rule once (its daily cap holds).
      await life.extras.tapHabit(r.id)
      tell('life-habits-changed', 'life-wallet-changed')
      return r.id
    }
    case 'money': {
      const out = await capture(r.text)
      if (!out.ok) throw new QuickRefused(out.said)
      return out.said
    }
    default:
      throw new QuickRefused(r.chip)
  }
}

async function undo(r: Route, _id: string, result: unknown): Promise<void> {
  switch (r.kind) {
    case 'reps': {
      const log = life.coach?.bodyLog
      if (!log || typeof result !== 'string') return
      const t = await log.toggle(result)
      if (t && !t.removed) await log.toggle(result) // it was already taken back elsewhere: leave it removed
      const shared = await log.log([], SOURCE).catch(() => null)
      if (shared) applyShared(shared)
      tell('life-body-changed')
      return
    }
    case 'water':
      if (typeof result === 'string') await removeWaterEntry(result)
      return
    case 'food':
      if (typeof result === 'string') await life.coach?.food?.toggle(result)
      if (Array.isArray(result)) for (const id of result) await life.coach?.food?.toggle(String(id))
      tell('life-body-changed', 'life-food-changed')
      return
    case 'task':
      if (typeof result === 'string' && life.todoist?.remove) await life.todoist.remove(result)
      tell('life-external-changed')
      return
    case 'focus': {
      const st = await life.focus.state().catch(() => null)
      if (st?.running && st.running.subject === r.subject) await life.focus.cancel()
      tell('life-focus-changed')
      return
    }
    case 'note':
      if (typeof result === 'string') await life.notes?.remove(result)
      tell('life-notes-changed')
      return
    case 'habit':
      await life.extras?.untapHabit?.(r.id)
      tell('life-habits-changed', 'life-wallet-changed')
      return
    default:
      throw new Error('Undo this one where it was saved')
  }
}

const storage = {
  get: () => lsGet(QUEUE_KEY),
  set: (v: string) => lsSet(QUEUE_KEY, v)
}

/** The one queue on this page. */
export const quickQueue = createQuickQueue<Route>({ run, undo, canReplay, store: storage })

let restored = false
/** Once per page: items still waiting from before a reload are sent again (or shown as unsure). */
export function restoreQuick(): void {
  if (restored) return
  restored = true
  quickQueue.restore()
}

/**
 * Sends one line. The toast shows it at once; the write runs right after.
 * Returns the queue item (its id is used for Undo).
 */
export function quickSubmit(line: string, r: Route): QItem<Route> | null {
  if (r.kind === 'ask') return null
  remember(line.trim())
  // The water ring moves now; it reads the log's real sum when the write lands.
  if (r.kind === 'water') window.dispatchEvent(new CustomEvent('life-water-optimistic', { detail: { ml: r.ml } }))
  return quickQueue.submit(r, doneLine(r))
}

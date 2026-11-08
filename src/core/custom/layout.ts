// Custom Center: what to draw where. `activeLayout(setup, now)` is the one
// call the island (and the app's home) needs: the mode on now, its widgets in
// the pill, the open island and the home, its looks merged over the base,
// its background, sounds and reminders. `widgetState` turns one widget into
// plain numbers and text, so any surface can draw it without knowing the
// rules. Also the layout edits the drag-and-drop uses (pure).
import { checksDone, localCount } from './counters'
import { activeMode, type ModeWhy } from './modes'
import { SLOT_MAX, SLOTS, type Background, type CustomSetup, type CustomState, type Layout, type Looks, type Mode, type ReminderRule, type Slot, type Widget } from './model'

/** Looks of a mode: its overrides over the base, part by part. */
export function mergeLooks(base: Looks, patch: Partial<Looks>): Looks {
  return { ...base, ...patch }
}

export interface ActiveLayout {
  mode: Mode
  why: ModeWhy
  pill: Widget[]
  island: Widget[]
  home: Widget[]
  looks: Looks
  background: Background
  /** The reminder rules that run now (on, and picked by the mode, or all when it picks none). */
  reminders: ReminderRule[]
  /** The Windows wallpaper for this mode, stored for the desktop phase ("local:<id>"), or null. */
  desktopWallpaper: string | null
}

export function activeLayout(setup: CustomSetup, now: number): ActiveLayout {
  const { mode, why } = activeMode(setup, now)
  const byId = new Map(setup.widgets.map((w) => [w.id, w]))
  const list = (ids: string[]) => ids.map((id) => byId.get(id)).filter((w): w is Widget => !!w)
  const picked = new Set(mode.reminders)
  return {
    mode,
    why,
    pill: list(mode.layout.pill),
    island: list(mode.layout.island),
    home: list(mode.layout.home),
    looks: mergeLooks(setup.looks, mode.looks),
    background: mode.background ?? setup.background,
    reminders: setup.reminders.filter((r) => r.on && (!picked.size || picked.has(r.id))),
    desktopWallpaper: mode.desktopWallpaper?.image ?? null
  }
}

/** Real numbers the app reads from its own logs, for counters that track them. */
export interface RealNumbers {
  /** Today's water (ml). */
  waterMl?: number
  /** Today's reps by Sport Track exercise id or lower-case name. */
  reps?: Record<string, number>
  /** A running focus timer: when it ends (ms) and its subject. */
  focus?: { endsAt: number; subject: string } | null
}

/** One widget as plain data any surface can draw. */
export interface WidgetView {
  id: string
  kind: Widget['kind']
  title: string
  icon: string
  color: string | null
  /** The big value, ready to show ("40", "12 days", "25:00", "3/5"). */
  value: string
  /** A small line under it ("of 100 push-ups", "Exam · 20 Nov"). */
  sub: string
  /** 0–1 when it has progress (counter, checklist, ring, running timer), else null. */
  progress: number | null
  /** True when the goal is met or the date has come. */
  done: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const startOfDay = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
/** Whole local days from `now` to a YYYY-MM-DD date (0 = today, negative = past). */
export function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(now)) / 864e5)
}

function counterValue(w: Extract<Widget, { kind: 'counter' }>, state: CustomState, real: RealNumbers, now: number): number {
  if (w.track === 'water') return Math.max(0, real.waterMl ?? 0)
  if (w.track === 'reps') {
    const r = real.reps ?? {}
    return Math.max(0, r[w.exercise] ?? r[w.exercise.toLowerCase()] ?? 0)
  }
  return localCount(state, w, now)
}

export function widgetState(w: Widget, ctx: { setup: Pick<CustomSetup, 'widgets' | 'looks'>; state: CustomState; real?: RealNumbers; now: number }): WidgetView {
  const real = ctx.real ?? {}
  const base = { id: w.id, kind: w.kind, title: w.title, icon: w.icon, color: w.color }
  switch (w.kind) {
    case 'counter': {
      const n = counterValue(w, ctx.state, real, ctx.now)
      return { ...base, value: String(n), sub: `of ${w.goal}${w.unit ? ` ${w.unit}` : ''}`, progress: Math.min(1, n / w.goal), done: n >= w.goal }
    }
    case 'checklist': {
      const done = checksDone(ctx.state, w, ctx.now).length
      const total = w.items.length
      return { ...base, value: `${done}/${total}`, sub: total ? (done >= total ? 'All done' : `${total - done} left`) : 'No items yet', progress: total ? done / total : 0, done: total > 0 && done >= total }
    }
    case 'ring': {
      const of = ctx.setup.widgets.find((x) => x.id === w.of)
      if (!of || of.kind === 'ring') return { ...base, value: '–', sub: 'Pick what it shows', progress: 0, done: false }
      const v = widgetState(of, ctx)
      return { ...base, value: `${Math.round((v.progress ?? 0) * 100)}%`, sub: of.title, progress: v.progress, done: v.done }
    }
    case 'countdown': {
      const d = daysUntil(w.date, ctx.now)
      const [y, m, dd] = w.date.split('-').map(Number)
      const when = new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      return { ...base, value: d > 1 ? `${d} days` : d === 1 ? 'Tomorrow' : d === 0 ? 'Today' : 'Done', sub: `${w.title} · ${when}`, progress: null, done: d <= 0 }
    }
    case 'timer': {
      const run = real.focus
      if (run && run.endsAt > ctx.now) {
        const left = Math.ceil((run.endsAt - ctx.now) / 1000)
        const total = w.focusMin * 60
        return { ...base, value: `${pad(Math.floor(left / 60))}:${pad(left % 60)}`, sub: run.subject, progress: Math.max(0, Math.min(1, 1 - left / total)), done: false }
      }
      return { ...base, value: `${pad(w.focusMin)}:00`, sub: `Focus ${w.focusMin} · break ${w.breakMin}${w.restMin ? ` · rest ${w.restMin}` : ''}`, progress: null, done: false }
    }
    case 'clock': {
      const c = ctx.setup.looks.clock
      const d = new Date(ctx.now)
      const h = c.h24 ? d.getHours() : d.getHours() % 12 || 12
      const value = `${c.h24 ? pad(h) : h}:${pad(d.getMinutes())}${c.seconds ? `:${pad(d.getSeconds())}` : ''}${c.h24 ? '' : d.getHours() < 12 ? ' am' : ' pm'}`
      let sub = c.date ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
      if (c.zone2) {
        try {
          const z = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !c.h24, timeZone: c.zone2 }).format(d)
          sub = `${sub ? `${sub} · ` : ''}${c.zone2.split('/').pop()!.replace(/_/g, ' ')} ${z}`
        } catch {
          /* an unknown zone: just your time */
        }
      }
      return { ...base, value, sub, progress: null, done: false }
    }
  }
}

// ---------------------------------------------------------------- names

/** A name that isn't taken yet: "Study list" → "Study list 2" (then 3…), kept to `max` characters. */
export function uniqueName(title: string, taken: Iterable<string>, max = 40): string {
  const used = new Set([...taken].map((t) => t.trim().toLowerCase()))
  const base = title.trim() || 'My widget'
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 100; n++) {
    const tail = ` ${n}`
    const t = `${base.slice(0, max - tail.length).trimEnd()}${tail}`
    if (!used.has(t.toLowerCase())) return t
  }
  return base
}

/**
 * No two widgets with the same name in one mode's layout (pill, open island
 * and home together): a later one gets " 2", " 3"… Widgets only in other
 * modes keep their names. Returns new widget objects only where a name changed.
 */
export function uniqueLayoutNames<W extends { id: string; title: string }>(widgets: W[], modes: { layout: Layout }[]): W[] {
  const title = new Map(widgets.map((w) => [w.id, w.title]))
  // Twice: a new name could meet a widget of an earlier mode (rare; the second pass settles it).
  for (let pass = 0; pass < 2; pass++) {
    for (const m of modes) {
      const seen: string[] = []
      for (const id of [...m.layout.pill, ...m.layout.island, ...m.layout.home]) {
        const t = title.get(id)
        if (t == null) continue
        const next = seen.some((x) => x.toLowerCase() === t.trim().toLowerCase()) ? uniqueName(t, [...seen, ...title.values()]) : t
        if (next !== t) title.set(id, next)
        seen.push(next)
      }
    }
  }
  return widgets.map((w) => (title.get(w.id) === w.title ? w : { ...w, title: title.get(w.id)! }))
}

// ---------------------------------------------------------------- layout edits (drag and drop, keyboard)

/** Where a widget sits in a layout, or null. */
export function slotOf(l: Layout, id: string): { slot: Slot; index: number } | null {
  for (const slot of SLOTS) {
    const index = l[slot].indexOf(id)
    if (index >= 0) return { slot, index }
  }
  return null
}

/**
 * Puts a widget in `to` at `index` (taking it out of where it was). A full
 * place refuses (returns the same layout and `full`).
 */
export function placeWidget(l: Layout, id: string, to: Slot | null, index = Infinity): { layout: Layout; full: boolean } {
  const from = slotOf(l, id)
  const next: Layout = { pill: l.pill.filter((x) => x !== id), island: l.island.filter((x) => x !== id), home: l.home.filter((x) => x !== id) }
  if (!to) return { layout: next, full: false }
  if (next[to].length >= SLOT_MAX[to] && from?.slot !== to) return { layout: l, full: true }
  const at = Math.max(0, Math.min(next[to].length, index))
  next[to] = [...next[to].slice(0, at), id, ...next[to].slice(at)]
  return { layout: next, full: false }
}

/** Keyboard: one step up or down inside its place, or into the next place. */
export function nudgeWidget(l: Layout, id: string, dir: 'up' | 'down' | 'prevSlot' | 'nextSlot'): Layout {
  const where = slotOf(l, id)
  if (!where) return dir === 'nextSlot' || dir === 'down' ? placeWidget(l, id, 'pill').layout : l
  if (dir === 'up' || dir === 'down') return placeWidget(l, id, where.slot, where.index + (dir === 'up' ? -1 : 1)).layout
  const i = SLOTS.indexOf(where.slot) + (dir === 'nextSlot' ? 1 : -1)
  if (i < 0) return l
  if (i >= SLOTS.length) return placeWidget(l, id, null).layout
  return placeWidget(l, id, SLOTS[i]).layout
}

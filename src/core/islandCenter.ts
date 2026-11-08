// The Custom Center on the desktop island (docs/areas/custom.md, island.md).
// The app window reads your set-up and builds ONE small, plain view for the
// island snapshot (`snap.center`): the mode on now, its looks turned into the
// island's own look values, and the widgets for the pill and the open island
// as ready-to-draw cards. The island window only draws them and sends taps
// back. Your custom reminder rules fire from here too (the gate keeps the
// app's protections and caps). Pure and tested (islandCenter.test.ts).
//
// Untouched looks keep today's island: only a Center look you changed from
// the Center's own default becomes an island look.
import { activeLayout, DEFAULT_GATE, DEFAULT_LOOKS as CENTER_LOOKS, fireInput, nextFire, reminderGate, widgetState, type CounterTrack, type CustomSetup, type CustomState, type GateContext, type GateWhy, type Looks, type RealNumbers, type ReminderRule, type Widget } from './custom'
import { checksDone } from './custom/counters'
import { calendarDay } from './dates'
import type { IslandLooks } from './islandLooks'

// ---------------------------------------------------------------- looks

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The Center's looks as island looks: only the parts you changed (a part
 * still at the Center's default stays the island's own default).
 */
export function centerLooksToIsland(l: Looks, d: Looks = CENTER_LOOKS): Partial<IslandLooks> {
  const out: Partial<IslandLooks> = {}
  const i = l.island
  if (i.size !== d.island.size) out.size = i.size === 's' ? 'small' : i.size === 'l' ? 'large' : 'medium'
  if (i.radius !== d.island.radius) out.radius = i.radius
  if (i.position && i.position !== 'auto') out.position = i.position
  if (i.openW || i.openH) out.openSize = { width: i.openW || null, height: i.openH || null }
  if (!same(l.motion, d.motion)) {
    const ev = l.motion.events
    out.motion = { style: l.motion.style, speed: l.motion.speed, bounce: l.motion.bounce, events: { open: { style: ev.open }, close: { style: ev.open }, notify: { style: ev.notify }, peek: { style: ev.notify } } }
  }
  if (l.colors.accent !== d.colors.accent) out.accent = l.colors.accent
  if (l.colors.glow !== d.colors.glow) out.glow = l.colors.glow <= 0.02 ? 'off' : l.colors.glow < 0.55 ? 'soft' : 'strong'
  if (l.colors.blur !== d.colors.blur) out.blur = l.colors.blur
  if (l.font.family !== d.font.family) out.font = l.font.family
  if (l.font.numbers !== d.font.numbers) out.numbers = l.font.numbers === 'plain' ? 'normal' : l.font.numbers
  if (!same(l.clock, d.clock)) out.clock = { style: l.clock.style, hour12: !l.clock.h24, seconds: l.clock.seconds, date: l.clock.date, zone: l.clock.zone2 || null }
  if (l.celebrate !== d.celebrate) out.celebration = l.celebrate
  if (!same(l.sounds, d.sounds)) {
    const s = l.sounds
    const v = (k: number) => Math.round(s.volume * k * 1000) / 1000
    out.sound = {
      pack: s.pack === 'off' ? 'none' : s.pack,
      volume: { tap: v(s.kinds.open), done: v(s.kinds.done), notify: v(s.kinds.notify), reminder: v(s.kinds.reminder), error: v(s.kinds.notify) },
      files: { ...s.files }
    }
  }
  return out
}

// ---------------------------------------------------------------- widgets

/** One widget, ready for the island to draw (plain data, no rules). */
export interface CenterCard {
  id: string
  kind: Widget['kind']
  title: string
  icon: string
  color: string | null
  value: string
  sub: string
  progress: number | null
  done: boolean
  /** Counter: its + buttons, unit, goal, what it counts and its number. */
  steps?: number[]
  unit?: string
  goal?: number
  track?: CounterTrack
  n?: number
  /** Checklist: its items, ticked or not. */
  items?: { id: string; text: string; done: boolean }[]
  /** Timer: a running focus timer's end (ms), its minutes and subject. */
  endsAt?: number | null
  focusMin?: number
  subject?: string
}

export interface CenterIsland {
  /** Changes when the mode or a saved set-up changes (the island reads its looks again and morphs). */
  key: string
  mode: { id: string; name: string; icon: string; why: 'manual' | 'schedule' | 'base' }
  modes: { id: string; name: string; icon: string }[]
  looks: Partial<IslandLooks>
  pill: CenterCard[]
  island: CenterCard[]
}

function card(w: Widget, setup: CustomSetup, state: CustomState, real: RealNumbers, now: number): CenterCard {
  const v = widgetState(w, { setup, state, real, now })
  const c: CenterCard = { id: v.id, kind: v.kind, title: v.title, icon: v.icon, color: v.color, value: v.value, sub: v.sub, progress: v.progress, done: v.done }
  if (w.kind === 'counter') Object.assign(c, { steps: w.steps.slice(0, 4), unit: w.unit, goal: w.goal, track: w.track, n: Number(v.value) || 0 })
  if (w.kind === 'checklist') {
    const done = new Set(checksDone(state, w, now))
    c.items = w.items.map((it) => ({ id: it.id, text: it.text, done: done.has(it.id) }))
  }
  if (w.kind === 'timer') Object.assign(c, { endsAt: real.focus && real.focus.endsAt > now ? real.focus.endsAt : null, focusMin: w.focusMin, subject: w.subject || w.title })
  return c
}

/**
 * The island's view of your set-up now, or null when there is nothing to
 * show (a set-up never saved and with no widgets keeps today's island).
 */
export function centerIslandView(setup: CustomSetup, state: CustomState, real: RealNumbers, now: number): CenterIsland | null {
  if (!setup.savedAt && !setup.widgets.length) return null
  const a = activeLayout(setup, now)
  const looks = centerLooksToIsland(a.looks)
  return {
    key: `${a.mode.id}:${setup.savedAt}`,
    mode: { id: a.mode.id, name: a.mode.name, icon: a.mode.icon, why: a.why },
    modes: setup.modes.map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    looks,
    pill: a.pill.map((w) => card(w, setup, state, real, now)),
    island: a.island.map((w) => card(w, setup, state, real, now))
  }
}

// ---------------------------------------------------------------- reminders

export { CENTER_CARD_MS, CENTER_LATER_MIN, centerReminderSound, centerRuleOf, isCenterReminder } from './islandCenterCard'
import { CENTER_LATER_MIN } from './islandCenterCard'

export interface ReminderTick {
  /** The rule to show now, or null. */
  fire: ReminderRule | null
  /** Why each due rule did not show (for the Center page), by rule id. */
  held: Record<string, GateWhy>
}

/**
 * Which custom reminder (if any) fires now. Only rules of the mode on now,
 * only when due (`nextFire`, or an "In 10 min" that came round), and only
 * when the gate allows it: a call or meeting, a focus timer, quiet time,
 * bedtime, the gap since the last interruption, the rule's cap and the day's
 * cap (12) all hold it back. At most one at a time.
 */
export function centerReminderTick(o: {
  setup: CustomSetup
  state: CustomState
  now: number
  activeSince: number | null
  /** "In 10 min" answers: rule id → when it may come back (ms). */
  later: Record<string, number>
  ctx: Omit<GateContext, 'now' | 'shownToday' | 'dayCap' | 'gapMin'> & Partial<Pick<GateContext, 'gapMin' | 'dayCap'>>
}): ReminderTick {
  const { setup, state, now } = o
  const day = calendarDay(new Date(now))
  const shownToday = Object.values(state.fired).reduce((n, f) => n + (f.day === day ? f.n : 0), 0)
  const ctx: GateContext = { ...o.ctx, now, shownToday, gapMin: o.ctx.gapMin ?? DEFAULT_GATE.gapMin, dayCap: o.ctx.dayCap ?? DEFAULT_GATE.dayCap }
  const held: Record<string, GateWhy> = {}
  for (const r of activeLayout(setup, now).reminders) {
    const fi = fireInput(state, r.id, now, o.activeSince)
    const back = o.later[r.id]
    const due = back != null ? back <= now : (() => {
      const t = nextFire(r, now, fi)
      return t != null && t <= now
    })()
    if (!due) continue
    const g = reminderGate(r, fi.todayCount, ctx)
    if (!g.show) {
      held[r.id] = g.why
      continue
    }
    return { fire: r, held }
  }
  return { fire: null, held }
}

/** The island card for a rule that fires. */
export function centerReminderAlert(r: ReminderRule, now: number, logTitle?: string | null) {
  const done = r.log ? `✓ Done (+${r.log.amount}${logTitle ? ` ${logTitle}` : ''})` : '✓ Done'
  return {
    id: `custom:${r.id}:${now}`,
    kind: 'remind' as const,
    face: r.icon,
    title: r.text,
    text: 'Your reminder',
    actions: [
      { label: done, action: { kind: 'center' as const, op: 'remind' as const, rule: r.id, answer: 'done' as const, alertId: `custom:${r.id}:${now}` }, primary: true },
      { label: `In ${CENTER_LATER_MIN} min`, action: { kind: 'center' as const, op: 'remind' as const, rule: r.id, answer: 'later' as const, alertId: `custom:${r.id}:${now}` } }
    ]
  }
}

// ---------------------------------------------------------------- the Windows wallpaper (which picture now)

/** The mode's picture for now: the evening one from 20:00 to 06:00 when there is one. */
export function wallpaperFor(w: { image: string; night?: string } | null, now: number): string | null {
  if (!w?.image) return null
  const h = new Date(now).getHours()
  return w.night && (h >= 20 || h < 6) ? w.night : w.image
}

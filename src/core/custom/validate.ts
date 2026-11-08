// Custom Center: cleaning. Anything that comes in (the synced copy, a file
// you import, a template) goes through `cleanSetup` and comes out as a safe,
// complete CustomSetup: unknown kinds and fields dropped, numbers bounded,
// text clipped, colours checked, ids made safe, layout pointing only at
// widgets that exist. Nothing here is ever run as code.
import {
  ACTIONS_MAX, CHECK_ITEMS_MAX, COUNTER_STEPS_MAX, CUSTOM_VERSION, DEFAULT_LOOKS, DEFAULT_MODE, DEFAULT_SOUNDS, MODES_MAX, NO_BACKGROUND, REMINDERS_MAX, SLOTS, SLOT_MAX, SOUND_KINDS, STEPS_MAX, WIDGETS_MAX, WIDGET_KINDS, WINDOWS_MAX,
  type ActionStep, type Background, type CustomAction, type CustomSetup, type CustomState, type DesktopWallpaper, type Layout, type Looks, type Mode, type ModeWindow, type MotionStyle, type ReminderRule, type SoundPack, type Widget
} from './model'
import { MAX_SHOW_THROUGH } from '../wallpaper'

// ---------------------------------------------------------------- small cleaners

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {})
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
/** One line of plain text: no control characters, no angle brackets, clipped. */
export const text = (v: unknown, max: number, d = ''): string => {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || d
}
export const num = (v: unknown, lo: number, hi: number, d: number, step = 0): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  const x = Math.min(hi, Math.max(lo, n))
  return step ? Math.round(x / step) * step : x
}
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d))
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i
export const okId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const okHM = (v: unknown): v is string => typeof v === 'string' && HM.test(v)
const hm = (v: unknown, d: string) => (okHM(v) ? v : d)
const HEX = /^#[0-9a-f]{6}$/i
export const okColor = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
const color = (v: unknown, d: string) => (okColor(v) ? v.toLowerCase() : d)
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const okDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v)
/** A reference to a file kept on this device. */
const LOCAL = /^local:[a-z0-9_-]{1,40}$/i
const local = (v: unknown) => (typeof v === 'string' && LOCAL.test(v) ? v : '')
/** An emoji or a short symbol (no letters soup). */
const icon = (v: unknown, d: string) => {
  const s = text(v, 8)
  return s && [...s].length <= 4 ? s : d
}
const days = (v: unknown): number[] => [...new Set(arr(v).map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 6))].sort()
/** Unique ids: a repeated or bad id gets a new one so nothing points at two things. */
function uniqueIds<T extends { id: string }>(list: T[], prefix: string): T[] {
  const seen = new Set<string>()
  return list.map((x, i) => {
    let id = okId(x.id) ? x.id : `${prefix}${i}`
    while (seen.has(id)) id = `${id.slice(0, 36)}${i}x`.slice(0, 40)
    seen.add(id)
    return { ...x, id }
  })
}

// ---------------------------------------------------------------- widgets

export function cleanWidget(raw: unknown): Widget | null {
  const w = obj(raw)
  const kind = WIDGET_KINDS.includes(w.kind) ? (w.kind as Widget['kind']) : null
  if (!kind) return null
  const base = { id: String(w.id ?? ''), title: text(w.title, 40, kind === 'clock' ? 'Clock' : 'My widget'), icon: icon(w.icon, '✦'), color: okColor(w.color) ? String(w.color).toLowerCase() : null }
  switch (kind) {
    case 'counter': {
      const steps = [...new Set(arr(w.steps).map(Number).filter((s) => Number.isFinite(s) && s >= 1).map((s) => int(s, 1, 10_000, 1)))].slice(0, COUNTER_STEPS_MAX)
      const track = pick(w.track, ['none', 'water', 'reps'] as const, 'none')
      return { ...base, kind, goal: int(w.goal, 1, 100_000, 100), steps: steps.length ? steps : [1], unit: text(w.unit, 12, track === 'water' ? 'ml' : track === 'reps' ? 'reps' : ''), resetAt: hm(w.resetAt, '04:00'), track, exercise: track === 'reps' ? text(w.exercise, 40) : '' }
    }
    case 'timer':
      return { ...base, kind, focusMin: int(w.focusMin, 5, 180, 50), breakMin: int(w.breakMin, 1, 60, 10), restMin: int(w.restMin, 0, 90, 0), subject: text(w.subject, 40, base.title) }
    case 'countdown':
      return { ...base, kind, date: okDay(w.date) ? w.date : '2030-01-01' }
    case 'checklist': {
      const items = uniqueIds(arr(w.items).map((it) => ({ id: String(obj(it).id ?? ''), text: text(obj(it).text, 60) })).filter((it) => it.text), 'c').slice(0, CHECK_ITEMS_MAX)
      return { ...base, kind, items, resetAt: hm(w.resetAt, '04:00') }
    }
    case 'ring':
      return { ...base, kind, of: okId(w.of) ? w.of : '' }
    case 'clock':
      return { ...base, kind }
  }
}

// ---------------------------------------------------------------- actions

/** The pages an action may open (a closed list). */
export const ACTION_PAGES = ['today', 'calendar', 'tasks', 'coach', 'goals', 'progress', 'body', 'music', 'sleep', 'money', 'notebook', 'custom'] as const

export function cleanStep(raw: unknown): ActionStep | null {
  const s = obj(raw)
  switch (s.do) {
    case 'focus':
      return { do: 'focus', minutes: int(s.minutes, 5, 180, 50), subject: text(s.subject, 40, 'Focus') }
    case 'stopFocus':
      return { do: 'stopFocus' }
    case 'music':
      return { do: 'music', station: text(s.station, 40, 'Focus') }
    case 'quiet':
      return { do: 'quiet', minutes: int(s.minutes, 5, 240, 60) }
    case 'dnd':
      return { do: 'dnd' }
    case 'mode':
      return okId(s.mode) ? { do: 'mode', mode: s.mode } : null
    case 'open':
      return (ACTION_PAGES as readonly string[]).includes(s.page) ? { do: 'open', page: s.page } : null
    case 'count':
      return okId(s.widget) ? { do: 'count', widget: s.widget, amount: int(s.amount, -10_000, 10_000, 1) || 1 } : null
    default:
      return null
  }
}

export function cleanAction(raw: unknown): CustomAction | null {
  const a = obj(raw)
  const steps = arr(a.steps).map(cleanStep).filter((s): s is ActionStep => !!s).slice(0, STEPS_MAX)
  if (!steps.length) return null
  return { id: String(a.id ?? ''), name: text(a.name, 40, 'My action'), icon: icon(a.icon, '⚡'), steps }
}

// ---------------------------------------------------------------- reminders

export function cleanReminder(raw: unknown): ReminderRule | null {
  const r = obj(raw)
  const t = text(r.text, 80)
  if (!t) return null
  const kind = pick(r.kind, ['every', 'at'] as const, 'every')
  const log = obj(r.log)
  return {
    id: String(r.id ?? ''),
    text: t,
    icon: icon(r.icon, '⏰'),
    on: bool(r.on, true),
    kind,
    everyMin: int(r.everyMin, 10, 480, 45),
    atPc: bool(r.atPc, kind === 'every'),
    at: hm(r.at, '21:00'),
    days: days(r.days),
    from: okHM(r.from) && okHM(r.to) ? r.from : '',
    to: okHM(r.from) && okHM(r.to) ? r.to : '',
    cap: int(r.cap, 1, 24, kind === 'at' ? 1 : 8),
    log: okId(log.widget) ? { widget: log.widget, amount: int(log.amount, 1, 10_000, 1) } : null
  }
}

// ---------------------------------------------------------------- looks

const MOTION: readonly MotionStyle[] = ['spring', 'smooth', 'snappy', 'off']

export function cleanSounds(raw: unknown, base: SoundPack = DEFAULT_SOUNDS): SoundPack {
  const s = obj(raw)
  const k = obj(s.kinds)
  const f = obj(s.files)
  const files: SoundPack['files'] = {}
  for (const kind of SOUND_KINDS) if (local(f[kind])) files[kind] = local(f[kind])
  return {
    pack: pick(s.pack, ['default', 'soft', 'arcade', 'glass', 'off'] as const, base.pack),
    volume: num(s.volume, 0, 1, base.volume, 0.05),
    kinds: Object.fromEntries(SOUND_KINDS.map((kind) => [kind, num(k[kind], 0, 1, base.kinds[kind], 0.05)])) as SoundPack['kinds'],
    files
  }
}

/** Full looks: every part checked, missing parts from `base`. */
export function cleanLooks(raw: unknown, base: Looks = DEFAULT_LOOKS): Looks {
  const l = obj(raw)
  const i = obj(l.island)
  const m = obj(l.motion)
  const ev = obj(m.events)
  const c = obj(l.colors)
  const f = obj(l.font)
  const k = obj(l.clock)
  return {
    island: { size: pick(i.size, ['s', 'm', 'l'] as const, base.island.size), shape: pick(i.shape, ['notch', 'capsule', 'bar'] as const, base.island.shape), radius: int(i.radius, 0, 32, base.island.radius) },
    motion: {
      style: pick(m.style, MOTION, base.motion.style),
      speed: num(m.speed, 0.5, 2, base.motion.speed, 0.05),
      bounce: num(m.bounce, 0, 1, base.motion.bounce, 0.05),
      events: { open: pick(ev.open, MOTION, base.motion.events.open), notify: pick(ev.notify, MOTION, base.motion.events.notify), celebrate: pick(ev.celebrate, MOTION, base.motion.events.celebrate) }
    },
    // Blur stays at 12 px at most (the motion budget).
    colors: { accent: color(c.accent, base.colors.accent), glow: num(c.glow, 0, 1, base.colors.glow, 0.05), blur: int(c.blur, 0, 12, base.colors.blur), theme: pick(c.theme, ['auto', 'dark', 'light'] as const, base.colors.theme) },
    font: { family: pick(f.family, ['system', 'rounded', 'mono', 'serif'] as const, base.font.family), numbers: pick(f.numbers, ['plain', 'tabular', 'segment'] as const, base.font.numbers) },
    clock: { style: pick(k.style, ['digital', 'analog'] as const, base.clock.style), h24: bool(k.h24, base.clock.h24), seconds: bool(k.seconds, base.clock.seconds), date: bool(k.date, base.clock.date), zone2: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(String(k.zone2 ?? '')) ? String(k.zone2) : k.zone2 === '' ? '' : base.clock.zone2 },
    celebrate: pick(l.celebrate, ['confetti', 'burst', 'glow', 'none'] as const, base.celebrate),
    sounds: cleanSounds(l.sounds, base.sounds)
  }
}

/** A mode's overrides: only the parts that are there, each checked. */
export function cleanLooksPatch(raw: unknown): Partial<Looks> {
  const l = obj(raw)
  const full = cleanLooks(l)
  const out: Partial<Looks> = {}
  for (const k of Object.keys(DEFAULT_LOOKS) as (keyof Looks)[]) if (k in l && l[k] != null) (out as any)[k] = full[k]
  return out
}

export function cleanBackground(raw: unknown): Background {
  const b = obj(raw)
  const colors = arr(b.colors).filter(okColor).map((c: string) => c.toLowerCase()).slice(0, 3)
  const image = local(b.image)
  let kind = pick(b.kind, ['none', 'gradient', 'image'] as const, 'none')
  if (kind === 'image' && !image) kind = 'none'
  return { kind, colors: colors.length >= 2 ? colors : NO_BACKGROUND.colors, angle: int(b.angle, 0, 360, NO_BACKGROUND.angle), animate: bool(b.animate, false), image, strength: num(b.strength, 0.1, MAX_SHOW_THROUGH, NO_BACKGROUND.strength, 0.05) }
}

function cleanWallpaper(raw: unknown): DesktopWallpaper | null {
  const image = local(obj(raw).image)
  return image ? { image } : null
}

// ---------------------------------------------------------------- modes and layout

function cleanWindow(raw: unknown): ModeWindow | null {
  const w = obj(raw)
  if (!okHM(w.from)) return null
  return { days: days(w.days), from: w.from, to: okHM(w.to) && w.to !== w.from ? w.to : '' }
}

/** Only ids of widgets that exist, each once across the three places, at most the place's size. */
export function cleanLayout(raw: unknown, widgetIds: Set<string>): Layout {
  const l = obj(raw)
  const used = new Set<string>()
  const out: Layout = { pill: [], island: [], home: [] }
  for (const slot of SLOTS) {
    for (const id of arr(l[slot])) {
      if (typeof id !== 'string' || !widgetIds.has(id) || used.has(id) || out[slot].length >= SLOT_MAX[slot]) continue
      used.add(id)
      out[slot].push(id)
    }
  }
  return out
}

function cleanMode(raw: unknown, widgetIds: Set<string>, reminderIds: Set<string>): Mode | null {
  const m = obj(raw)
  return {
    id: String(m.id ?? ''),
    name: text(m.name, 24, 'My mode'),
    icon: icon(m.icon, '✦'),
    layout: cleanLayout(m.layout, widgetIds),
    looks: cleanLooksPatch(m.looks),
    background: m.background == null ? null : cleanBackground(m.background),
    desktopWallpaper: cleanWallpaper(m.desktopWallpaper),
    reminders: [...new Set(arr(m.reminders).filter((id): id is string => typeof id === 'string' && reminderIds.has(id)))],
    schedule: arr(m.schedule).map(cleanWindow).filter((w): w is ModeWindow => !!w).slice(0, WINDOWS_MAX)
  }
}

// ---------------------------------------------------------------- the whole set-up

/**
 * A safe, complete set-up from anything (already migrated to CUSTOM_VERSION).
 * Never throws.
 */
export function cleanSetup(raw: unknown): CustomSetup {
  const s = obj(raw)
  const widgets = uniqueIds(arr(s.widgets).map(cleanWidget).filter((w): w is Widget => !!w), 'w').slice(0, WIDGETS_MAX)
  const widgetIds = new Set(widgets.map((w) => w.id))
  // A ring shows a counter or a checklist that exists, else nothing.
  for (const w of widgets) if (w.kind === 'ring' && !widgets.some((x) => x.id === w.of && (x.kind === 'counter' || x.kind === 'checklist'))) w.of = ''
  const reminders = uniqueIds(arr(s.reminders).map(cleanReminder).filter((r): r is ReminderRule => !!r), 'r').slice(0, REMINDERS_MAX)
  for (const r of reminders) if (r.log && !widgets.some((w) => w.id === r.log!.widget && w.kind === 'counter')) r.log = null
  const reminderIds = new Set(reminders.map((r) => r.id))
  let modes = uniqueIds(arr(s.modes).map((m) => cleanMode(m, widgetIds, reminderIds)).filter((m): m is Mode => !!m), 'm').slice(0, MODES_MAX)
  if (!modes.length) modes = [{ ...DEFAULT_MODE, layout: { pill: [], island: [], home: [] } }]
  const modeIds = new Set(modes.map((m) => m.id))
  const actions = uniqueIds(arr(s.actions).map(cleanAction).filter((a): a is CustomAction => !!a), 'a').slice(0, ACTIONS_MAX)
  for (const a of actions) a.steps = a.steps.filter((st) => (st.do === 'mode' ? modeIds.has(st.mode) : st.do === 'count' ? widgetIds.has(st.widget) : true))
  const manual = obj(s.manual)
  return {
    version: CUSTOM_VERSION,
    widgets,
    actions: actions.filter((a) => a.steps.length),
    reminders,
    modes,
    baseMode: modeIds.has(s.baseMode) ? s.baseMode : modes[0].id,
    manual: modeIds.has(manual.mode) && Number.isFinite(Number(manual.at)) ? { mode: manual.mode, at: Number(manual.at), until: Number.isFinite(Number(manual.until)) && manual.until != null ? Number(manual.until) : null } : null,
    looks: cleanLooks(s.looks),
    background: cleanBackground(s.background),
    savedAt: Number.isFinite(Number(s.savedAt)) ? Number(s.savedAt) : 0
  }
}

export function cleanState(raw: unknown): CustomState {
  const s = obj(raw)
  const out: CustomState = { counters: {}, checks: {}, fired: {} }
  for (const [id, v] of Object.entries(obj(s.counters)).slice(0, 80)) if (okId(id) && okDay(obj(v).day)) out.counters[id] = { day: obj(v).day, n: num(obj(v).n, -1e6, 1e6, 0) }
  for (const [id, v] of Object.entries(obj(s.checks)).slice(0, 80)) if (okId(id) && okDay(obj(v).day)) out.checks[id] = { day: obj(v).day, done: arr(obj(v).done).filter(okId).slice(0, CHECK_ITEMS_MAX) }
  for (const [id, v] of Object.entries(obj(s.fired)).slice(0, 80)) if (okId(id) && okDay(obj(v).day)) out.fired[id] = { day: obj(v).day, at: num(obj(v).at, 0, 1e15, 0), n: int(obj(v).n, 0, 100, 0) }
  return out
}

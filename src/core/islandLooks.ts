// Island v2: every look and widget switch the island supports, as one typed
// object with defaults that keep today's island exactly as it is. The island
// reads them through ONE adapter (src/renderer/src/island/lookAdapter.ts), so
// the Custom Center can later hand its own values in with one small change.
// Pure and tested (islandLooks.test.ts): `cleanLooks` / `cleanWidgets` accept
// anything (old saves, half objects, wrong types) and always return a whole,
// safe object.

/** How a motion feels: a spring with overshoot, a smooth ease, a quick snap, or none. */
export type MotionStyle = 'spring' | 'smooth' | 'snappy' | 'off'
/** The moments that move: the island opening and closing, a peek, the split pill, a notification, a tap. */
export type MotionEvent = 'open' | 'close' | 'peek' | 'split' | 'notify' | 'tap'
export const MOTION_EVENTS: MotionEvent[] = ['open', 'close', 'peek', 'split', 'notify', 'tap']

export interface EventMotion {
  style?: MotionStyle
  /** 0.5 (slow) … 2 (fast); 1 = normal. */
  speed?: number
  /** 0 (no overshoot) … 1 (very bouncy). */
  bounce?: number
}

export type LiveKind = 'timer' | 'eyes' | 'workout' | 'meeting' | 'music' | 'water'
export const LIVE_KINDS: LiveKind[] = ['timer', 'eyes', 'workout', 'meeting', 'music', 'water']
export type InstantId = 'push10' | 'push25' | 'push50' | 'water250' | 'focus25'
export const INSTANT_IDS: InstantId[] = ['push10', 'push25', 'push50', 'water250', 'focus25']
export type SoundKind = 'tap' | 'done' | 'notify' | 'reminder' | 'error'
export const SOUND_KINDS: SoundKind[] = ['tap', 'done', 'notify', 'reminder', 'error']

export interface IslandLooks {
  /** The pill's size. */
  size: 'small' | 'medium' | 'large'
  /** Corner radius in px for the capsule; null = the shape's own (notch / capsule). */
  radius: number | null
  /** Where it sits; null = where you dragged it (today's behaviour). */
  position: 'top-center' | 'top-left' | 'top-right' | null
  /** The opened island's size in px; null = fits your screen (today's behaviour). */
  openSize: { width: number | null; height: number | null }
  motion: {
    /** 'auto' = Settings → Desktop island → Animations (today's behaviour). */
    style: MotionStyle | 'auto'
    speed: number
    bounce: number
    /** Per moment: overrides the three values above. */
    events: Partial<Record<MotionEvent, EventMotion>>
  }
  /** Accent colour (#rrggbb); null = the theme's. */
  accent: string | null
  /** The glow behind the pill: off, soft, strong, or the colour of what is playing. */
  glow: 'off' | 'soft' | 'strong' | 'music'
  /** Background blur in px (0 … 40). */
  blur: number
  font: 'system' | 'rounded' | 'mono' | 'serif'
  numbers: 'normal' | 'tabular' | 'rounded'
  clock: {
    style: 'digital' | 'analog'
    hour12: boolean
    seconds: boolean
    date: boolean
    /** A second time zone (IANA name) shown next to yours; null = none. */
    zone: string | null
  }
  celebration: 'confetti' | 'glow' | 'ripple' | 'none'
  sound: { pack: 'default' | 'soft' | 'none'; volume: Record<SoundKind, number> }
}

export interface IslandWidgets {
  /** Two live things at once share the pill (timer left, music right). */
  split: boolean
  /** Which live things may show in the pill. */
  live: Record<LiveKind, boolean>
  /** The one-click buttons on the island, in order. */
  instant: InstantId[]
  /** Scroll over a counter to change its number before you log it. */
  scrub: boolean
  /** Drop a file or a link on the island to save it as a task or a note. */
  drop: boolean
  /** Swipe, long-press and hover gestures. */
  gestures: boolean
}

export const DEFAULT_LOOKS: IslandLooks = {
  size: 'medium',
  radius: null,
  position: null,
  openSize: { width: null, height: null },
  motion: { style: 'auto', speed: 1, bounce: 0.35, events: {} },
  accent: null,
  glow: 'music',
  blur: 20,
  font: 'system',
  numbers: 'tabular',
  clock: { style: 'digital', hour12: false, seconds: false, date: false, zone: null },
  celebration: 'confetti',
  sound: { pack: 'default', volume: { tap: 0.7, done: 0.8, notify: 0.8, reminder: 0.8, error: 0.6 } }
}

export const DEFAULT_WIDGETS: IslandWidgets = {
  split: true,
  live: { timer: true, eyes: true, workout: true, meeting: true, music: true, water: true },
  instant: ['push10', 'push25', 'push50', 'water250', 'focus25'],
  scrub: true,
  drop: true,
  gestures: true
}

const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const STYLES: MotionStyle[] = ['spring', 'smooth', 'snappy', 'off']

/** A colour the island can use: #rgb or #rrggbb only (anything else: null). */
export function cleanColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  return null
}

/** A time zone Intl knows, else null. */
export function cleanZone(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 64) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: v.trim() })
    return v.trim()
  } catch {
    return null
  }
}

export function cleanLooks(raw: unknown): IslandLooks {
  const r = obj(raw)
  const d = DEFAULT_LOOKS
  const m = obj(r.motion)
  const events: Partial<Record<MotionEvent, EventMotion>> = {}
  const ev = obj(m.events)
  for (const k of MOTION_EVENTS) {
    const e = obj(ev[k])
    if (!Object.keys(e).length) continue
    const out: EventMotion = {}
    if (STYLES.includes(e.style as MotionStyle)) out.style = e.style as MotionStyle
    if (e.speed !== undefined) out.speed = num(e.speed, 0.5, 2, 1)
    if (e.bounce !== undefined) out.bounce = num(e.bounce, 0, 1, d.motion.bounce)
    if (Object.keys(out).length) events[k] = out
  }
  const os = obj(r.openSize)
  const c = obj(r.clock)
  const s = obj(r.sound)
  const vol = obj(s.volume)
  const volume = {} as Record<SoundKind, number>
  for (const k of SOUND_KINDS) volume[k] = num(vol[k], 0, 1, d.sound.volume[k])
  return {
    size: pick(r.size, ['small', 'medium', 'large'] as const, d.size),
    radius: r.radius == null ? null : num(r.radius, 0, 40, 18),
    position: r.position == null ? null : pick(r.position, ['top-center', 'top-left', 'top-right'] as const, 'top-center'),
    openSize: { width: os.width == null ? null : num(os.width, 360, 900, 600), height: os.height == null ? null : num(os.height, 240, 900, 560) },
    motion: { style: pick(m.style, ['auto', ...STYLES] as const, d.motion.style), speed: num(m.speed, 0.5, 2, d.motion.speed), bounce: num(m.bounce, 0, 1, d.motion.bounce), events },
    accent: cleanColor(r.accent),
    glow: pick(r.glow, ['off', 'soft', 'strong', 'music'] as const, d.glow),
    blur: num(r.blur, 0, 40, d.blur),
    font: pick(r.font, ['system', 'rounded', 'mono', 'serif'] as const, d.font),
    numbers: pick(r.numbers, ['normal', 'tabular', 'rounded'] as const, d.numbers),
    clock: { style: pick(c.style, ['digital', 'analog'] as const, d.clock.style), hour12: bool(c.hour12, d.clock.hour12), seconds: bool(c.seconds, d.clock.seconds), date: bool(c.date, d.clock.date), zone: cleanZone(c.zone) },
    celebration: pick(r.celebration, ['confetti', 'glow', 'ripple', 'none'] as const, d.celebration),
    sound: { pack: pick(s.pack, ['default', 'soft', 'none'] as const, d.sound.pack), volume }
  }
}

export function cleanWidgets(raw: unknown): IslandWidgets {
  const r = obj(raw)
  const d = DEFAULT_WIDGETS
  const lv = obj(r.live)
  const live = {} as Record<LiveKind, boolean>
  for (const k of LIVE_KINDS) live[k] = bool(lv[k], d.live[k])
  const instant = Array.isArray(r.instant) ? [...new Set(r.instant.filter((x): x is InstantId => INSTANT_IDS.includes(x as InstantId)))].slice(0, 6) : d.instant
  return { split: bool(r.split, d.split), live, instant, scrub: bool(r.scrub, d.scrub), drop: bool(r.drop, d.drop), gestures: bool(r.gestures, d.gestures) }
}

/** How loud one kind of island sound plays (0 … 1): the pack's level times the kind's volume. */
export function soundGain(l: Pick<IslandLooks, 'sound'>, kind: SoundKind): number {
  if (l.sound.pack === 'none') return 0
  return Math.round(l.sound.volume[kind] * (l.sound.pack === 'soft' ? 0.6 : 1) * 1000) / 1000
}

/** The pill's scale for a size. */
export const LOOK_SCALE: Record<IslandLooks['size'], number> = { small: 0.9, medium: 1, large: 1.12 }

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
/** Moments that can play your own uploaded sound instead of the built-in one (Custom Center → Looks → Sounds). */
export type SoundFileKind = 'open' | 'notify' | 'done' | 'timer' | 'reminder' | 'celebrate'
export const SOUND_FILE_KINDS: SoundFileKind[] = ['open', 'notify', 'done', 'timer', 'reminder', 'celebrate']
export type SoundPackId = 'default' | 'soft' | 'arcade' | 'glass' | 'none'
export type Celebration = 'confetti' | 'burst' | 'glow' | 'ripple' | 'none'

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
  numbers: 'normal' | 'tabular' | 'rounded' | 'segment'
  clock: {
    style: 'digital' | 'analog'
    hour12: boolean
    seconds: boolean
    date: boolean
    /** A second time zone (IANA name) shown next to yours; null = none. */
    zone: string | null
  }
  celebration: Celebration
  /**
   * The pack (arcade = square waves, glass = an octave up and longer), the
   * volume per kind, and your own sounds ("local:<id>", kept on this device).
   */
  sound: { pack: SoundPackId; volume: Record<SoundKind, number>; files: Partial<Record<SoundFileKind, string>> }
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
  sound: { pack: 'default', volume: { tap: 0.7, done: 0.8, notify: 0.8, reminder: 0.8, error: 0.6 }, files: {} }
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
  const fl = obj(s.files)
  const files: Partial<Record<SoundFileKind, string>> = {}
  for (const k of SOUND_FILE_KINDS) if (typeof fl[k] === 'string' && /^local:[a-z0-9]{1,40}$/i.test(fl[k] as string)) files[k] = fl[k] as string
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
    numbers: pick(r.numbers, ['normal', 'tabular', 'rounded', 'segment'] as const, d.numbers),
    clock: { style: pick(c.style, ['digital', 'analog'] as const, d.clock.style), hour12: bool(c.hour12, d.clock.hour12), seconds: bool(c.seconds, d.clock.seconds), date: bool(c.date, d.clock.date), zone: cleanZone(c.zone) },
    celebration: pick(r.celebration, ['confetti', 'burst', 'glow', 'ripple', 'none'] as const, d.celebration),
    sound: { pack: pick(s.pack, ['default', 'soft', 'arcade', 'glass', 'none'] as const, d.sound.pack), volume, files }
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
export const LOOK_SCALE: Record<IslandLooks['size'], number> = { small: 0.86, medium: 1, large: 1.16 }

// ---------------------------------------------------------------- applying the looks (pure parts)

/** The island's spot for a look's position (null: leave it where you put it). Same names as the desktop's placements. */
export function placementOf(p: IslandLooks['position']): 'top' | 'top-left' | 'top-right' | null {
  return p === 'top-center' ? 'top' : p ?? null
}

/** The resting pill's corner radius: the look's own (never more than half the height), else the shape's. */
export function restRadius(l: Pick<IslandLooks, 'radius'>, shapeRadius: number, height: number): number {
  if (l.radius == null) return shapeRadius
  return Math.max(0, Math.min(Math.round(l.radius), Math.round(height / 2)))
}

/** The pill's height for a size (px), from your Settings height. */
export const pillHeight = (l: Pick<IslandLooks, 'size'>, base: number) => Math.round(base * LOOK_SCALE[l.size])

/**
 * The open island's size: the look's (when set) inside what the screen gives
 * (`fit`); null parts keep the screen's.
 */
export function openSizeOf(l: Pick<IslandLooks, 'openSize'>, fit: { w: number; h: number }): { w: number; h: number } {
  return { w: l.openSize.width ? Math.min(fit.w, l.openSize.width) : fit.w, h: l.openSize.height ? Math.min(fit.h, l.openSize.height) : fit.h }
}

/** What a celebration does: a particle burst (how many, how hard, how wide) and/or a class for a short glow or ripple. */
export interface CelebrationPlan {
  particles: { n: number; power: number; spread: number } | null
  cls: 'v2-cel-glow' | 'v2-cel-ripple' | null
  ms: number
}
export function celebrationPlan(c: Celebration): CelebrationPlan {
  switch (c) {
    case 'confetti':
      return { particles: { n: 60, power: 1, spread: 1 }, cls: null, ms: 0 }
    case 'burst':
      // Fewer, faster pieces in a tight cone, with a short glow.
      return { particles: { n: 26, power: 1.45, spread: 0.45 }, cls: 'v2-cel-glow', ms: 700 }
    case 'glow':
      return { particles: null, cls: 'v2-cel-glow', ms: 1200 }
    case 'ripple':
      return { particles: null, cls: 'v2-cel-ripple', ms: 900 }
    default:
      return { particles: null, cls: null, ms: 0 }
  }
}

/** A built-in sound's notes in a pack's voice. Kept-as-is notes (noise, thuds) never change. */
export function packVoices<V extends { f: number; f2?: number; len: number; gain: number; wave?: OscillatorType; noise?: boolean; fixed?: boolean }>(voices: V[], pack: SoundPackId): V[] {
  if (pack === 'arcade') return voices.map((v) => (v.noise || v.fixed ? v : { ...v, wave: 'square' as OscillatorType, gain: v.gain * 0.45, len: Math.max(0.04, v.len * 0.7) }))
  if (pack === 'glass') return voices.map((v) => (v.noise || v.fixed ? v : { ...v, wave: 'sine' as OscillatorType, f: v.f * 2, ...(v.f2 ? { f2: v.f2 * 2 } : {}), len: v.len * 1.4 }))
  return voices
}

/**
 * How much louder or softer an island sound plays with this look, next to
 * today's island (1 with the defaults; 0 with the "none" pack).
 */
export function lookGain(l: Pick<IslandLooks, 'sound'>, name: string): number {
  if (l.sound.pack === 'none') return 0
  const k = soundKindOf(name)
  const base = DEFAULT_LOOKS.sound.volume[k] || 1
  return Math.round((l.sound.volume[k] / base) * (l.sound.pack === 'soft' ? 0.6 : 1) * 1000) / 1000
}

/** Which of your own sounds (if any) replaces an island sound. */
export function fileFor(l: Pick<IslandLooks, 'sound'>, name: string): string | null {
  const k: SoundFileKind | null = name === 'open' ? 'open' : name === 'notify' ? 'notify' : name === 'done' ? 'done' : name === 'levelup' ? 'celebrate' : name === 'reminder' ? 'reminder' : name === 'timer' ? 'timer' : null
  return (k && l.sound.files[k]) || null
}

/** The volume kind of an island sound (open, close, page and hover are taps; level up is a done). */
export function soundKindOf(name: string): SoundKind {
  return name === 'done' || name === 'levelup' ? 'done' : name === 'notify' ? 'notify' : name === 'error' ? 'error' : name === 'reminder' || name === 'timer' ? 'reminder' : 'tap'
}

/** The clock as text, in your time and the second zone. Pure (tested with a pinned clock). */
export function clockText(now: Date, c: IslandLooks['clock']): { time: string; ampm: string; date: string; zone: { label: string; time: string } | null } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = now.getHours()
  const hh = c.hour12 ? String(h % 12 || 12) : pad(h)
  const time = `${hh}:${pad(now.getMinutes())}`
  const date = c.date ? now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
  let zone: { label: string; time: string } | null = null
  if (c.zone) {
    try {
      const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: c.hour12, timeZone: c.zone }).format(now)
      zone = { label: c.zone.split('/').pop()!.replace(/_/g, ' '), time: t.replace(/\s?([ap])\.?m\.?/i, (_m, x: string) => ` ${x.toLowerCase()}m`) }
    } catch {
      zone = null
    }
  }
  return { time, ampm: c.hour12 ? (h < 12 ? 'am' : 'pm') : '', date, zone }
}

/** Hand angles (degrees) for the analog clock. */
export function clockAngles(now: Date): { h: number; m: number; s: number } {
  const s = now.getSeconds()
  const m = now.getMinutes() + s / 60
  return { h: ((now.getHours() % 12) + m / 60) * 30, m: m * 6, s: s * 6 }
}

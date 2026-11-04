// The desktop island: a small always-on-top pill at the top of the screen
// (Windows), separate from the app window. The app window (running hidden in
// the tray) sends it a snapshot of your moment; the island sends back taps.
// This file is the pure part: what it shows, and when it drops down.

export interface IslandBlock { title: string; start: number; end: number }

/** Every tap gets an answer from the app window: done, or why not. */
export interface IslandAck { id: string; ok: boolean; error?: string }

export type IslandAction = { id?: string } & (
  | { kind: 'water'; ml: number }
  | { kind: 'reps'; id: string; name: string; n: number }
  | { kind: 'mustdo'; i: number }
  | { kind: 'chat'; text: string }
  | { kind: 'start'; subject: string; minutes: number }
  | { kind: 'stop' }
  | { kind: 'extend'; minutes: number }
  | { kind: 'dismiss'; id: string; snoozeMin?: number }
  | { kind: 'open'; page?: string }
  | { kind: 'bed'; time?: string }
  | { kind: 'wake' }
)

export interface IslandAlert {
  id: string
  kind: 'ben' | 'block' | 'over' | 'sleep'
  title: string
  text: string
  face?: string
  actions: { label: string; action: IslandAction; primary?: boolean }[]
}

export interface IslandSnapshot {
  at: number
  /** The app is locked (PIN) or still loading. */
  locked?: boolean
  ben: { face: string; mood: string; why: string; move: { title: string; sub: string } | null; last: { text: string; at: string; face: string } | null; unread: number; busy: boolean; steps: string[] }
  running: { subject: string; startedAt: number; endsAt: number } | null
  now: IslandBlock | null
  next: IslandBlock | null
  mustdos: { i: number; text: string; done: boolean }[]
  water: { ml: number; target: number }
  reps: { id: string; name: string; done: number; target: number }[]
  alert: IslandAlert | null
  /** The bedtime buttons: Going to bed (evening/night), I'm up (morning). */
  sleep?: { bed: boolean; wake: boolean; target: string | null }
  /** Your points and the reward you're working toward. */
  points?: { balance: number; goal: { title: string; price: number } | null }
}

export const EMPTY_ISLAND: IslandSnapshot = {
  at: 0,
  locked: true,
  ben: { face: '✦', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
  running: null,
  now: null,
  next: null,
  mustdos: [],
  water: { ml: 0, target: 0 },
  reps: [],
  alert: null
}

/** "09:30" + minutes on a given day → a block in epoch ms (local time). */
export function blocksFromPlan(plan: { title: string; start: string; minutes: number }[], day: Date): IslandBlock[] {
  return plan
    .map((b) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(b.start)
      if (!m) return null
      const d = new Date(day)
      d.setHours(Number(m[1]), Number(m[2]), 0, 0)
      return { title: b.title, start: d.getTime(), end: d.getTime() + Math.max(5, b.minutes) * 60000 }
    })
    .filter((b): b is IslandBlock => !!b)
    .sort((a, b) => a.start - b.start)
}

/** The block happening now and the next one. */
export function nowNext(blocks: IslandBlock[], now: number): { now: IslandBlock | null; next: IslandBlock | null } {
  const sorted = [...blocks].sort((a, b) => a.start - b.start)
  return { now: sorted.find((b) => b.start <= now && now < b.end) ?? null, next: sorted.find((b) => b.start > now) ?? null }
}

export interface AlertInput {
  now: number
  running: IslandSnapshot['running']
  blocks: IslandBlock[]
  /** Ben's log (oldest first). */
  log: { role: 'me' | 'coach'; via?: string; text: string; at: string; face?: string }[]
  /** Ben's messages up to this time were seen. */
  seenBen: number
  /** id → hidden until (ms). */
  dismissed: Record<string, number>
}

const short = (t: string, n = 160) => {
  const s = t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** What should drop the island down now (most urgent first), or null. */
export function pickAlert(a: AlertInput): IslandAlert | null {
  const hidden = (id: string) => (a.dismissed[id] ?? 0) > a.now
  if (a.running && a.now >= a.running.endsAt) {
    const id = `over:${a.running.startedAt}`
    if (!hidden(id))
      return {
        id,
        kind: 'over',
        title: 'Time is up',
        text: `${a.running.subject}: stop and log it, or add a few minutes.`,
        actions: [
          { label: 'Stop & log', action: { kind: 'stop' }, primary: true },
          { label: '+5 min', action: { kind: 'extend', minutes: 5 } },
          { label: '+15', action: { kind: 'extend', minutes: 15 } }
        ]
      }
  }
  if (!a.running) {
    const starting = a.blocks.find((b) => b.start - 60_000 <= a.now && a.now <= b.start + 3 * 60_000 && a.now < b.end)
    if (starting) {
      const id = `blk:${starting.start}:${starting.title}`
      const minutes = Math.max(5, Math.min(90, Math.round((starting.end - Math.max(a.now, starting.start)) / 60000)))
      if (!hidden(id))
        return {
          id,
          kind: 'block',
          title: 'Starting now',
          text: starting.title,
          actions: [
            { label: `Start ${minutes} min`, action: { kind: 'start', subject: starting.title, minutes }, primary: true },
            { label: 'In 10 min', action: { kind: 'dismiss', id, snoozeMin: 10 } },
            { label: 'Skip', action: { kind: 'dismiss', id } }
          ]
        }
    }
  }
  const fresh = a.log.filter((e) => e.role === 'coach' && e.via !== 'app' && Date.parse(e.at) > a.seenBen)
  const last = fresh[fresh.length - 1]
  if (last) {
    const id = `ben:${last.at}`
    if (!hidden(id))
      return {
        id,
        kind: 'ben',
        title: 'Ben',
        face: last.face,
        text: short(last.text),
        actions: [
          { label: 'Reply', action: { kind: 'dismiss', id }, primary: true },
          { label: 'Open chat', action: { kind: 'open', page: 'coach' } },
          { label: 'Got it', action: { kind: 'dismiss', id } }
        ]
      }
  }
  return null
}

const two = (n: number) => String(n).padStart(2, '0')
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(Math.abs(sec)))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}
const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${two(m % 60)}m` : `${m}m`
}

export interface Pill {
  kind: 'timer' | 'now' | 'next' | 'idle'
  text: string
  sub: string
  /** 0..1 progress for the ring. */
  pct: number
  over: boolean
  /** Something new (Ben's message, an alert). */
  dot: boolean
}

/** The collapsed pill, "smart": the timer while focusing, else the block now, else the next one within an hour, else just a glow. */
export function pill(s: IslandSnapshot, now: number): Pill {
  const dot = s.ben.unread > 0 || !!s.alert
  if (s.running) {
    const left = (s.running.endsAt - now) / 1000
    const over = left < 0
    return { kind: 'timer', text: `${over ? '+' : ''}${clock(left)}`, sub: s.running.subject, pct: Math.min(1, (now - s.running.startedAt) / Math.max(1, s.running.endsAt - s.running.startedAt)), over, dot }
  }
  if (s.now) return { kind: 'now', text: s.now.title, sub: `${mins(s.now.end - now)} left`, pct: (now - s.now.start) / Math.max(1, s.now.end - s.now.start), over: false, dot }
  if (s.next && s.next.start - now <= 60 * 60_000) return { kind: 'next', text: s.next.title, sub: `in ${mins(s.next.start - now)}`, pct: 0, over: false, dot }
  return { kind: 'idle', text: '', sub: '', pct: 0, over: false, dot }
}

// ---- Your island: how it looks and behaves (Settings → Desktop island) ----

export type IslandSection = 'timer' | 'sleep' | 'plan' | 'mustdos' | 'logs' | 'points' | 'ben'
export interface IslandPrefs {
  size: 'compact' | 'normal' | 'large'
  /** Background opacity, 0.55 (see-through) … 1 (solid). */
  opacity: number
  look: 'black' | 'glass' | 'mood'
  /** The open card's sections, in your order. */
  sections: { id: IslandSection; on: boolean }[]
  /** A soft chime when it drops down by itself. */
  sound: boolean
  /** How long it waits before tucking away after the mouse leaves. */
  hide: 'fast' | 'normal' | 'slow'
  /** Electron accelerator, or '' for none. */
  shortcut: string
}

export const SECTION_LABEL: Record<IslandSection, string> = { timer: 'Timer', sleep: 'Bedtime', plan: 'Now & next', mustdos: 'Must-dos', logs: 'Water & reps', points: 'Points & reward', ben: 'Ben' }
export const SHORTCUTS = ['Control+Alt+Space', 'Control+Shift+Space', 'Alt+Q', 'Control+Alt+L', ''] as const
export const DEFAULT_ISLAND_PREFS: IslandPrefs = {
  size: 'normal',
  opacity: 1,
  look: 'black',
  sections: (['timer', 'sleep', 'plan', 'mustdos', 'logs', 'points', 'ben'] as IslandSection[]).map((id) => ({ id, on: true })),
  sound: true,
  hide: 'normal',
  shortcut: 'Control+Alt+Space'
}
export const ISLAND_ZOOM: Record<IslandPrefs['size'], number> = { compact: 0.88, normal: 1, large: 1.15 }
export const HIDE_MS: Record<IslandPrefs['hide'], number> = { fast: 250, normal: 450, slow: 1200 }

/** Any saved value → valid prefs (unknown sections dropped, missing ones added at the end). */
export function cleanIslandPrefs(p: any): IslandPrefs {
  const d = DEFAULT_ISLAND_PREFS
  const ids = d.sections.map((s) => s.id)
  const saved = Array.isArray(p?.sections) ? p.sections.filter((s: any) => ids.includes(s?.id)).map((s: any) => ({ id: s.id as IslandSection, on: s.on !== false })) : []
  const sections: { id: IslandSection; on: boolean }[] = [...saved.filter((s: any, i: number) => saved.findIndex((x: any) => x.id === s.id) === i), ...d.sections.filter((s) => !saved.some((x: any) => x.id === s.id))]
  // Bedtime belongs right under the timer (also when it's new since you last saved).
  const bed = sections.findIndex((x) => x.id === 'sleep')
  const timer = sections.findIndex((x) => x.id === 'timer')
  if (!saved.some((x: any) => x.id === 'sleep') && bed > timer + 1) sections.splice(timer + 1, 0, ...sections.splice(bed, 1))
  return {
    size: ['compact', 'normal', 'large'].includes(p?.size) ? p.size : d.size,
    opacity: Number.isFinite(p?.opacity) ? Math.min(1, Math.max(0.55, Number(p.opacity))) : d.opacity,
    look: ['black', 'glass', 'mood'].includes(p?.look) ? p.look : d.look,
    sections,
    sound: p?.sound !== false,
    hide: ['fast', 'normal', 'slow'].includes(p?.hide) ? p.hide : d.hide,
    shortcut: typeof p?.shortcut === 'string' && (SHORTCUTS as readonly string[]).includes(p.shortcut) ? p.shortcut : d.shortcut
  }
}

// ---- Live activities: everything worth showing in the pill right now ----

export interface Activity extends Omit<Pill, 'kind'> {
  kind: 'timer' | 'now' | 'next' | 'idle' | 'ben' | 'water' | 'bed'
  /** Stable id, so a chosen activity stays chosen as numbers tick. */
  key: string
}

/**
 * The pill's activities, most important first: the running timer, the block
 * now, the next block (within 3 h), Ben's unread message, water left today.
 * The pill shows the first (or the one you scrolled to) with the second as a
 * small bubble beside it.
 */
export function activities(s: IslandSnapshot, now: number): Activity[] {
  const out: Activity[] = []
  const dot = s.ben.unread > 0 || !!s.alert
  if (s.running) {
    const left = (s.running.endsAt - now) / 1000
    out.push({ key: 'timer', kind: 'timer', text: `${left < 0 ? '+' : ''}${clock(left)}`, sub: s.running.subject, pct: Math.min(1, (now - s.running.startedAt) / Math.max(1, s.running.endsAt - s.running.startedAt)), over: left < 0, dot })
  }
  if (s.now) out.push({ key: `now:${s.now.start}`, kind: 'now', text: s.now.title, sub: `${mins(s.now.end - now)} left`, pct: (now - s.now.start) / Math.max(1, s.now.end - s.now.start), over: false, dot })
  if (s.next && s.next.start - now <= 3 * 3600_000) out.push({ key: `next:${s.next.start}`, kind: 'next', text: s.next.title, sub: `in ${mins(s.next.start - now)}`, pct: 0, over: false, dot })
  if (s.ben.unread > 0 && s.ben.last) out.push({ key: `ben:${s.ben.last.at}`, kind: 'ben', text: s.ben.last.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 60), sub: 'Ben', pct: 0, over: false, dot })
  if (s.sleep?.bed && !s.running) out.push({ key: 'bed', kind: 'bed', text: 'Going to bed?', sub: 'Tap to log it in Waky', pct: 0, over: false, dot })
  if (s.water.target > 0 && s.water.ml < s.water.target && out.length) out.push({ key: 'water', kind: 'water', text: `${(s.water.ml / 1000).toFixed(1)} / ${(s.water.target / 1000).toFixed(1)} L`, sub: 'Water', pct: s.water.ml / s.water.target, over: false, dot })
  return out
}

// The desktop island: a small always-on-top pill at the top of the screen
// (Windows), separate from the app window. The app window (running hidden in
// the tray) sends it a snapshot of your moment; the island sends back taps.
// This file is the pure part: what it shows, and when it drops down.

export interface IslandBlock {
  title: string
  start: number
  end: number
  id?: string
  calendarId?: string
  /** A meeting by its data (a call link or other people, and you said yes), whatever its name (Q4, IS11). */
  call?: boolean
  /** The meeting's video link (Join opens it). */
  meet?: string | null
  /** IS6: you said "maybe", or haven't answered the invite yet: shown greyed, never "Now". */
  maybe?: 'tentative' | 'invite'
}

/** Every tap gets an answer from the app window: done, or why not. */
export interface IslandAck { id: string; ok: boolean; error?: string; /** What happened, in words (the command bar's answer). */ text?: string }

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
  | { kind: 'wake'; time?: string }
  | { kind: 'moveBreak'; name: string; n: number; alertId: string }
  | { kind: 'eyeBreaks'; on: boolean }
  | { kind: 'closeDay' }
  | { kind: 'todoDone'; id: string; content: string }
  | { kind: 'clipSave'; to: 'task' | 'note'; text: string; alertId: string }
  | { kind: 'book'; text: string }
  | { kind: 'voice'; mime: string; data: string }
  | { kind: 'push'; block: IslandBlock; minutes: number }
  | { kind: 'blockResult'; block: IslandBlock; result: 'done' | 'half' | 'no'; alertId: string }
  | { kind: 'autoFocus'; on: boolean }
  /** P3: "It's for this": this app counts as work from now on. */
  | { kind: 'pcWork'; app: string; alertId: string }
  /** P14: lock the PC for a real break. */
  | { kind: 'lockPc'; alertId: string }
  /** IS11: join the meeting on now (opens its video link). */
  | { kind: 'join'; url: string }
)

export interface IslandAlert {
  id: string
  kind: 'ben' | 'block' | 'over' | 'sleep' | 'drift' | 'end' | 'quality' | 'water' | 'move' | 'eyes' | 'winddown' | 'morning' | 'clip' | 'highlight' | 'reward' | 'distract' | 'late' | 'back'
  title: string
  text: string
  face?: string
  actions: { label: string; action: IslandAction; primary?: boolean }[]
}

export interface IslandSnapshot {
  at: number
  /** The app is locked (PIN) or still loading. */
  locked?: boolean
  /** IS4: the last update failed (a hiccup): this is the last good picture. */
  stale?: boolean
  ben: { face: string; mood: string; why: string; move: { title: string; sub: string } | null; last: { text: string; at: string; face: string } | null; unread: number; busy: boolean; steps: string[] }
  running: { subject: string; startedAt: number; endsAt: number } | null
  now: IslandBlock | null
  next: IslandBlock | null
  /** IS6: later today, a "maybe" or an invite you haven't answered (greyed in the Next list). */
  maybe?: IslandBlock[]
  mustdos: { i: number; text: string; done: boolean }[]
  water: { ml: number; target: number }
  reps: { id: string; name: string; done: number; target: number }[]
  alert: IslandAlert | null
  /** The bedtime buttons: Going to bed (evening/night), I'm up (morning). */
  sleep?: { bed: boolean; wake: boolean; target: string | null }
  /** In a call/meeting from your calendar: the island stays quiet. */
  call?: { title: string; end: number } | null
  /** A meeting from your calendar is on right now (even with a timer running): the desktop is told (IS12). */
  inMeeting?: boolean
  /** Wind-down: the hour before your bedtime target. */
  windDown?: { bedAt: string; minutesLeft: number } | null
  /** Your best streak right now (sport / focus / water), and whether it's at risk today. */
  streak?: { days: number; kind: 'sport' | 'focus' | 'water'; atRisk: boolean } | null
  /** How much of today is done, 0–100 (the day ring around the pill). */
  dayPct?: number
  /** Todoist: your next tasks for today (tick them on the island). */
  tasks?: { id: string; content: string; time: string | null }[]
  /** IS19: when the Todoist list was last fetched fine (ms), and whether the last try failed. */
  tasksAt?: number
  tasksStale?: boolean
  /** 20-20-20 eye breaks on? */
  eyeBreaks?: boolean
  /** Start focus by itself when a calendar block begins. */
  autoFocus?: boolean
  /** The running focus so far: how much of it you were actually at the PC. */
  focusGuard?: { pct: number; idleMin: number } | null
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

/**
 * The block happening now and the next one (IS10). When several are on at
 * once, a meeting beats a plain block (a 15:00 call inside a 9–17 "Work"
 * block is what's on), then the one that started last, then the shortest.
 * A "maybe" or an unanswered invite is never "now" (IS6); the next one is
 * the next thing you said yes to.
 */
export function nowNext(blocks: IslandBlock[], now: number): { now: IslandBlock | null; next: IslandBlock | null } {
  const firm = blocks.filter((b) => !b.maybe)
  const on = firm
    .filter((b) => b.start <= now && now < b.end)
    .sort((a, b) => Number(!!b.call) - Number(!!a.call) || b.start - a.start || a.end - a.start - (b.end - b.start))
  const next = firm.filter((b) => b.start > now).sort((a, b) => a.start - b.start)[0] ?? null
  return { now: on[0] ?? null, next }
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

export type IslandSection = 'timer' | 'sleep' | 'plan' | 'tasks' | 'mustdos' | 'logs' | 'points' | 'ben'
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
  /** In a call or meeting: hide the island, shrink it to a dot, or leave it (Q5). */
  callMode: 'hide' | 'dot' | 'normal'
  /** The shortcut that turns quiet mode on and off (Q6), or ''. */
  quietShortcut: string
  /** Each kind of reminder: shown or not, with or without its sound (P4). */
  kinds: Record<AlertKindPref, { on: boolean; sound: boolean }>
  /** Sound volume, 0 … 1 (A8). */
  volume: number
}

/** The reminder kinds you can turn on/off (P4). */
export type AlertKindPref = 'water' | 'move' | 'eyes' | 'ben' | 'block' | 'bed' | 'morning' | 'highlight' | 'reward' | 'over'
export const KIND_LABEL: Record<AlertKindPref, string> = { water: 'Water', move: 'Stretch breaks', eyes: 'Eye breaks (20-20-20)', ben: "Ben's messages", block: 'Blocks starting / ending', bed: 'Bedtime & wind-down', morning: 'Morning', highlight: 'Highlights', reward: 'Rewards', over: 'Focus time is up' }
// Not Ctrl+Alt+<key> by default: that's AltGr on many keyboards (@, ł…) (IS15).
export const QUIET_SHORTCUTS = ['Alt+Shift+Q', 'Control+Shift+Q', 'Control+Alt+Q', ''] as const

/** Which preference an alert kind falls under. */
export function alertPref(kind: string): AlertKindPref | null {
  if (kind === 'water') return 'water'
  if (kind === 'move') return 'move'
  if (kind === 'eyes') return 'eyes'
  if (kind === 'ben') return 'ben'
  if (kind === 'block' || kind === 'drift' || kind === 'end' || kind === 'quality') return 'block'
  if (kind === 'bed' || kind === 'winddown' || kind === 'sleep') return 'bed'
  if (kind === 'morning') return 'morning'
  if (kind === 'highlight') return 'highlight'
  if (kind === 'reward') return 'reward'
  if (kind === 'over') return 'over'
  return null
}

/** "Quiet for…" (Q1): when it ends. `choice`: minutes, or 'tomorrow' (06:00 next morning). */
export function quietUntil(choice: number | 'tomorrow', now: number): number {
  if (choice === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + (d.getHours() < 4 ? 0 : 1))
    d.setHours(6, 0, 0, 0)
    return d.getTime()
  }
  return now + Math.max(1, Math.round(choice)) * 60_000
}

export const SECTION_LABEL: Record<IslandSection, string> = { timer: 'Timer', sleep: 'Bedtime', plan: 'Now & next', tasks: 'Todoist', mustdos: 'Must-dos', logs: 'Water & reps', points: 'Points & reward', ben: 'Ben' }
export const SHORTCUTS = ['Control+Shift+Space', 'Alt+Shift+Space', 'Control+Alt+Space', 'Alt+Q', ''] as const
export const DEFAULT_ISLAND_PREFS: IslandPrefs = {
  size: 'normal',
  opacity: 1,
  look: 'black',
  sections: (['timer', 'sleep', 'plan', 'tasks', 'mustdos', 'logs', 'points', 'ben'] as IslandSection[]).map((id) => ({ id, on: true })),
  sound: true,
  hide: 'normal',
  shortcut: 'Control+Shift+Space',
  callMode: 'hide',
  quietShortcut: 'Alt+Shift+Q',
  kinds: { water: { on: true, sound: true }, move: { on: true, sound: true }, eyes: { on: true, sound: true }, ben: { on: true, sound: true }, block: { on: true, sound: true }, bed: { on: true, sound: true }, morning: { on: true, sound: true }, highlight: { on: true, sound: false }, reward: { on: true, sound: true }, over: { on: true, sound: true } },
  volume: 0.7
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
    shortcut: typeof p?.shortcut === 'string' && (SHORTCUTS as readonly string[]).includes(p.shortcut) ? p.shortcut : d.shortcut,
    callMode: ['hide', 'dot', 'normal'].includes(p?.callMode) ? p.callMode : d.callMode,
    quietShortcut: typeof p?.quietShortcut === 'string' && (QUIET_SHORTCUTS as readonly string[]).includes(p.quietShortcut) ? p.quietShortcut : d.quietShortcut,
    kinds: Object.fromEntries((Object.keys(KIND_LABEL) as AlertKindPref[]).map((k) => [k, { on: typeof p?.kinds?.[k]?.on === 'boolean' ? p.kinds[k].on : d.kinds[k].on, sound: typeof p?.kinds?.[k]?.sound === 'boolean' ? p.kinds[k].sound : d.kinds[k].sound }])) as IslandPrefs['kinds'],
    volume: Number.isFinite(p?.volume) ? Math.min(1, Math.max(0, Number(p.volume))) : d.volume
  }
}

// ---- Live activities: everything worth showing in the pill right now ----

export interface Activity extends Omit<Pill, 'kind'> {
  kind: 'timer' | 'now' | 'next' | 'idle' | 'ben' | 'water' | 'bed'
  /** Stable id, so a chosen activity stays chosen as numbers tick. */
  key: string
  /** When it starts (ms): a live countdown in the last 10 minutes (P7). */
  at?: number
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
  if (s.now) out.push({ key: `now:${s.now.start}`, kind: 'now', text: `${s.now.call ? '📞 ' : ''}${s.now.title}`, sub: `${mins(s.now.end - now)} left`, pct: (now - s.now.start) / Math.max(1, s.now.end - s.now.start), over: false, dot })
  if (s.next && s.next.start - now <= 3 * 3600_000) {
    const next: Activity = { key: `next:${s.next.start}`, kind: 'next', text: s.next.title, sub: `in ${mins(s.next.start - now)}`, pct: 0, over: false, dot, at: s.next.start }
    // Starting within 10 minutes: it goes first (after a running timer), with a live countdown (P7).
    if (s.next.start - now <= 10 * 60_000) out.splice(s.running ? 1 : 0, 0, next)
    else out.push(next)
  }
  if (s.ben.unread > 0 && s.ben.last) out.push({ key: `ben:${s.ben.last.at}`, kind: 'ben', text: s.ben.last.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 60), sub: 'Ben', pct: 0, over: false, dot })
  if (s.sleep?.bed && !s.running) out.push({ key: 'bed', kind: 'bed', text: 'Going to bed?', sub: 'Tap to log it in Waky', pct: 0, over: false, dot })
  // Water shows even when nothing else is on (P5).
  if (s.water.target > 0 && s.water.ml < s.water.target) out.push({ key: 'water', kind: 'water', text: `${(s.water.ml / 1000).toFixed(1)} / ${(s.water.target / 1000).toFixed(1)} L`, sub: 'Water', pct: s.water.ml / s.water.target, over: false, dot })
  return out
}

// ---- The island's states (desktop command center) --------------------------
// compact: the pill, always there. peek: a bigger pill (hover held, or
// something new) with one action. expanded: the command center (click, the
// shortcut, Reply). One timer at a time, owned here: every event says what
// the next timer is (or cancels it), so nothing closes behind your back.

export type IslandView = 'compact' | 'peek' | 'expanded'
export interface IslandUi {
  view: IslandView
  pinned: boolean
  /** The pointer is over the shape. */
  over: boolean
  /** You are typing (the box has focus or text): never closes by itself. */
  typing: boolean
  /** Opened by something new (an alert), not by you. */
  byAlert: boolean
}
export type IslandUiEvent =
  | { type: 'hover'; on: boolean }
  | { type: 'hoverHeld' }
  | { type: 'leave' }
  | { type: 'click' }
  | { type: 'toggle' }
  | { type: 'alert' }
  | { type: 'alertEnd' }
  | { type: 'close' }
  | { type: 'blur' }
  | { type: 'pin' }
  | { type: 'typing'; on: boolean }
/** undefined: keep the current timer; null: cancel it; else replace it. */
export interface IslandUiStep { ui: IslandUi; timer?: { ms: number; event: IslandUiEvent } | null; focusInput?: boolean }

export const ISLAND_UI: IslandUi = { view: 'compact', pinned: false, over: false, typing: false, byAlert: false }
/** How long the pointer must stay to peek, and how long it may be away before it shrinks. */
export const ISLAND_TIMING = { hoverToPeek: 350, peekLeave: 700, alertPeek: 5000, expandedLeave: { fast: 1000, normal: 2000, slow: 4000 } as Record<IslandPrefs['hide'], number> }

export function islandStep(ui: IslandUi, e: IslandUiEvent, hide: IslandPrefs['hide'] = 'normal'): IslandUiStep {
  const to = (view: IslandView, extra: Partial<IslandUi> = {}): IslandUi => ({ ...ui, view, ...extra })
  const stays = ui.pinned || ui.typing
  switch (e.type) {
    case 'hover':
      if (e.on) return { ui: { ...ui, over: true }, timer: ui.view === 'compact' ? { ms: ISLAND_TIMING.hoverToPeek, event: { type: 'hoverHeld' } } : null }
      if (ui.view === 'peek') return { ui: { ...ui, over: false }, timer: { ms: ISLAND_TIMING.peekLeave, event: { type: 'leave' } } }
      if (ui.view === 'expanded' && !stays) return { ui: { ...ui, over: false }, timer: { ms: ISLAND_TIMING.expandedLeave[hide], event: { type: 'leave' } } }
      return { ui: { ...ui, over: false }, timer: null }
    case 'hoverHeld':
      return ui.over && ui.view === 'compact' ? { ui: to('peek', { byAlert: false }), timer: null } : { ui }
    case 'leave':
      if (ui.over) return { ui }
      if (ui.view === 'peek') return { ui: to('compact', { byAlert: false }), timer: null }
      if (ui.view === 'expanded' && !stays) return { ui: to('compact', { byAlert: false }), timer: null }
      return { ui }
    case 'click':
      return ui.view === 'expanded' ? { ui } : { ui: to('expanded', { byAlert: false }), timer: null }
    case 'toggle':
      return ui.view === 'expanded' ? { ui: to('compact', { pinned: false, typing: false, byAlert: false }), timer: null } : { ui: to('expanded', { byAlert: false }), timer: null, focusInput: true }
    case 'alert':
      // Something new peeks (never opens the whole panel by itself).
      if (ui.view === 'expanded') return { ui }
      return { ui: to('peek', { byAlert: true }), timer: { ms: ISLAND_TIMING.alertPeek, event: { type: 'alertEnd' } } }
    case 'alertEnd':
      return ui.view === 'peek' && !ui.over ? { ui: to('compact', { byAlert: false }), timer: null } : { ui: { ...ui, byAlert: false } }
    case 'close':
      return { ui: to('compact', { pinned: false, typing: false, byAlert: false }), timer: null }
    case 'blur':
      // You clicked into another app: the panel goes, unless pinned or you wrote something.
      return ui.view === 'expanded' && !stays ? { ui: to('compact', { byAlert: false }), timer: null } : { ui }
    case 'pin':
      return { ui: { ...ui, pinned: !ui.pinned }, timer: null }
    case 'typing':
      return e.on ? { ui: { ...ui, typing: true }, timer: null } : { ui: { ...ui, typing: false } }
  }
}

/** The shape's size per view (CSS px before the size setting); expanded height follows the content. */
export const ISLAND_SHAPE = {
  compact: { radius: 19 },
  peek: { width: 400, radius: 28 },
  expanded: { width: 460, maxHeight: 600, radius: 32 }
} as const

// ---- One rule for every reminder (P1, P3, P4) ------------------------------

export type AlertPriority = 'urgent' | 'normal' | 'ambient'
/** Time-up is urgent; plans, Ben and rewards are normal; body nudges are background. */
export function alertPriority(kind: string): AlertPriority {
  if (kind === 'over') return 'urgent'
  if (kind === 'water' || kind === 'move' || kind === 'eyes' || kind === 'highlight' || kind === 'clip') return 'ambient'
  return 'normal'
}
/** peek: drop down (with its sound); silent: only a dot, it waits in the panel; drop: not shown at all. */
export type AlertGate = 'peek' | 'silent' | 'drop'
export const PEEK_GAP_MS = 3 * 60_000

export function alertGate(o: { kind: string; prefs: Pick<IslandPrefs, 'kinds'>; quiet: boolean; call: boolean; lastPeekAt: number; now: number }): AlertGate {
  const pref = alertPref(o.kind)
  if (pref && !o.prefs.kinds[pref].on) return 'drop'
  const p = alertPriority(o.kind)
  // Quiet: nothing drops down; your own timer running out still waits for you.
  if (o.quiet) return p === 'urgent' ? 'silent' : 'drop'
  // In a call: only time-up drops down.
  if (o.call) return p === 'urgent' ? 'peek' : 'silent'
  // At most one pop-up every 3 minutes (time-up always).
  if (p !== 'urgent' && o.now - o.lastPeekAt < PEEK_GAP_MS) return 'silent'
  return 'peek'
}

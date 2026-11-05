// The desktop island: a small always-on-top pill at the top of the screen
// (Windows), separate from the app window. The app window (running hidden in
// the tray) sends it a snapshot of your moment; the island sends back taps.
// This file is the pure part: what it shows, and when it drops down.
import { normalizeAccelerator } from './islandKeys'

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
  /** A calendar meeting (a call link or other people) starting: its own rule in Settings (IF5). */
  meeting?: boolean
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
          ...(starting.call ? { meeting: true } : {}),
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
  /** 'app': the app's own colours, light or dark (IP4). */
  look: 'black' | 'glass' | 'mood' | 'app'
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
  /** Each kind of reminder: drops down, only a dot, or never (IF5), with or without its sound (P4). `on` is false for "never". */
  kinds: Record<AlertKindPref, { on: boolean; sound: boolean; show?: AlertRule }>
  /** Sound volume, 0 … 1 (A8). */
  volume: number
  // ---- Make it yours (IF3–IF11, IP3) ----
  /** What the pill may show, in your order (IF4). */
  pillOrder: { id: PillItem; on: boolean }[]
  /** Open the panel this many minutes before a meeting (0 = don't) (IF5). */
  meetingOpenMin: number
  /** Peek when the mouse rests on it, or only open on a click (IF7). */
  openOn: 'hover' | 'click'
  /** How long the mouse rests before it peeks (ms) (IF7). */
  hoverMs: number
  /** What a left, middle and right click on the pill do (IF8). */
  clicks: { left: ClickAction; middle: ClickAction; right: ClickAction }
  /** Your quick chips: water amounts (ml), rep counts and focus lengths (min) (IF10). */
  chips: { water: number[]; reps: number[]; focus: number[] }
  /** How long a reminder peeks (s), the least time between two (min), and how long the panel stays after the mouse leaves (s) (IF11). */
  peekSec: number
  gapMin: number
  leaveSec: number
  /** Tuck away after this many minutes with nothing live (0 = never), as a tiny dot or faded (IP3). */
  idleMin: number
  idleLook: 'dot' | 'fade'
  /** Sizes in CSS px before the size setting (IF3). */
  pillHeight: number
  peekWidth: number
  panelWidth: number
  /** Animations: full (springs, flights, water bubbles), calm (gentle fades) or off. */
  motion: 'full' | 'calm' | 'off'
}

/** peek: it drops down; dot: a dot only (it waits in the panel); never: not shown (IF5). */
export type AlertRule = 'peek' | 'dot' | 'never'
/** What a click on the pill does (IF8). */
export type ClickAction = 'panel' | 'timer' | 'app' | 'quiet'
export const CLICK_LABEL: Record<ClickAction, string> = { panel: 'Open the panel', timer: 'Start / stop the timer', app: 'Open Life System', quiet: 'Quiet menu' }
/** What the pill can show (IF4). The streak flame is gone on purpose. */
export type PillItem = 'timer' | 'now' | 'next' | 'ben' | 'bed' | 'water' | 'points' | 'mustdos' | 'tasks'
export const PILL_LABEL: Record<PillItem, string> = { timer: 'Focus timer', now: 'What’s on now', next: 'What’s next', ben: 'Ben’s new message', bed: 'Bedtime', water: 'Water today', points: 'Points', mustdos: 'Must-dos left', tasks: 'Next Todoist task' }
export const DEFAULT_PILL_ORDER: { id: PillItem; on: boolean }[] = (['timer', 'now', 'next', 'ben', 'bed', 'water', 'points', 'mustdos', 'tasks'] as PillItem[]).map((id) => ({ id, on: !['points', 'mustdos', 'tasks'].includes(id) }))
/** The quick picks for "Tucks away" (seconds the panel stays after the mouse leaves). */
export const HIDE_SEC: Record<'fast' | 'normal' | 'slow', number> = { fast: 1, normal: 2, slow: 4 }
/** What the size sliders allow (CSS px before the size setting) (IF3). */
export const SIZE_LIMITS = { pillHeight: [28, 56], peekWidth: [320, 560], panelWidth: [380, 640] } as const

/** The reminder kinds you can turn on/off (P4). */
export type AlertKindPref = 'meeting' | 'block' | 'water' | 'move' | 'eyes' | 'ben' | 'bed' | 'morning' | 'highlight' | 'reward' | 'over'
export const KIND_LABEL: Record<AlertKindPref, string> = { meeting: 'Meetings starting', water: 'Water', move: 'Stretch breaks', eyes: 'Eye breaks (20-20-20)', ben: "Ben's messages", block: 'Blocks starting / ending', bed: 'Bedtime & wind-down', morning: 'Morning', highlight: 'Highlights', reward: 'Rewards', over: 'Focus time is up' }
// Not Ctrl+Alt+<key> by default: that's AltGr on many keyboards (@, ł…) (IS15).
export const QUIET_SHORTCUTS = ['Alt+Shift+Q', 'Control+Shift+Q', 'Control+Alt+Q', ''] as const

/** Which preference an alert kind falls under (a starting meeting has its own). */
export function alertPref(kind: string, meeting = false): AlertKindPref | null {
  if (meeting && kind === 'block') return 'meeting'
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
  kinds: Object.fromEntries((['meeting', 'block', 'water', 'move', 'eyes', 'ben', 'bed', 'morning', 'highlight', 'reward', 'over'] as AlertKindPref[]).map((k) => [k, { on: true, sound: k !== 'highlight', show: 'peek' as AlertRule }])) as IslandPrefs['kinds'],
  volume: 0.7,
  pillOrder: DEFAULT_PILL_ORDER,
  meetingOpenMin: 0,
  openOn: 'hover',
  hoverMs: 350,
  clicks: { left: 'panel', middle: 'timer', right: 'quiet' },
  chips: { water: [250, 500], reps: [10], focus: [25] },
  peekSec: 5,
  gapMin: 3,
  leaveSec: 2,
  idleMin: 0,
  idleLook: 'dot',
  pillHeight: 38,
  peekWidth: 400,
  panelWidth: 460,
  motion: 'full'
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
    look: ['black', 'glass', 'mood', 'app'].includes(p?.look) ? p.look : d.look,
    sections,
    sound: p?.sound !== false,
    hide: ['fast', 'normal', 'slow'].includes(p?.hide) ? p.hide : d.hide,
    // IF9: any real shortcut you record ('' = none).
    shortcut: cleanShortcut(p?.shortcut, d.shortcut),
    callMode: ['hide', 'dot', 'normal'].includes(p?.callMode) ? p.callMode : d.callMode,
    quietShortcut: cleanShortcut(p?.quietShortcut, d.quietShortcut),
    kinds: Object.fromEntries((Object.keys(KIND_LABEL) as AlertKindPref[]).map((k) => {
      const saved = p?.kinds?.[k]
      // Older settings only had on/off: off is "never".
      const show: AlertRule = ['peek', 'dot', 'never'].includes(saved?.show) ? saved.show : saved?.on === false ? 'never' : d.kinds[k].show
      return [k, { on: show !== 'never', sound: typeof saved?.sound === 'boolean' ? saved.sound : d.kinds[k].sound, show }]
    })) as IslandPrefs['kinds'],
    volume: Number.isFinite(p?.volume) ? Math.min(1, Math.max(0, Number(p.volume))) : d.volume,
    pillOrder: cleanOrder(p?.pillOrder),
    meetingOpenMin: num(p?.meetingOpenMin, 0, 30, d.meetingOpenMin, true),
    openOn: p?.openOn === 'click' ? 'click' : 'hover',
    hoverMs: num(p?.hoverMs, 100, 2000, d.hoverMs, true),
    clicks: {
      left: cleanClick(p?.clicks?.left, d.clicks.left),
      middle: cleanClick(p?.clicks?.middle, d.clicks.middle),
      right: cleanClick(p?.clicks?.right, d.clicks.right)
    },
    chips: {
      water: chipList(p?.chips?.water, 50, 2000, d.chips.water),
      reps: chipList(p?.chips?.reps, 1, 500, d.chips.reps),
      focus: chipList(p?.chips?.focus, 1, 240, d.chips.focus)
    },
    peekSec: num(p?.peekSec, 2, 60, d.peekSec, true),
    gapMin: num(p?.gapMin, 0, 60, d.gapMin, true),
    // Older settings only had the fast / normal / slow pick.
    leaveSec: num(p?.leaveSec, 0.5, 30, HIDE_SEC[(['fast', 'normal', 'slow'] as const).find((h) => h === p?.hide) ?? 'normal'], false),
    idleMin: num(p?.idleMin, 0, 240, d.idleMin, true),
    idleLook: p?.idleLook === 'fade' ? 'fade' : 'dot',
    pillHeight: num(p?.pillHeight, SIZE_LIMITS.pillHeight[0], SIZE_LIMITS.pillHeight[1], d.pillHeight, true),
    peekWidth: num(p?.peekWidth, SIZE_LIMITS.peekWidth[0], SIZE_LIMITS.peekWidth[1], d.peekWidth, true),
    panelWidth: num(p?.panelWidth, SIZE_LIMITS.panelWidth[0], SIZE_LIMITS.panelWidth[1], d.panelWidth, true),
    motion: ['full', 'calm', 'off'].includes(p?.motion) ? p.motion : d.motion
  }
}

/** A number in [min, max] (whole when `int`, else one decimal), else the default. */
function num(v: unknown, min: number, max: number, d: number, int: boolean): number {
  const n = Number(v)
  if (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(n)) return d
  const c = Math.min(max, Math.max(min, n))
  return int ? Math.round(c) : Math.round(c * 10) / 10
}
function cleanShortcut(v: unknown, d: string): string {
  if (v === '') return ''
  return normalizeAccelerator(v) ?? d
}
function cleanClick(v: unknown, d: ClickAction): ClickAction {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CLICK_LABEL, v) ? (v as ClickAction) : d
}
/** 1–4 different numbers in range, in your order; nothing valid → the default. */
function chipList(v: unknown, min: number, max: number, d: number[]): number[] {
  if (!Array.isArray(v)) return d
  const out: number[] = []
  for (const x of v) {
    const n = Math.round(Number(x))
    if (Number.isFinite(n) && n >= min && n <= max && !out.includes(n)) out.push(n)
    if (out.length >= 4) break
  }
  return out.length ? out : d
}
/** Your pill order: unknown items dropped, new ones added at the end (in their default state). */
export function cleanOrder(v: unknown): { id: PillItem; on: boolean }[] {
  const known = DEFAULT_PILL_ORDER.map((x) => x.id)
  const saved: { id: PillItem; on: boolean }[] = []
  for (const x of Array.isArray(v) ? v : []) {
    if (x && known.includes(x.id) && !saved.some((y) => y.id === x.id)) saved.push({ id: x.id, on: x.on !== false })
  }
  return [...saved, ...DEFAULT_PILL_ORDER.filter((x) => !saved.some((y) => y.id === x.id))]
}

// ---- Live activities: everything worth showing in the pill right now ----

export interface Activity extends Omit<Pill, 'kind'> {
  kind: 'timer' | 'now' | 'next' | 'idle' | 'ben' | 'water' | 'bed' | 'points' | 'mustdos' | 'tasks'
  /** Stable id, so a chosen activity stays chosen as numbers tick. */
  key: string
  /** When it starts (ms): a live countdown in the last 10 minutes (P7). */
  at?: number
}

/**
 * The pill's activities in your order (IF4; by default: the running timer,
 * the block now, the next block within 3 h, Ben's unread message, bedtime,
 * water left today). Something starting within 10 minutes moves up, right
 * after a running timer, with a live countdown (P7). Items you switched off
 * never show. The pill shows the first (or the one you picked) with the next
 * one as a small bubble beside it (see pillBubbles).
 */
export function activities(s: IslandSnapshot, now: number, order: { id: PillItem; on: boolean }[] = DEFAULT_PILL_ORDER): Activity[] {
  const dot = s.ben.unread > 0 || !!s.alert
  const make: Record<PillItem, () => Activity | null> = {
    timer: () => {
      if (!s.running) return null
      const left = (s.running.endsAt - now) / 1000
      return { key: 'timer', kind: 'timer', text: `${left < 0 ? '+' : ''}${clock(left)}`, sub: s.running.subject, pct: Math.min(1, (now - s.running.startedAt) / Math.max(1, s.running.endsAt - s.running.startedAt)), over: left < 0, dot }
    },
    now: () => (s.now ? { key: `now:${s.now.start}`, kind: 'now', text: `${s.now.call ? '📞 ' : ''}${s.now.title}`, sub: `${mins(s.now.end - now)} left`, pct: (now - s.now.start) / Math.max(1, s.now.end - s.now.start), over: false, dot } : null),
    next: () => (s.next && s.next.start - now <= 3 * 3600_000 ? { key: `next:${s.next.start}`, kind: 'next', text: s.next.title, sub: `in ${mins(s.next.start - now)}`, pct: 0, over: false, dot, at: s.next.start } : null),
    ben: () => (s.ben.unread > 0 && s.ben.last ? { key: `ben:${s.ben.last.at}`, kind: 'ben', text: s.ben.last.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 60), sub: 'Ben', pct: 0, over: false, dot } : null),
    bed: () => (s.sleep?.bed && !s.running ? { key: 'bed', kind: 'bed', text: 'Going to bed?', sub: 'Tap to log it in Waky', pct: 0, over: false, dot } : null),
    // Water shows even when nothing else is on (P5).
    water: () => (s.water.target > 0 && s.water.ml < s.water.target ? { key: 'water', kind: 'water', text: `${(s.water.ml / 1000).toFixed(1)} / ${(s.water.target / 1000).toFixed(1)} L`, sub: 'Water', pct: s.water.ml / s.water.target, over: false, dot } : null),
    points: () => {
      const p = s.points
      if (!p) return null
      const pct = p.goal ? Math.min(1, p.balance / Math.max(1, p.goal.price)) : 0
      return { key: 'points', kind: 'points', text: `${p.balance} pts`, sub: p.goal ? (p.balance >= p.goal.price ? `Ready: ${p.goal.title}` : `${p.goal.price - p.balance} to ${p.goal.title}`) : 'Points', pct, over: false, dot }
    },
    mustdos: () => {
      const left = s.mustdos.filter((m) => !m.done)
      return left.length ? { key: 'mustdos', kind: 'mustdos', text: left[0].text, sub: `${left.length} must-do${left.length === 1 ? '' : 's'} left`, pct: 1 - left.length / s.mustdos.length, over: false, dot } : null
    },
    tasks: () => {
      const t = s.tasks?.[0]
      return t ? { key: `task:${t.id}`, kind: 'tasks', text: t.content, sub: t.time ?? 'Todoist', pct: 0, over: false, dot } : null
    }
  }
  const out: Activity[] = []
  for (const item of cleanOrder(order)) {
    if (!item.on) continue
    const a = make[item.id]()
    if (a) out.push(a)
  }
  // Starting within 10 minutes: it moves up, right after a running timer (P7).
  const ni = out.findIndex((a) => a.kind === 'next')
  if (ni >= 0 && (out[ni].at ?? Infinity) - now <= 10 * 60_000) {
    const to = out[0]?.kind === 'timer' ? 1 : 0
    if (ni > to) out.splice(to, 0, ...out.splice(ni, 1))
  }
  return out
}

/**
 * The pill's two bubbles (IF4): the main one (the one you picked, else the
 * first) and the next one in your order beside it. The pill and its second
 * bubble both read this, so they always follow the same order.
 */
export function pillBubbles(acts: Activity[], pick: string | null = null): { main: Activity | null; second: Activity | null } {
  const main = acts.find((a) => a.key === pick) ?? acts[0] ?? null
  const second = acts.find((a) => a !== main) ?? null
  return { main, second }
}

/** Something live, worth keeping the pill awake for: a timer, a block now or soon, an alert, Ben's new message, bedtime (IP3). */
export function isLive(s: IslandSnapshot, now: number): boolean {
  return !!(s.running || s.now || s.alert || s.ben.unread > 0 || s.sleep?.bed || (s.next && s.next.start - now <= 10 * 60_000))
}

/** IP3: after `idleMin` minutes with nothing live it tucks away (a tiny dot or faded); the mouse on it, or anything opening, brings it back. */
export function tuckState(o: { now: number; lastLiveAt: number; idleMin: number; idleLook: 'dot' | 'fade'; over: boolean; view: IslandView }): 'none' | 'dot' | 'fade' {
  if (!o.idleMin || o.over || o.view !== 'compact') return 'none'
  return o.now - o.lastLiveAt >= o.idleMin * 60_000 ? o.idleLook : 'none'
}

/** IF5: a meeting you said yes to starts within `minutes`: its key (open the panel for it once), else null. */
export function meetingToOpen(s: IslandSnapshot, now: number, minutes: number): string | null {
  if (!minutes || !s.next || !s.next.call || s.next.maybe) return null
  const left = s.next.start - now
  return left > 0 && left <= minutes * 60_000 ? `meet:${s.next.start}:${s.next.title}` : null
}

/**
 * Is this pill activity live (IL2): a running timer, a meeting within 10
 * minutes, Ben's unread message? Two live ones show as the pill plus a small
 * round bubble beside it.
 */
export function liveActivity(a: Activity | null, now: number): boolean {
  return !!a && (a.kind === 'timer' || a.kind === 'ben' || (a.kind === 'next' && a.at != null && a.at - now <= 10 * 60_000))
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
  /** IF5: a meeting is about to start: the panel opens by itself, and goes after `ms` if you don't touch it. */
  | { type: 'autoOpen'; ms: number }
/** undefined: keep the current timer; null: cancel it; else replace it. */
export interface IslandUiStep { ui: IslandUi; timer?: { ms: number; event: IslandUiEvent } | null; focusInput?: boolean }

export const ISLAND_UI: IslandUi = { view: 'compact', pinned: false, over: false, typing: false, byAlert: false }
/** How long the pointer must stay to peek, and how long it may be away before it shrinks. */
export const ISLAND_TIMING = { hoverToPeek: 350, peekLeave: 700, alertPeek: 5000, expandedLeave: { fast: 1000, normal: 2000, slow: 4000 } as Record<IslandPrefs['hide'], number> }
/** Your timings (IF7, IF11): null hoverToPeek = it never peeks on hover, only opens on a click. */
export interface IslandTiming { hoverToPeek: number | null; peekLeave: number; alertPeek: number; expandedLeave: number }
export function islandTiming(p: Partial<Pick<IslandPrefs, 'openOn' | 'hoverMs' | 'peekSec' | 'leaveSec' | 'hide'>>): IslandTiming {
  return {
    hoverToPeek: p.openOn === 'click' ? null : Number.isFinite(p.hoverMs) ? p.hoverMs! : ISLAND_TIMING.hoverToPeek,
    peekLeave: ISLAND_TIMING.peekLeave,
    alertPeek: Number.isFinite(p.peekSec) ? p.peekSec! * 1000 : ISLAND_TIMING.alertPeek,
    expandedLeave: Number.isFinite(p.leaveSec) ? p.leaveSec! * 1000 : ISLAND_TIMING.expandedLeave[p.hide ?? 'normal']
  }
}

export function islandStep(ui: IslandUi, e: IslandUiEvent, hide: IslandPrefs['hide'] | IslandTiming = 'normal'): IslandUiStep {
  const to = (view: IslandView, extra: Partial<IslandUi> = {}): IslandUi => ({ ...ui, view, ...extra })
  const stays = ui.pinned || ui.typing
  const t: IslandTiming = typeof hide === 'string' ? islandTiming({ hide }) : hide
  switch (e.type) {
    case 'hover':
      if (e.on) return { ui: { ...ui, over: true }, timer: ui.view === 'compact' && t.hoverToPeek != null ? { ms: t.hoverToPeek, event: { type: 'hoverHeld' } } : null }
      if (ui.view === 'peek') return { ui: { ...ui, over: false }, timer: { ms: t.peekLeave, event: { type: 'leave' } } }
      if (ui.view === 'expanded' && !stays) return { ui: { ...ui, over: false }, timer: { ms: t.expandedLeave, event: { type: 'leave' } } }
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
      return { ui: to('peek', { byAlert: true }), timer: { ms: t.alertPeek, event: { type: 'alertEnd' } } }
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
    case 'autoOpen':
      if (ui.view === 'expanded') return { ui }
      return { ui: to('expanded', { byAlert: true }), timer: { ms: Math.max(1000, e.ms), event: { type: 'leave' } } }
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

/**
 * IF5, IF11: your rule for this kind (drops down / a dot only / never), then
 * quiet, calls, and the least time between two pop-ups (`gapMin`, 3 min by
 * default; time-up always drops down unless you made it a dot).
 */
export function alertGate(o: { kind: string; meeting?: boolean; prefs: Pick<IslandPrefs, 'kinds'> & Partial<Pick<IslandPrefs, 'gapMin'>>; quiet: boolean; call: boolean; lastPeekAt: number; now: number }): AlertGate {
  const pref = alertPref(o.kind, !!o.meeting)
  const k = pref ? o.prefs.kinds[pref] : null
  const rule: AlertRule = !k ? 'peek' : k.show ?? (k.on ? 'peek' : 'never')
  if (rule === 'never' || (k && k.on === false)) return 'drop'
  const p = alertPriority(o.kind)
  // Quiet: nothing drops down; your own timer running out still waits for you.
  if (o.quiet) return p === 'urgent' ? 'silent' : 'drop'
  if (rule === 'dot') return 'silent'
  // In a call: only time-up drops down.
  if (o.call) return p === 'urgent' ? 'peek' : 'silent'
  // At most one pop-up every few minutes (time-up always).
  const gap = Number.isFinite(o.prefs.gapMin) ? o.prefs.gapMin! * 60_000 : PEEK_GAP_MS
  if (p !== 'urgent' && o.now - o.lastPeekAt < gap) return 'silent'
  return 'peek'
}

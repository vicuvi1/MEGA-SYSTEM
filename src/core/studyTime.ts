// Study Time (pure, tested in studyTime.test.ts): blocks you time (a subject,
// task or topic), their filters, the running timer's live numbers, the
// "forgot to stop" rule and the stats behind the page and the island.
//
// There is ONE timer in the app: a Study Time block runs as the focus timer
// (focus_running, src/main/focus.ts) with its block id, and a break is the
// timer's pause (paused time never counts as study). A finished session is a
// focus_sessions row with its block id, its break minutes and where it came
// from ('timer' live, 'manual' typed in, 'fixed' a forgotten timer you put
// right). Blocks live in the synced setting `study_blocks`.
import { addDays, dayKey, daysBetween } from './dates'

// ---------------------------------------------------------------- blocks

export interface StudyBlock {
  id: string
  name: string
  /** A project or subject ("Math"); '' for none. */
  category: string
  tags: string[]
  /** Planned length in minutes, or null for an open stopwatch. */
  plannedMin: number | null
  /** A quick block: on top of the list and on the island, one tap to start. */
  quick: boolean
  /** For Today / Tomorrow / This week (YYYY-MM-DD), or null: any day. */
  due: string | null
  /** Completed (shown under Completed only). */
  done: boolean
  /** The Todoist task it is for (linked, never copied). */
  taskId?: string | null
  taskTitle?: string | null
  /** Pulled from Todoist by your study projects or labels (studyPlan.ts todoistBlocks). */
  fromTodoist?: boolean
  /** Estimated pomodoros (the tomato dots: planned against done), or null. */
  estPomos?: number | null
  /** Comes back after Done: every day, on weekdays or every week (its day moves on). */
  repeat?: Repeat | null
  /** The last day it was done (a repeating block moves on instead of staying done). */
  lastDone?: string | null
  createdAt: string
}

export type Repeat = 'daily' | 'weekdays' | 'weekly'
export const REPEATS: readonly Repeat[] = ['daily', 'weekdays', 'weekly']

export interface StudyCategory {
  name: string
  color: string
  /** The subject's emoji (the timer, the bars and the island). */
  emoji?: string
}

/** The noise under a study block (generated, no recordings). */
export type StudyNoise = 'off' | 'white' | 'brown' | 'rain'
/** The sounds you can pick for the end of a pomodoro and the end of a break (all made by the app's sound kit). */
export const STUDY_SOUNDS = ['focusEnd', 'levelUp', 'remindReward', 'success', 'remindEyes', 'remind', 'notify'] as const
export type StudySound = (typeof STUDY_SOUNDS)[number]
export const STUDY_SOUND_LABEL: Record<StudySound, string> = { focusEnd: 'Gong', levelUp: 'Fanfare', remindReward: 'Chime', success: 'Bright', remindEyes: 'Soft bell', remind: 'Ding', notify: 'Pop' }

export interface StudyPrefs {
  /** Pomodoro (work, then a break) or count up (the planned length, or an open stopwatch). */
  mode: 'pomodoro' | 'up'
  work: number
  short: number
  long: number
  /** A long break after this many pomodoros. */
  every: number
  endSound: StudySound
  breakSound: StudySound
  /** A soft tick while you study. */
  tick: boolean
  noise: StudyNoise
  /** The gentle notices (a planned block waiting, a goal reached or behind). Timer notices always come. */
  nudges: boolean
  /** Which Todoist tasks show as blocks: by project or label (names, any case). */
  todoist: { projects: string[]; labels: string[] }
}

export const DEFAULT_PREFS: StudyPrefs = { mode: 'pomodoro', work: 25, short: 5, long: 15, every: 4, endSound: 'focusEnd', breakSound: 'remindReward', tick: false, noise: 'off', nudges: true, todoist: { projects: [], labels: [] } }

/** A goal per subject: minutes a week ("Math 6 h this week"). */
export interface StudyGoal {
  category: string
  minutes: number
}

export interface StudyStore {
  v: 1
  blocks: StudyBlock[]
  categories: StudyCategory[]
  prefs?: StudyPrefs
  goals?: StudyGoal[]
}

export const MAX_BLOCKS = 200
export const MAX_TAGS = 6
export const NO_BLOCK_COLOR = '#64748b'
export const PALETTE = ['#7c9cff', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#34d399', '#fb7185', '#94a3b8'] as const

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** A tag as stored: lower case, no '#', no spaces at the ends. */
export const cleanTag = (t: unknown) => str(t, 24).replace(/^#+/, '').toLowerCase()

/** Planned minutes: 1–600, or null for none. */
export function cleanPlanned(v: unknown): number | null {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(600, n) : null
}

/** One block from anything (null when it has no id or name). */
export function cleanBlock(v: unknown): StudyBlock | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id, 40)
  const name = str(o.name, 60)
  if (!id || !name) return null
  const tags = [...new Set((Array.isArray(o.tags) ? o.tags : []).map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS)
  const taskId = str(o.taskId, 80)
  const est = Math.round(Number(o.estPomos))
  const repeat = REPEATS.includes(o.repeat as Repeat) ? (o.repeat as Repeat) : null
  return {
    id,
    name,
    category: str(o.category, 40),
    tags,
    plannedMin: cleanPlanned(o.plannedMin),
    quick: !!o.quick,
    due: isDay(o.due) ? o.due : null,
    done: !!o.done,
    ...(taskId ? { taskId, taskTitle: str(o.taskTitle, 120) || null, ...(o.fromTodoist ? { fromTodoist: true } : {}) } : {}),
    ...(est >= 1 ? { estPomos: Math.min(20, est) } : {}),
    ...(repeat ? { repeat } : {}),
    ...(isDay(o.lastDone) ? { lastDone: o.lastDone } : {}),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date(0).toISOString()
  }
}

/** The whole setting, cleaned (unknown parts dropped, at most MAX_BLOCKS). */
export function cleanStore(v: unknown): StudyStore {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const seen = new Set<string>()
  const blocks: StudyBlock[] = []
  for (const x of Array.isArray(o.blocks) ? o.blocks : []) {
    const b = cleanBlock(x)
    if (!b || seen.has(b.id)) continue
    seen.add(b.id)
    blocks.push(b)
    if (blocks.length >= MAX_BLOCKS) break
  }
  const cats: StudyCategory[] = []
  for (const x of Array.isArray(o.categories) ? o.categories : []) {
    const name = str((x as StudyCategory)?.name, 40)
    const color = str((x as StudyCategory)?.color, 20)
    const emoji = cleanEmoji((x as StudyCategory)?.emoji)
    if (name && /^#[0-9a-f]{3,8}$/i.test(color) && !cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) cats.push({ name, color, ...(emoji ? { emoji } : {}) })
  }
  const goals: StudyGoal[] = []
  for (const x of Array.isArray(o.goals) ? o.goals : []) {
    const category = str((x as StudyGoal)?.category, 40)
    const minutes = Math.round(Number((x as StudyGoal)?.minutes))
    if (category && minutes >= 10 && !goals.some((g) => g.category.toLowerCase() === category.toLowerCase())) goals.push({ category, minutes: Math.min(100 * 60, minutes) })
  }
  return { v: 1, blocks, categories: cats.slice(0, 40), prefs: cleanPrefs(o.prefs), goals: goals.slice(0, 20) }
}

/** One emoji (or a short symbol), or ''. */
export function cleanEmoji(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  if (!t || /[A-Za-z0-9<>]/.test(t)) return ''
  return [...t].slice(0, 4).join('')
}

const intIn = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d
}

/** Your timer and sound choices, cleaned (anything unknown takes the default). */
export function cleanPrefs(v: unknown): StudyPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const d = DEFAULT_PREFS
  const snd = (x: unknown, def: StudySound) => (STUDY_SOUNDS.includes(x as StudySound) ? (x as StudySound) : def)
  const t = (o.todoist && typeof o.todoist === 'object' ? o.todoist : {}) as Record<string, unknown>
  const names = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).map((n) => str(n, 60)).filter(Boolean))].slice(0, 20)
  return {
    mode: o.mode === 'up' ? 'up' : 'pomodoro',
    work: intIn(o.work, 5, 120, d.work),
    short: intIn(o.short, 1, 30, d.short),
    long: intIn(o.long, 5, 60, d.long),
    every: intIn(o.every, 2, 8, d.every),
    endSound: snd(o.endSound, d.endSound),
    breakSound: snd(o.breakSound, d.breakSound),
    tick: !!o.tick,
    noise: o.noise === 'white' || o.noise === 'brown' || o.noise === 'rain' ? o.noise : 'off',
    nudges: o.nudges !== false,
    todoist: { projects: names(t.projects), labels: names(t.labels).map((l) => l.replace(/^@/, '').toLowerCase()) }
  }
}

/** The prefs of a store (older stores have none yet). */
export const prefsOf = (s: Pick<StudyStore, 'prefs'>): StudyPrefs => s.prefs ?? DEFAULT_PREFS

/** Made-up starter blocks for an empty store (the owner edits or removes them). */
export function starterStore(now: Date): StudyStore {
  const at = now.toISOString()
  const b = (id: string, name: string, category: string, tags: string[], plannedMin: number | null, estPomos: number | null): StudyBlock => ({ id, name, category, tags, plannedMin, quick: true, due: null, done: false, ...(estPomos ? { estPomos } : {}), createdAt: at })
  return {
    v: 1,
    blocks: [b('st-math', 'Math problems', 'Math', ['practice'], 50, 2), b('st-read', 'Reading', 'English', ['reading'], 25, 1), b('st-rev', 'Review notes', 'General', ['review'], null, null)],
    categories: [
      { name: 'Math', color: PALETTE[0], emoji: '📐' },
      { name: 'English', color: PALETTE[1], emoji: '📖' },
      { name: 'General', color: PALETTE[7], emoji: '📝' }
    ],
    prefs: DEFAULT_PREFS,
    goals: []
  }
}

/** A new block's id (time + a little randomness; unique enough for one person). */
export const newBlockId = (now: number, rand = Math.random) => `b${now.toString(36)}${Math.floor(rand() * 1296).toString(36).padStart(2, '0')}`

/** Adds or replaces a block (by id). Throws a plain reason when it can't. */
export function saveBlock(store: StudyStore, input: Partial<StudyBlock> & { id: string; name: string }, now: Date): StudyStore {
  const was = store.blocks.find((b) => b.id === input.id)
  const b = cleanBlock({ ...(was ?? { createdAt: now.toISOString() }), ...input })
  if (!b) throw new Error('Give the block a name')
  if (!was && store.blocks.length >= MAX_BLOCKS) throw new Error(`At most ${MAX_BLOCKS} blocks: remove a few you no longer use`)
  const blocks = was ? store.blocks.map((x) => (x.id === b.id ? b : x)) : [...store.blocks, b]
  // A new category gets the next colour.
  const cats = [...store.categories]
  if (b.category && !cats.some((c) => c.name.toLowerCase() === b.category.toLowerCase())) cats.push({ name: b.category, color: PALETTE[cats.length % PALETTE.length] })
  return { ...store, blocks, categories: cats }
}

export function removeBlock(store: StudyStore, id: string): StudyStore {
  return { ...store, blocks: store.blocks.filter((b) => b.id !== id) }
}

/** A subject's emoji ('' for none). */
export function categoryEmoji(store: Pick<StudyStore, 'categories'>, name: string): string {
  return store.categories.find((x) => x.name.toLowerCase() === name.toLowerCase())?.emoji ?? ''
}

export function categoryColor(store: Pick<StudyStore, 'categories'>, name: string): string {
  const c = store.categories.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (c) return c.color
  if (!name) return PALETTE[7]
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// ---------------------------------------------------------------- filters

export type StudyFilter =
  | { kind: 'today' | 'tomorrow' | 'week' | 'all' | 'done' }
  | { kind: 'category'; name: string }
  | { kind: 'tag'; tag: string }

/** The last day of the week that holds `day` (weeks run Monday to Sunday). */
export function weekEnd(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay() // 0 Sunday
  return addDays(day, (7 - dow) % 7)
}
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

/**
 * The blocks a filter shows, in your own order (drag to reorder). A block
 * with no day belongs to every day (Today and This week); an overdue one
 * stays in Today. Completed blocks show only under Completed (and under their
 * category or tag).
 */
export function filterBlocks(blocks: StudyBlock[], f: StudyFilter, today: string): StudyBlock[] {
  const tomorrow = addDays(today, 1)
  const end = weekEnd(today)
  const keep = (b: StudyBlock): boolean => {
    switch (f.kind) {
      case 'today':
        return !b.done && (!b.due || b.due <= today)
      case 'tomorrow':
        return !b.done && b.due === tomorrow
      case 'week':
        return !b.done && (!b.due || b.due <= end)
      case 'all':
        return !b.done
      case 'done':
        return b.done
      case 'category':
        return b.category.toLowerCase() === f.name.toLowerCase()
      case 'tag':
        return b.tags.includes(cleanTag(f.tag))
    }
  }
  return blocks.filter(keep)
}

/** Past its day and not done (shown in red). */
export const isOverdue = (b: Pick<StudyBlock, 'due' | 'done'>, today: string) => !b.done && !!b.due && b.due < today

/** How many blocks each fixed filter shows (the counts next to the filter names). */
export function filterCounts(blocks: StudyBlock[], today: string): Record<'today' | 'tomorrow' | 'week' | 'all' | 'done', number> {
  const n = (kind: 'today' | 'tomorrow' | 'week' | 'all' | 'done') => filterBlocks(blocks, { kind }, today).length
  return { today: n('today'), tomorrow: n('tomorrow'), week: n('week'), all: n('all'), done: n('done') }
}

// ---------------------------------------------------------------- the running timer

/** The parts of the running focus timer that Study Time reads. */
export interface StudyRun {
  subject: string
  startedAt: string
  planned: number
  pausedAt?: string | null
  pausedMs?: number
  blockId?: string | null
  /** An open stopwatch (the block has no planned length). */
  open?: boolean
  /** The break going on now: its planned length (minutes), for the sound at its end. */
  breakMin?: number | null
  /** What the pause going on now is: a break (it may have a length) or a plain pause. */
  pauseKind?: 'pause' | 'break' | null
  /** The break part of the time paused before now (ms); the rest of pausedMs was plain pauses. */
  brkMs?: number
  /** Pomodoro mode: the lengths, the pomodoros done so far, and the minutes studied at which this one ends. */
  pomo?: PomoRun | null
}

export interface PomoRun {
  work: number
  short: number
  long: number
  every: number
  done: number
  /** The studied minutes at which the pomodoro going on now ends (moves on with +5 and each new one). */
  at: number
  /** The studied minutes at which it began (the ring fills from here to `at`). */
  from?: number
}

/** How far the pomodoro going on is (0–1, past 1 when over): the ring. */
export function pomoPct(p: Pick<PomoRun, 'at' | 'from' | 'work'>, workedMs: number): number {
  const from = p.from ?? Math.max(0, p.at - p.work)
  return (workedMs / 60_000 - from) / Math.max(1, p.at - from)
}

/** The minutes studied the ring fills to: this pomodoro's end, else the planned length; null for an open stopwatch. */
export function goalMin(run: Pick<StudyRun, 'planned' | 'open' | 'pomo'>): number | null {
  if (run.pomo) return run.pomo.at
  return run.open ? null : run.planned
}

/** The break after the pomodoro going on now: long after every `every`-th one. */
export function pomoBreakLen(p: Pick<PomoRun, 'done' | 'short' | 'long' | 'every'>): number {
  return (p.done + 1) % p.every === 0 ? p.long : p.short
}

/** The pomodoros finished in this run so far (counting the one going on once its time is reached). */
export function pomosDone(run: Pick<StudyRun, 'pomo'>, workedMs: number): number {
  if (!run.pomo) return 0
  return run.pomo.done + (workedMs >= run.pomo.at * 60_000 ? 1 : 0)
}

/** Break and plain pause time so far (ms), apart: the CSV and the session note keep both. */
export function pausesOf(run: Pick<StudyRun, 'pausedAt' | 'pausedMs' | 'pauseKind' | 'brkMs'>, now: number): { breakMs: number; pauseMs: number } {
  const before = Math.max(0, Number(run.pausedMs) || 0)
  const at = run.pausedAt ? Date.parse(run.pausedAt) : NaN
  const cur = Number.isFinite(at) ? Math.max(0, now - at) : 0
  const brkBefore = Math.min(before, Math.max(0, Number(run.brkMs) || 0))
  // Older runs never said: their pauses were all breaks.
  const legacy = run.brkMs == null && !run.pauseKind
  const breakMs = (legacy ? before : brkBefore) + (run.pauseKind === 'pause' ? 0 : cur)
  return { breakMs, pauseMs: Math.max(0, before + cur - breakMs) }
}

/** Longest a single live session counts (4 hours; also what an open stopwatch is capped at). */
export const MAX_LIVE_MIN = 240
/** The one cap the stop applies: planned + 30 min, never past 4 h; an open stopwatch 4 h. */
export function sessionCap(run: Pick<StudyRun, 'planned' | 'open'>): number {
  return run.open ? MAX_LIVE_MIN : Math.min(MAX_LIVE_MIN, Math.max(1, Math.round(run.planned)) + 30)
}

export interface RunNow {
  /** Studied so far (breaks left out), ms. */
  workedMs: number
  /** All the break time so far (the one going on included), ms. */
  breakMs: number
  onBreak: boolean
  /** When the break going on ends (ms), when it has a length. */
  breakEndsAt: number | null
  /** When the planned length is reached (ms, moves later with breaks); null for an open stopwatch. */
  plannedEndsAt: number | null
}

/** The live numbers of a running timer. Works from the stored start time only, so a reload or restart loses nothing. */
export function runNow(run: StudyRun, now: number): RunNow {
  const start = Date.parse(run.startedAt)
  const before = Math.max(0, Number(run.pausedMs) || 0)
  const pausedAt = run.pausedAt ? Date.parse(run.pausedAt) : NaN
  const onBreak = Number.isFinite(pausedAt)
  const breakMs = before + (onBreak ? Math.max(0, now - pausedAt) : 0)
  const workedMs = Math.max(0, (onBreak ? pausedAt : now) - start - before)
  const breakEndsAt = onBreak && run.pauseKind !== 'pause' && run.breakMin && run.breakMin > 0 ? pausedAt + run.breakMin * 60_000 : null
  const goal = goalMin(run)
  const plannedEndsAt = goal == null ? null : start + goal * 60_000 + before + (onBreak ? Math.max(0, now - pausedAt) : 0)
  return { workedMs, breakMs, onBreak, breakEndsAt, plannedEndsAt }
}

/**
 * Forgotten overnight: the timer ran into a new app day (past 04:00) or past
 * the one cap. Then the page asks when you really stopped; whatever you
 * answer is saved without points (only a normal stop is live time).
 */
export function isForgotten(run: StudyRun, now: number, dayOf: (at: Date) => string): boolean {
  const start = Date.parse(run.startedAt)
  if (!Number.isFinite(start)) return false
  const { workedMs } = runNow(run, now)
  if (workedMs > sessionCap(run) * 60_000) return true
  // Paused and gone for hours (a break that never ended).
  const pausedAt = run.pausedAt ? Date.parse(run.pausedAt) : NaN
  if (Number.isFinite(pausedAt) && now - pausedAt > 3 * 3600_000) return true
  return dayOf(new Date(start)) !== dayOf(new Date(now)) && workedMs > 60 * 60_000
}

/** The minutes a forgotten timer saves when you say it ended at `endAt` (capped, at least 1). */
export function minutesUntil(run: StudyRun, endAt: number): number {
  const start = Date.parse(run.startedAt)
  const end = Math.max(start, endAt)
  const pausedAt = run.pausedAt ? Date.parse(run.pausedAt) : NaN
  const before = Math.max(0, Number(run.pausedMs) || 0)
  // A break going on at that end counts up to the end only.
  const brk = before + (Number.isFinite(pausedAt) && pausedAt < end ? end - pausedAt : 0)
  return Math.max(1, Math.min(sessionCap(run), Math.round((end - start - brk) / 60_000)))
}

/** Which moment just passed (the app's note and sound): the planned end or the break's end, once each. */
export function alarmDue(run: StudyRun | null, now: number, said: Set<string>): { key: string; text: string } | null {
  const r = run
  if (!r?.blockId) return null
  const n = runNow(r, now)
  if (n.onBreak && n.breakEndsAt && now >= n.breakEndsAt && now - n.breakEndsAt < 10 * 60_000) {
    const key = `brk:${n.breakEndsAt}`
    if (!said.has(key)) return { key, text: `Break's over · back to ${r.subject}` }
  }
  if (!n.onBreak && n.plannedEndsAt && now >= n.plannedEndsAt && now - n.plannedEndsAt < 10 * 60_000) {
    const key = `end:${r.startedAt}`
    if (!said.has(key)) return { key, text: `${r.subject}: planned time done. Stop, or keep going.` }
  }
  return null
}

// ---------------------------------------------------------------- sessions and stats

export interface StudySession {
  id: number
  day: string
  blockId: string | null
  subject: string
  minutes: number
  breakMin: number
  startedAt: string
  endedAt: string
  source: 'timer' | 'manual' | 'fixed'
  /** "What did you do?" (one line, saved when you stop). */
  note?: string
  /** Plain pauses (not breaks), minutes. */
  pauseMin?: number
  /** Pomodoros finished in this session (pomodoro mode). */
  pomos?: number
}

export type GroupBy = 'category' | 'tag' | 'block'
export type RangeKind = 'day' | 'week' | 'month' | 'custom'

export interface DayRange {
  from: string
  to: string
}

/** The days a range covers, ending with today (or the custom days you picked, in order). */
export function rangeOf(kind: RangeKind, today: string, custom?: Partial<DayRange> | null): DayRange {
  if (kind === 'day') return { from: today, to: today }
  if (kind === 'week') return { from: weekStart(today), to: today }
  if (kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  const a = isDay(custom?.from) ? custom!.from! : addDays(today, -6)
  const b = isDay(custom?.to) ? custom!.to! : today
  const [from, to] = a <= b ? [a, b] : [b, a]
  // At most a year, so the bars stay readable.
  return { from: daysBetween(from, to) > 366 ? addDays(to, -366) : from, to }
}

/** The range just before one of the same length (for "vs before"). */
export function rangeBefore(r: DayRange): DayRange {
  const len = daysBetween(r.from, r.to) + 1
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) }
}

export interface Slice {
  key: string
  label: string
  minutes: number
  color: string
}

export interface StudyStats {
  range: DayRange
  totalMin: number
  breakMin: number
  sessions: number
  avgSessionMin: number
  /** Where the time went (the donut), biggest first; small slices fold into "Other". */
  slices: Slice[]
  /** One bar per day of the range. */
  byDay: { day: string; minutes: number }[]
  topBlocks: { key: string; label: string; minutes: number; sessions: number; plannedMin: number | null }[]
  /** Studied against plan: sessions of blocks with a planned length. */
  plan: { plannedMin: number; actualMin: number; pct: number | null }
  /** Days in a row with any study, ending today (or yesterday when today has none yet). */
  streak: number
  bestStreak: number
  bestDay: { day: string; minutes: number } | null
  /** Total of the range before (same length), for the change line. */
  beforeMin: number
}

const NONE = { category: 'No category', block: 'No block', tag: 'No tag' }
/** The key of sessions with no block (plain focus timers, older sessions): "No block". */
export const NO_BLOCK_KEY = 'c:~none'

/**
 * Sessions with no block (a plain focus timer, or from before Study Time)
 * take the block whose name is their subject, when there is one; the rest
 * count under "No block". So the page's total and the category and tag
 * totals always agree.
 */
export function resolveBlocks(sessions: StudySession[], store: Pick<StudyStore, 'blocks'>): StudySession[] {
  const byName = new Map<string, string>()
  for (const b of store.blocks) if (!byName.has(b.name.toLowerCase())) byName.set(b.name.toLowerCase(), b.id)
  return sessions.map((s) => (s.blockId ? s : byName.has(s.subject.toLowerCase()) ? { ...s, blockId: byName.get(s.subject.toLowerCase())! } : s))
}

/** What one session counts under: by category, each tag, or the block. */
export function keysOf(s: StudySession, by: GroupBy, blocks: Map<string, StudyBlock>): { key: string; label: string }[] {
  const b = s.blockId ? blocks.get(s.blockId) : undefined
  if (by === 'block') return [{ key: b ? `b:${b.id}` : `s:${s.subject.toLowerCase()}`, label: b?.name ?? s.subject }]
  if (by === 'category') {
    if (!b) return [{ key: NO_BLOCK_KEY, label: NONE.block }]
    const c = b.category
    return [{ key: `c:${c.toLowerCase()}`, label: c || NONE.category }]
  }
  const tags = b?.tags ?? []
  return tags.length ? tags.map((t) => ({ key: `t:${t}`, label: `#${t}` })) : [{ key: 't:', label: NONE.tag }]
}

/** Days in a row with study, ending at `today` (or the day before when today has nothing yet). */
export function streakOf(days: Set<string>, today: string): number {
  let d = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(d)) {
    n++
    d = addDays(d, -1)
  }
  return n
}

function bestRun(days: Set<string>): number {
  const sorted = [...days].sort()
  let best = 0
  let cur = 0
  let prev = ''
  for (const d of sorted) {
    cur = prev && daysBetween(prev, d) === 1 ? cur + 1 : 1
    best = Math.max(best, cur)
    prev = d
  }
  return best
}

/**
 * Everything the stats show for a range. With "tag", a session with two tags
 * counts under both (the slices may add up to more than the total; the total
 * itself never double counts).
 */
export function studyStats(all: StudySession[], store: Pick<StudyStore, 'blocks' | 'categories'>, range: DayRange, by: GroupBy, today: string, maxSlices = 6): StudyStats {
  const blocks = new Map(store.blocks.map((b) => [b.id, b]))
  const inRange = all.filter((s) => s.day >= range.from && s.day <= range.to)
  const before = rangeBefore(range)
  const totalMin = inRange.reduce((t, s) => t + s.minutes, 0)
  const breakMin = inRange.reduce((t, s) => t + s.breakMin, 0)

  const groups = new Map<string, Slice>()
  for (const s of inRange)
    for (const k of keysOf(s, by, blocks)) {
      const g = groups.get(k.key) ?? { key: k.key, label: k.label, minutes: 0, color: '' }
      g.minutes += s.minutes
      groups.set(k.key, g)
    }
  const sorted = [...groups.values()].filter((g) => g.minutes > 0).sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label))
  const colorFor = (g: Slice, i: number) => (by === 'category' ? (g.key === NO_BLOCK_KEY ? NO_BLOCK_COLOR : categoryColor(store, g.key === 'c:' ? '' : g.label)) : PALETTE[i % PALETTE.length])
  let slices = sorted.map((g, i) => ({ ...g, color: colorFor(g, i) }))
  if (slices.length > maxSlices) {
    const rest = slices.slice(maxSlices - 1)
    slices = [...slices.slice(0, maxSlices - 1), { key: 'other', label: 'Other', minutes: rest.reduce((t, g) => t + g.minutes, 0), color: PALETTE[7] }]
  }

  const len = daysBetween(range.from, range.to) + 1
  const perDay = new Map<string, number>()
  for (const s of inRange) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.minutes)
  const byDay = Array.from({ length: len }, (_, i) => {
    const day = addDays(range.from, i)
    return { day, minutes: perDay.get(day) ?? 0 }
  })

  const top = new Map<string, { key: string; label: string; minutes: number; sessions: number; plannedMin: number | null }>()
  let plannedMin = 0
  let actualMin = 0
  for (const s of inRange) {
    const k = keysOf(s, 'block', blocks)[0]
    const b = s.blockId ? blocks.get(s.blockId) : undefined
    const t = top.get(k.key) ?? { key: k.key, label: k.label, minutes: 0, sessions: 0, plannedMin: b?.plannedMin ?? null }
    t.minutes += s.minutes
    t.sessions += 1
    top.set(k.key, t)
    if (b?.plannedMin) {
      plannedMin += b.plannedMin
      actualMin += s.minutes
    }
  }

  const studyDays = new Set(all.filter((s) => s.minutes > 0 && s.day <= today).map((s) => s.day))
  const best = byDay.reduce<{ day: string; minutes: number } | null>((m, d) => (d.minutes > 0 && (!m || d.minutes > m.minutes) ? d : m), null)
  return {
    range,
    totalMin,
    breakMin,
    sessions: inRange.length,
    avgSessionMin: inRange.length ? Math.round(totalMin / inRange.length) : 0,
    slices,
    byDay,
    topBlocks: [...top.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 5),
    plan: { plannedMin, actualMin, pct: plannedMin ? Math.round((actualMin / plannedMin) * 100) : null },
    streak: streakOf(studyDays, today),
    bestStreak: bestRun(studyDays),
    bestDay: best,
    beforeMin: all.filter((s) => s.day >= before.from && s.day <= before.to).reduce((t, s) => t + s.minutes, 0)
  }
}

/** Minutes per block id over some sessions (the totals next to each block). */
export function minutesByBlock(sessions: StudySession[], from: string, to: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) if (s.blockId && s.day >= from && s.day <= to) m.set(s.blockId, (m.get(s.blockId) ?? 0) + s.minutes)
  return m
}

/**
 * Minutes per category and per tag, for the filter chips. Sessions with no
 * block count under the category '~none' ("No block") and the tag '' ("No
 * tag"), so the categories always add up to the total.
 */
export function totalsByGroup(sessions: StudySession[], store: Pick<StudyStore, 'blocks'>): { category: Map<string, number>; tag: Map<string, number>; total: number } {
  const blocks = new Map(store.blocks.map((b) => [b.id, b]))
  const category = new Map<string, number>()
  const tag = new Map<string, number>()
  let total = 0
  for (const s of sessions) {
    total += s.minutes
    const b = s.blockId ? blocks.get(s.blockId) : undefined
    const c = b ? b.category.toLowerCase() : '~none'
    category.set(c, (category.get(c) ?? 0) + s.minutes)
    for (const t of b?.tags.length ? b.tags : ['']) tag.set(t, (tag.get(t) ?? 0) + s.minutes)
  }
  return { category, tag, total }
}

/** "1h 05m", "45m", "0m". */
export const hmText = (min: number) => {
  const m = Math.max(0, Math.round(min))
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** "1:02:05" or "12:05" from milliseconds (the big live clock). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** A manual session: checks what you typed (minutes 1–600, break 0–300, a day in the last 14 days, not in the future). */
export function checkManual(o: { minutes: number; breakMin?: number; day: string }, today: string): string | null {
  if (!isDay(o.day)) return 'Pick the day'
  if (o.day > today) return 'That day has not come yet'
  if (daysBetween(o.day, today) > 14) return 'At most 14 days back'
  const m = Math.round(Number(o.minutes))
  if (!(m >= 1 && m <= 600)) return 'Minutes from 1 to 600'
  const b = Math.round(Number(o.breakMin ?? 0))
  if (!(b >= 0 && b <= 300)) return 'Break minutes from 0 to 300'
  return null
}

// ---------------------------------------------------------------- the session notes (setting study_log)

/** What a focus session adds for Study Time, keyed by its start time (each session has its own). */
export interface StudyNote {
  b?: string | null
  /** Break minutes. */
  k?: number
  s?: StudySession['source']
  /** "What did you do?" */
  n?: string
  /** Plain pause minutes. */
  q?: number
  /** Pomodoros finished. */
  p?: number
}
export const NOTE_MAX = 140
export type StudyLog = Record<string, StudyNote>
export const LOG_MAX = 3000
export const LOG_DAYS = 400

export function cleanLog(v: unknown): StudyLog {
  const out: StudyLog = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!x || typeof x !== 'object' || !Number.isFinite(Date.parse(k))) continue
    const n = x as StudyNote
    out[k] = {
      ...(typeof n.b === 'string' && n.b ? { b: n.b.slice(0, 40) } : {}),
      ...(Number(n.k) > 0 ? { k: Math.min(600, Math.round(Number(n.k))) } : {}),
      ...(n.s === 'manual' || n.s === 'fixed' ? { s: n.s } : {}),
      ...(typeof n.n === 'string' && n.n.trim() ? { n: str(n.n, NOTE_MAX) } : {}),
      ...(Number(n.q) > 0 ? { q: Math.min(600, Math.round(Number(n.q))) } : {}),
      ...(Number(n.p) > 0 ? { p: Math.min(40, Math.round(Number(n.p))) } : {})
    }
  }
  return out
}

/** Adds or replaces one note; drops notes older than LOG_DAYS and the oldest past LOG_MAX. */
export function putNote(log: StudyLog, startedAt: string, note: StudyNote | null, now: number): StudyLog {
  const next: StudyLog = { ...log }
  if (note) next[startedAt] = note
  else delete next[startedAt]
  const cut = now - LOG_DAYS * 86_400_000
  const keys = Object.keys(next)
    .filter((k) => Date.parse(k) >= cut)
    .sort()
  const keep = keys.slice(Math.max(0, keys.length - LOG_MAX))
  return Object.fromEntries(keep.map((k) => [k, next[k]]))
}

/** A focus session row plus its note: what the page and the stats read. */
export function withNote(row: { id: number; day: string; subject: string; minutes: number; startedAt: string; endedAt: string }, n: StudyNote | undefined): StudySession {
  return { ...row, blockId: n?.b ?? null, breakMin: n?.k ?? 0, source: n?.s ?? 'timer', ...(n?.n ? { note: n.n } : {}), ...(n?.q ? { pauseMin: n.q } : {}), ...(n?.p ? { pomos: n.p } : {}) }
}

// ---------------------------------------------------------------- changes from the page

/** A Todoist task as Study Time pulls it (only what a block needs). */
export interface TodoLite {
  id: string
  content: string
  due: string | null
  project: string | null
  section?: string | null
  labels?: string[]
  duration?: number | null
  recurring?: boolean
}

/** One change to the blocks, applied inside the save (two devices never undo each other's whole list). */
export type StudyBlockOp =
  | { op: 'save'; block: Partial<StudyBlock> & { id: string; name: string } }
  | { op: 'remove'; id: string }
  | { op: 'done'; id: string; done: boolean }
  | { op: 'color'; category: string; color: string; emoji?: string }
  | { op: 'starter' }
  /** Drag to reorder: the ids as they now stand (they take the places those blocks had). */
  | { op: 'reorder'; ids: string[] }
  | { op: 'prefs'; prefs: Partial<StudyPrefs> }
  /** A weekly goal for a subject (minutes; null removes it). */
  | { op: 'goal'; category: string; minutes: number | null }
  /** Your study tasks from Todoist become blocks (studyPlan.ts todoistBlocks; applied by the service). */
  | { op: 'todoist'; tasks: TodoLite[] }

/** The next day a repeating block is due, after `today` (weekly keeps its weekday). */
export function nextDue(from: string | null, repeat: Repeat, today: string): string {
  const base = from && from > today ? from : today
  if (repeat === 'daily') return addDays(base, 1)
  if (repeat === 'weekdays') {
    let d = addDays(base, 1)
    while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1)
    return d
  }
  let d = from ?? today
  do d = addDays(d, 7)
  while (d <= today)
  return d
}

/** The listed ids take the places those blocks had, in the new order; every other block stays where it was. */
export function reorderBlocks(blocks: StudyBlock[], ids: string[]): StudyBlock[] {
  const want = ids.filter((id, i) => ids.indexOf(id) === i && blocks.some((b) => b.id === id))
  const set = new Set(want)
  const slots = blocks.map((b, i) => (set.has(b.id) ? i : -1)).filter((i) => i >= 0)
  const out = [...blocks]
  slots.forEach((slot, k) => (out[slot] = blocks.find((b) => b.id === want[k])!))
  return out
}

export function applyStudyOp(store: StudyStore, o: StudyBlockOp, now: Date, today = localDay(now)): StudyStore {
  switch (o.op) {
    case 'save':
      return saveBlock(store, o.block, now)
    case 'remove':
      return removeBlock(store, o.id)
    case 'done':
      return {
        ...store,
        blocks: store.blocks.map((b) => {
          if (b.id !== o.id) return b
          // A repeating block moves on to its next day instead of staying done.
          if (o.done && b.repeat && !b.fromTodoist) return { ...b, done: false, lastDone: today, due: nextDue(b.due, b.repeat, today) }
          return { ...b, done: !!o.done, ...(o.done ? { lastDone: today } : {}) }
        })
      }
    case 'color': {
      const name = String(o.category ?? '').trim().slice(0, 40)
      if (!name || !/^#[0-9a-f]{3,8}$/i.test(o.color)) return store
      const was = store.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
      const emoji = o.emoji === undefined ? (was?.emoji ?? '') : cleanEmoji(o.emoji)
      const rest = store.categories.filter((c) => c.name.toLowerCase() !== name.toLowerCase())
      return { ...store, categories: [...rest, { name: was?.name ?? name, color: o.color, ...(emoji ? { emoji } : {}) }] }
    }
    case 'starter':
      return store.blocks.length ? store : starterStore(now)
    case 'reorder':
      return { ...store, blocks: reorderBlocks(store.blocks, Array.isArray(o.ids) ? o.ids.map(String) : []) }
    case 'prefs': {
      const cur = prefsOf(store)
      return { ...store, prefs: cleanPrefs({ ...cur, ...o.prefs, todoist: { ...cur.todoist, ...(o.prefs?.todoist ?? {}) } }) }
    }
    case 'goal': {
      const name = String(o.category ?? '').trim().slice(0, 40)
      const rest = (store.goals ?? []).filter((g) => g.category.toLowerCase() !== name.toLowerCase())
      const m = Math.round(Number(o.minutes))
      return { ...store, goals: name && m >= 10 ? [...rest, { category: name, minutes: Math.min(6000, m) }] : rest }
    }
    case 'todoist':
      return store
  }
}

/** The app's day of a moment (it starts at 04:00); the service passes the wallet's own. */
export const localDay = (d: Date): string => dayKey(d)

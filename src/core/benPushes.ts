// Ben 2: the pushes. Ben writes first at the moments that matter, on the one
// channel where you'll see it, once:
// - check-ins: a planned block starts → "Lab 4 starts now, ready?" with
//   Start / 10 min later / Skip, and one firmer word 10 minutes later if it
//   still hasn't started (then he stops);
// - drift: the PC coach's "25 min of video during English essay" goes to
//   Telegram when the island wouldn't show it (core/pcCoach.ts finds it);
// - the morning brief at your wake time: the must-dos, the first block, the
//   water goal, and one tap for "Plan my day" (not on days off);
// - the evening shutdown ~30 min before bed: what got done, what's open (each
//   Tomorrow / Drop / Keep today), and bed (the same items as Today's Shut down);
// - the weekly accountability card: a score, 3 wins, 1 thing to fix, and next
//   week's top 3 to accept (from the week score and the weekly top 3).
// Each kind of nudge belongs to an area (study, work, body, sleep, chores,
// money) and follows that area's push level (Soft / Normal / Hard): how often,
// how firm, which words. One dedupe key per push, shared by the island and
// Telegram (synced setting `ben_pushes`), so nothing comes twice. The island
// is used while you're at the PC; Telegram when the PC is idle, locked or off.
// Pure and tested (benPushes.test.ts): no clock of its own, no DOM, no timers.
import type { PushLevel } from './lifeFit'
import type { IslandAlert } from './islandModel'

// ---- areas and their push levels ----

export type Area = 'study' | 'work' | 'body' | 'sleep' | 'chores' | 'money'
export type AreaLevel = 'soft' | 'normal' | 'hard'
export const AREAS: Area[] = ['study', 'work', 'body', 'sleep', 'chores', 'money']
export const AREA_LEVELS: AreaLevel[] = ['soft', 'normal', 'hard']
export const AREA_LABEL: Record<Area, string> = { study: 'Study', work: 'Work', body: 'Body', sleep: 'Sleep', chores: 'Chores', money: 'Money' }
export const AREA_ICON: Record<Area, string> = { study: '📚', work: '💼', body: '💪', sleep: '🌙', chores: '🧹', money: '💸' }
export const AREA_HINT: Record<Area, string> = {
  study: 'Study blocks, drifting off them, the weekly check',
  work: 'Work blocks and the work window',
  body: 'Water, move breaks, training',
  sleep: 'Wind-down, bedtime, the evening shutdown',
  chores: 'Chores and errands in your plan',
  money: 'Spending check-ins'
}
export const LEVEL_LABEL: Record<AreaLevel, string> = { soft: 'Soft', normal: 'Normal', hard: 'Hard' }
export const LEVEL_HINT: Record<AreaLevel, string> = {
  soft: 'Warm, fewer nudges, no firm follow-up',
  normal: 'Direct, one follow-up when you slip',
  hard: 'Tough love, sooner and firmer'
}

/** The old single "how hard Ben pushes" becomes every area's level (until you change one). */
export function levelFromPush(p: PushLevel | null | undefined): AreaLevel {
  return p === 'gentle' ? 'soft' : p === 'firm' ? 'normal' : 'hard'
}
/** And back: the tone the older rules (pcCoach, healthyDay) understand. */
export function pushFromLevel(l: AreaLevel): PushLevel {
  return l === 'soft' ? 'gentle' : l === 'normal' ? 'firm' : 'push'
}

export type AreaLevels = Record<Area, AreaLevel>
const isLevel = (x: unknown): x is AreaLevel => x === 'soft' || x === 'normal' || x === 'hard'
/** Saved levels, checked; a missing area takes the old single push level. */
export function cleanAreas(raw: unknown, push: PushLevel | null | undefined): AreaLevels {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = levelFromPush(push)
  return Object.fromEntries(AREAS.map((a) => [a, isLevel(o[a]) ? o[a] : d])) as AreaLevels
}

/** Every kind of nudge Ben sends, and the area it belongs to. */
export type NudgeType = 'checkin' | 'drift' | 'brief' | 'shutdown' | 'weekly' | 'water' | 'move' | 'eyes' | 'training' | 'winddown' | 'bed' | 'money' | 'chores' | 'work'
const TYPE_AREA: Record<Exclude<NudgeType, 'checkin' | 'drift'>, Area> = {
  brief: 'study',
  weekly: 'study',
  shutdown: 'sleep',
  winddown: 'sleep',
  bed: 'sleep',
  water: 'body',
  move: 'body',
  eyes: 'body',
  training: 'body',
  money: 'money',
  chores: 'chores',
  work: 'work'
}

const WORDS: [Area, RegExp][] = [
  ['work', /\b(work|shift|job|office|client|standup|stand-up|invoice report)\b/i],
  ['body', /\b(gym|workout|training|train|run|running|walk|stretch|yoga|swim|push-?ups|sport)\b/i],
  ['sleep', /\b(sleep|bed|nap|wind[- ]?down)\b/i],
  ['chores', /\b(clean|cleaning|laundry|groceries|grocery|shopping|cook|cooking|dishes|tidy|chores?|errands?|vacuum|declutter)\b/i],
  ['money', /\b(budget|money|bank|bills?|finance|pay|taxes|spending|expenses?)\b/i]
]
/** The area a block or task belongs to, from its name (study when nothing else fits: deep work is mostly study). */
export function areaOfTitle(title: string): Area {
  for (const [a, re] of WORDS) if (re.test(title)) return a
  return 'study'
}
/** A nudge's area: from its kind, or for a block (check-in, drift) from the block's name. */
export function areaOf(type: NudgeType, title?: string | null): Area {
  if (type === 'checkin' || type === 'drift') return areaOfTitle(title ?? '')
  return TYPE_AREA[type]
}
export const levelFor = (levels: AreaLevels, type: NudgeType, title?: string | null): AreaLevel => levels[areaOf(type, title)]

/** How a level acts: the follow-up, how soon drift is called out, how often. */
export interface AreaTuning {
  /** One firmer word when a block hasn't started (Soft only re-asks after "10 min later"). */
  firm: boolean
  /** Minutes after the ask before the follow-up. */
  firmAfterMin: number
  /** Minutes of video / games / social during a block before Ben says so. */
  driftMin: number
  /** Multiplies the gaps between nudges of this area (bigger = rarer). */
  gapScale: number
}
export function areaTuning(l: AreaLevel): AreaTuning {
  if (l === 'soft') return { firm: false, firmAfterMin: 15, driftMin: 15, gapScale: 1.5 }
  if (l === 'normal') return { firm: true, firmAfterMin: 10, driftMin: 12, gapScale: 1 }
  return { firm: true, firmAfterMin: 10, driftMin: 10, gapScale: 0.75 }
}

// ---- when (push settings, in Settings → Ben → My life) ----

export interface PushPrefs {
  checkins: boolean
  brief: boolean
  shutdown: boolean
  weekly: boolean
  /** Minutes before bedtime for the evening shutdown. */
  shutdownBefore: number
  /** Weekdays (0 = Sunday) with no morning brief (days off). */
  offDays: number[]
}
export const DEFAULT_PUSH_PREFS: PushPrefs = { checkins: true, brief: true, shutdown: true, weekly: true, shutdownBefore: 30, offDays: [] }
export function cleanPushPrefs(raw: unknown): PushPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PushPrefs>
  const d = DEFAULT_PUSH_PREFS
  const b = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def)
  const before = typeof o.shutdownBefore === 'number' && Number.isFinite(o.shutdownBefore) ? Math.max(10, Math.min(120, Math.round(o.shutdownBefore / 5) * 5)) : d.shutdownBefore
  const offDays = Array.isArray(o.offDays) ? [...new Set(o.offDays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.offDays
  return { checkins: b(o.checkins, d.checkins), brief: b(o.brief, d.brief), shutdown: b(o.shutdown, d.shutdown), weekly: b(o.weekly, d.weekly), shutdownBefore: before, offDays }
}

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
/** A day off: one of your days off, or a sick / travel day (Life mode). */
export function isOffDay(prefs: PushPrefs, day: string, mode?: string | null): boolean {
  return prefs.offDays.includes(weekdayOf(day)) || mode === 'sick' || mode === 'travel'
}

// ---- time helpers ----

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const isHm = (x: unknown): x is string => typeof x === 'string' && HM.test(x)
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const localMin = (now: number) => {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}
const hmOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
/** Minutes from now until a clock time tonight (bedtime may be after midnight): negative once it's past (until 05:00). */
export function minutesUntil(now: number, at: string): number {
  // On a night's scale (noon … noon), so 23:50 → 00:10 is 20 minutes, not -1420.
  const night = (m: number) => (m - 720 + 1440) % 1440
  return night(minOf(at)) - night(localMin(now))
}
/** Inside quiet hours ("22:00"–"07:00" wraps midnight). */
export function inQuiet(now: number, quiet: { from: string; to: string } | null | undefined): boolean {
  if (!quiet || !isHm(quiet.from) || !isHm(quiet.to) || quiet.from === quiet.to) return false
  const m = localMin(now)
  const a = minOf(quiet.from)
  const b = minOf(quiet.to)
  return a < b ? m >= a && m < b : m >= a || m < b
}

// ---- where you are: the PC or away ----

/** What the app window on the PC says about you (synced setting `ben_pc_seen`). */
export interface PcSeen {
  at: number
  /** Using the PC (mouse or keys in the last few minutes, not locked). */
  active: boolean
}
export const PC_SEEN_KEY = 'ben_pc_seen'
/** Idle this long (or locked: the idle time grows) counts as away. */
export const AWAY_IDLE_SEC = 180
/** A word from the PC older than this means it's off or asleep. */
export const PC_STALE_MS = 8 * 60_000
/** While you're at the PC the word is renewed this often (and at once when you leave or come back). */
export const PC_RENEW_MS = 5 * 60_000

export function cleanPcSeen(raw: unknown): PcSeen | null {
  const o = raw as Partial<PcSeen> | null
  return o && typeof o.at === 'number' && Number.isFinite(o.at) ? { at: o.at, active: o.active === true } : null
}
/** You're at the PC now (as the server sees it). */
export const pcHere = (p: PcSeen | null, now: number) => !!p && p.active && now - p.at < PC_STALE_MS
/** At the PC by the app window's own idle time. */
export const atPc = (idleSec: number | null, locked = false) => !locked && idleSec != null && idleSec < AWAY_IDLE_SEC
/** What the app window writes now (null: nothing new to say): only when it changes, or every few minutes while you're here. */
export function pcSeenNext(prev: PcSeen | null, active: boolean, now: number): PcSeen | null {
  if (!prev || prev.active !== active) return { at: now, active }
  if (active && now - prev.at >= PC_RENEW_MS) return { at: now, active }
  return null
}

export type Channel = 'island' | 'telegram'
/** The one channel: the island while you're at the PC, Telegram otherwise. */
export const channelFor = (here: boolean): Channel => (here ? 'island' : 'telegram')

// ---- the shared log: one key per push, across the island and Telegram ----

export type PushOp = 'start' | 'later' | 'skip' | 'plan' | 'ok' | 'shutdown' | 'tomorrow' | 'drop' | 'keep' | 'back' | 'more5'
export type ItemMark = 'tomorrow' | 'drop' | 'keep'
export interface PushRec {
  at: number
  via: Channel
  /** Your answer (start, later, skip…), if any. */
  ans?: PushOp
  /** "10 min later": asked again at this time. */
  until?: number
}
export interface ShutdownItem {
  /** "m:<text>" for a must-do, "t:<id>" for a Todoist task. */
  id: string
  text: string
  kind: 'mustdo' | 'todo'
  ref?: string
}
/** A push the island wants on Telegram (you're away from it), sent by the server's tick. */
export interface OutItem {
  key: string
  text: string
  at: number
  buttons?: PushButton[]
}
export interface PushLog {
  /** The app day these are for (a new day starts empty, keeping only what's still open). */
  day: string
  recs: Record<string, PushRec>
  /** Tonight's shutdown list, and what you chose for each (the same marks on Telegram, the island and Today). */
  shutdown?: { day: string; items: ShutdownItem[]; marks: Record<string, ItemMark> }
  outbox: OutItem[]
}
export const PUSH_LOG_KEY = 'ben_pushes'

const OPS: PushOp[] = ['start', 'later', 'skip', 'plan', 'ok', 'shutdown', 'tomorrow', 'drop', 'keep', 'back', 'more5']
const MARKS: ItemMark[] = ['tomorrow', 'drop', 'keep']
export function cleanPushLog(raw: unknown, day: string): PushLog {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PushLog>
  const recs: Record<string, PushRec> = {}
  if (o.day === day && o.recs && typeof o.recs === 'object')
    for (const [k, v] of Object.entries(o.recs).slice(-120)) {
      if (!v || typeof v !== 'object' || typeof (v as PushRec).at !== 'number') continue
      const r = v as PushRec
      recs[k] = { at: r.at, via: r.via === 'telegram' ? 'telegram' : 'island', ...(OPS.includes(r.ans as PushOp) ? { ans: r.ans } : {}), ...(typeof r.until === 'number' ? { until: r.until } : {}) }
    }
  const sd = o.shutdown
  const shutdown =
    sd && sd.day === day && Array.isArray(sd.items)
      ? {
          day,
          items: sd.items.filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string').slice(0, 8).map((x) => ({ id: x.id, text: x.text.slice(0, 140), kind: x.kind === 'todo' ? ('todo' as const) : ('mustdo' as const), ...(typeof x.ref === 'string' ? { ref: x.ref } : {}) })),
          marks: Object.fromEntries(Object.entries(sd.marks ?? {}).filter(([, m]) => MARKS.includes(m as ItemMark))) as Record<string, ItemMark>
        }
      : undefined
  // The outbox keeps 15 minutes (a drift word after that is old news).
  const outbox = Array.isArray(o.outbox) ? o.outbox.filter((x) => x && typeof x.key === 'string' && typeof x.text === 'string' && typeof x.at === 'number').slice(-10) : []
  return { day, recs, ...(shutdown ? { shutdown } : {}), outbox }
}

export const claimed = (log: PushLog, key: string): PushRec | null => log.recs[key] ?? null
/** Marks a push as shown; false when it already went out (anywhere). */
export function claim(log: PushLog, key: string, via: Channel, now: number): { ok: boolean; log: PushLog } {
  if (log.recs[key]) return { ok: false, log }
  return { ok: true, log: { ...log, recs: { ...log.recs, [key]: { at: now, via } } } }
}
/** Your answer on a push (from any channel). "later" asks again after `minutes`. */
export function answerPush(log: PushLog, key: string, op: PushOp, now: number, minutes = 10): PushLog {
  const cur = log.recs[key] ?? { at: now, via: 'island' as Channel }
  return { ...log, recs: { ...log.recs, [key]: { ...cur, ans: op, ...(op === 'later' ? { until: now + Math.max(5, Math.min(60, minutes)) * 60_000 } : {}) } } }
}
export const outboxAdd = (log: PushLog, item: OutItem): PushLog => (log.outbox.some((x) => x.key === item.key) || log.recs[item.key] ? log : { ...log, outbox: [...log.outbox, item].slice(-10) })
/** What the server sends from the outbox now (fresh, not yet sent), and the outbox left. */
export function outboxTake(log: PushLog, now: number): { send: OutItem[]; log: PushLog } {
  const fresh = log.outbox.filter((x) => now - x.at < 15 * 60_000 && !log.recs[x.key])
  return { send: fresh, log: { ...log, outbox: [] } }
}

// ---- the card a push makes (the island, the Coach page, Telegram) ----

export interface PushButton {
  label: string
  op: PushOp
  primary?: boolean
  /** The block's name (Start), or the shutdown item's id. */
  arg?: string
  minutes?: number
}
export type PushType = 'checkin' | 'brief' | 'shutdown' | 'weekly' | 'drift'
export interface PushOut {
  key: string
  type: PushType
  area: Area
  level: AreaLevel
  title: string
  /** Plain text (several lines for the brief and the shutdown). */
  text: string
  face: string
  buttons: PushButton[]
  channel: Channel
  /** The shutdown's open items (each Tomorrow / Drop / Keep today). */
  items?: ShutdownItem[]
}

// ---- PR1: check-ins when a planned block starts ----

export interface CheckinBlock {
  id: string
  title: string
  start: number
  end: number
  /** A focus block (the timer flow). Events you go to (a class, a meeting) get no check-in. */
  focus: boolean
}
export interface CheckinInput {
  now: number
  on: boolean
  blocks: CheckinBlock[]
  /** A focus timer is running (any subject: you started something). */
  running: boolean
  /** In a call or a meeting now. */
  meeting: boolean
  /** Quiet hours, a paused day, or bed logged. */
  quiet: boolean
  levels: AreaLevels
  log: PushLog
  /** You're at the PC (island) or away (Telegram). */
  here: boolean
}
export const checkinKey = (id: string, firm = false) => `${firm ? 'checkin-firm' : 'checkin'}:${id}`

const ASK: Record<AreaLevel, string[]> = {
  soft: ['{title} starts now. Ready when you are?', '{title} is up next, now. Shall we?'],
  normal: ['{title} starts now, ready?', 'Time for {title}. Ready?'],
  hard: ['{title} starts now. Ready? Let’s go 💪', '{title}, now. Timer on and go 💪']
}
const FIRM: Record<AreaLevel, string[]> = {
  soft: ['{title}: ready now?'],
  normal: ['{title} started {m} min ago and the timer isn’t on. Start now?', '{m} min into {title}. Start it now?'],
  hard: ['{m} min into {title} and nothing started 😤 Start it now.', '{title} began {m} min ago. No more waiting: start 😤']
}
const pick = (lines: string[], seed: number) => lines[Math.abs(Math.floor(seed)) % lines.length]
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))
const left = (b: CheckinBlock, now: number) => Math.max(5, Math.min(180, Math.round((b.end - now) / 60_000)))

/**
 * The check-in now for the block that just started, or null: the ask at the
 * start, one follow-up 10 minutes later (Soft: only after "10 min later"),
 * then nothing. Never in a meeting, quiet hours, while a timer runs, or for
 * an event you go to. The caller sends it only on its own channel.
 */
export function decideCheckin(i: CheckinInput): PushOut | null {
  if (!i.on || i.meeting || i.quiet || i.running) return null
  const b = i.blocks
    .filter((x) => x.focus && x.start <= i.now && x.end - i.now >= 10 * 60_000 && i.now - x.start < 40 * 60_000)
    .sort((x, y) => y.start - x.start)[0]
  if (!b) return null
  const level = levelFor(i.levels, 'checkin', b.title)
  const area = areaOfTitle(b.title)
  const t = areaTuning(level)
  const ask = i.log.recs[checkinKey(b.id)]
  const channel = channelFor(i.here)
  const seed = Math.floor(b.start / 60_000)
  const startBtn: PushButton = { label: `▶ Start · ${left(b, i.now)} min`, op: 'start', primary: true, arg: b.title, minutes: left(b, i.now) }
  if (!ask) {
    // Asked in the first 15 minutes only (a block found later is the follow-up's job, or gone).
    if (i.now - b.start > 15 * 60_000) return null
    return { key: checkinKey(b.id), type: 'checkin', area, level, title: `${b.title} · ${hmOf(b.start)}`, text: fill(pick(ASK[level], seed), { title: b.title }), face: level === 'hard' ? '😤' : '🎯', channel, buttons: [startBtn, { label: '⏰ 10 min later', op: 'later', minutes: 10 }, { label: 'Skip', op: 'skip' }] }
  }
  if (ask.ans === 'skip' || ask.ans === 'start') return null
  if (i.log.recs[checkinKey(b.id, true)]) return null
  const snoozed = ask.ans === 'later'
  if (!t.firm && !snoozed) return null
  const due = snoozed ? ask.until ?? ask.at + 10 * 60_000 : ask.at + t.firmAfterMin * 60_000
  if (i.now < due) return null
  const m = Math.max(1, Math.round((i.now - b.start) / 60_000))
  const words = snoozed && !t.firm ? fill(pick(FIRM.soft, seed), { title: b.title }) : fill(pick(FIRM[level === 'soft' ? 'normal' : level], seed), { title: b.title, m })
  return { key: checkinKey(b.id, true), type: 'checkin', area, level, title: `${b.title} · not started`, text: words, face: level === 'hard' ? '😠' : '⏰', channel, buttons: [startBtn, { label: 'Skip it today', op: 'skip' }] }
}

// ---- PR2: drift to Telegram when the island wouldn't show it ----

/**
 * The PC coach found drift during a block (its card names the block). The
 * island shows it when it can; when you're away from it (the island hidden,
 * or it would only wait as a dot), it goes to Telegram once, by the same key.
 */
export function driftToTelegram(o: { alertId: string; title: string; text: string; islandShows: boolean; log: PushLog; now: number }): OutItem | null {
  if (o.islandShows) return null
  const key = `drift:${o.alertId}`
  if (o.log.recs[key] || o.log.outbox.some((x) => x.key === key)) return null
  return { key, text: `👀 ${o.text}`, at: o.now }
}

// ---- PR3: the morning brief ----

export interface BriefInput {
  now: number
  day: string
  /** Your wake time (Settings → Ben → My life, or the weekend target). */
  wake: string
  prefs: PushPrefs
  off: boolean
  mustDos: string[]
  firstBlock: { title: string; start: number } | null
  waterTargetMl: number
  levels: AreaLevels
  log: PushLog
  here: boolean
  quiet?: boolean
}
export const briefKey = (day: string) => `brief:${day}`
const litres = (ml: number) => `${(Math.round(ml / 100) / 10).toFixed(1)} L`

/** The 3 lines: the must-dos, the first block, the water goal. */
export function briefLines(o: Pick<BriefInput, 'mustDos' | 'firstBlock' | 'waterTargetMl'>): string[] {
  const md = o.mustDos.filter(Boolean).slice(0, 3)
  return [
    md.length ? `✅ Must-dos: ${md.join(' · ')}` : '✅ No must-dos yet: tap Plan my day',
    o.firstBlock ? `▶ First block: ${o.firstBlock.title} at ${hmOf(o.firstBlock.start)}` : '▶ No blocks planned yet',
    `💧 Water goal: ${litres(o.waterTargetMl || 2000)} today`
  ]
}

/** Due from your wake time for 2 hours, once a day, not on a day off. */
export function decideBrief(i: BriefInput): PushOut | null {
  if (!i.prefs.brief || i.off || i.quiet || !isHm(i.wake)) return null
  const m = localMin(i.now)
  const w = minOf(i.wake)
  if (m < w || m >= w + 120) return null
  if (i.log.recs[briefKey(i.day)]) return null
  const level = levelFor(i.levels, 'brief')
  return {
    key: briefKey(i.day),
    type: 'brief',
    area: 'study',
    level,
    title: level === 'soft' ? 'Good morning ☀️' : level === 'normal' ? 'Morning. Here’s today' : 'Up. Here’s the day 💪',
    text: briefLines(i).join('\n'),
    face: '☀️',
    channel: channelFor(i.here),
    buttons: [{ label: '🗓 Plan my day', op: 'plan', primary: true }, { label: '👍 Got it', op: 'ok' }]
  }
}

// ---- PR4: the evening shutdown ----

export interface ShutdownInput {
  now: number
  day: string
  bed: string
  prefs: PushPrefs
  /** You closed the day already (Today's Shut down, or the evening review). */
  closed: boolean
  bedLogged: boolean
  done: string[]
  open: ShutdownItem[]
  levels: AreaLevels
  log: PushLog
  here: boolean
}
export const shutdownKey = (day: string) => `shutdown:${day}`

export function shutdownText(o: { bed: string; minutes: number; done: string[]; open: ShutdownItem[]; level: AreaLevel }): string {
  const d = o.done.filter(Boolean)
  const lines = [d.length ? `✅ Done today: ${d.slice(0, 4).join(', ')}${d.length > 4 ? ` +${d.length - 4} more` : ''}` : '✅ Nothing ticked off today. Tomorrow starts with the first one.']
  if (o.open.length) {
    lines.push('Still open (each: Tomorrow / Drop / Keep today):')
    o.open.slice(0, 6).forEach((x, k) => lines.push(`${k + 1}. ${x.text}`))
  } else lines.push('Nothing left open 👌')
  const bed = o.level === 'soft' ? `🌙 Bed at ${o.bed}. Start winding down.` : o.level === 'normal' ? `🌙 Bed at ${o.bed} (in ${o.minutes} min): screens off soon.` : `🌙 Bed at ${o.bed}, in ${o.minutes} min. Save, close, screens off.`
  lines.push(bed)
  return lines.join('\n')
}

/** Due from `shutdownBefore` minutes before bed until bedtime, once, unless the day is closed or bed is logged. */
export function decideShutdown(i: ShutdownInput): PushOut | null {
  if (!i.prefs.shutdown || i.closed || i.bedLogged || !isHm(i.bed)) return null
  const until = minutesUntil(i.now, i.bed)
  if (until > i.prefs.shutdownBefore || until <= 0) return null
  if (i.log.recs[shutdownKey(i.day)]) return null
  const level = levelFor(i.levels, 'shutdown')
  const open = i.open.slice(0, 6)
  return {
    key: shutdownKey(i.day),
    type: 'shutdown',
    area: 'sleep',
    level,
    title: 'Shut down the day',
    text: shutdownText({ bed: i.bed, minutes: until, done: i.done, open, level }),
    face: '🌙',
    channel: channelFor(i.here),
    items: open,
    buttons: [{ label: '🌙 Shut down', op: 'shutdown', primary: true }, { label: 'All to tomorrow', op: 'tomorrow', arg: '*' }]
  }
}

/** Your choice for one open item (or `*`: every one not chosen yet). */
export function markItem(log: PushLog, id: string, mark: ItemMark): PushLog {
  const sd = log.shutdown
  if (!sd) return log
  const ids = id === '*' ? sd.items.filter((x) => !sd.marks[x.id]).map((x) => x.id) : sd.items.some((x) => x.id === id) ? [id] : []
  if (!ids.length) return log
  return { ...log, shutdown: { ...sd, marks: { ...sd.marks, ...Object.fromEntries(ids.map((k) => [k, mark])) } } }
}
export const MARK_WORD: Record<ItemMark, string> = { tomorrow: '➡️ Tomorrow', drop: '✗ Dropped', keep: '✓ Keep today' }

// ---- PR7: the weekly accountability card ----

export interface WeekMetric {
  label: string
  text: string
  now: number
  target?: number | null
  targetText?: string
}
export interface WeeklyCard {
  score: number
  delta: number
  wins: string[]
  fix: string
}
/** A score, the 3 best areas against their targets (wins) and the weakest one (the fix). */
export function weeklyCard(o: { score: number; prevScore: number; metrics: WeekMetric[]; win?: string; leak?: string }): WeeklyCard {
  const ranked = o.metrics.filter((m) => m.target && m.target > 0).map((m) => ({ m, k: m.now / (m.target as number) })).sort((a, b) => b.k - a.k)
  const line = (m: WeekMetric) => `${m.label}: ${m.text}${m.target ? ` of ${m.targetText ?? m.target}` : ''}`
  const wins = ranked.filter((x) => x.k > 0).slice(0, 3).map((x) => line(x.m))
  if (o.win && !wins.length) wins.push(o.win)
  const worst = ranked[ranked.length - 1]
  const fix = worst && !wins.includes(line(worst.m)) ? line(worst.m) : o.leak || 'Not enough data yet: log a full week.'
  return { score: o.score, delta: o.score - o.prevScore, wins: wins.length ? wins : ['You showed up.'], fix }
}
export function weeklyCardText(c: WeeklyCard, level: AreaLevel = 'normal'): string {
  const head = `📊 Your week: ${c.score}/100 (${c.delta >= 0 ? '+' : ''}${c.delta} vs last week)`
  const fixWord = level === 'hard' ? '🔧 Fix this, no excuses' : level === 'soft' ? '🔧 One thing to look at' : '🔧 One thing to fix'
  return [head, '', '🏆 Wins', ...c.wins.map((w) => `• ${w}`), '', `${fixWord}: ${c.fix}`].join('\n')
}

/** The weekly card for Telegram (HTML), with next week's focus and big 3 from the review under it. */
export function weeklyHtml(c: WeeklyCard, level: AreaLevel, next: { focus: string; note?: string; big3: string[] }): string {
  const e = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const [head, ...rest] = weeklyCardText(c, level).split('\n')
  return [`<b>${e(head)}</b>`, ...rest.map(e), '', `<b>Next week</b>: focus on ${e(next.focus)}${next.note ? ` (“${e(next.note)}”)` : ''}`, ...next.big3.map((b, i) => `${i + 1}. ${e(b)}`)].join('\n')
}

// ---- Telegram ----

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Callback data for a push button ("bp|<op>|<key or item>"), kept under Telegram's 64 bytes. */
export function pushCallback(op: PushOp, key: string, arg?: string): string | null {
  const code: Partial<Record<PushOp, string>> = { later: 'l', skip: 's', ok: 'o', plan: 'p', tomorrow: 't', drop: 'd', keep: 'k' }
  const c = code[op]
  if (!c) return null
  const d = `bp|${c}|${arg ?? key}`
  return d.length <= 64 ? d : null
}
export function readPushCallback(data: string): { op: PushOp; ref: string } | null {
  const m = /^bp\|([lsoptdk])\|(.+)$/.exec(data)
  if (!m) return null
  const op = ({ l: 'later', s: 'skip', o: 'ok', p: 'plan', t: 'tomorrow', d: 'drop', k: 'keep' } as const)[m[1] as 'l']
  return { op, ref: m[2] }
}

/** The Telegram message for a push: HTML text and its buttons. `startData` makes the Start button (the bot's focus callback). */
export function pushTelegram(p: PushOut, startData?: (subject: string) => string): { text: string; keyboard: { inline_keyboard: { text: string; callback_data: string }[][] } } {
  const rows: { text: string; callback_data: string }[][] = []
  const top: { text: string; callback_data: string }[] = []
  for (const b of p.buttons) {
    if (b.op === 'start' && b.arg && startData) top.push({ text: b.label, callback_data: startData(b.arg) })
    else if (b.op === 'shutdown') continue
    else if (b.op === 'tomorrow' && b.arg === '*') top.push({ text: b.label, callback_data: 'bp|t|*' })
    else {
      const cb = pushCallback(b.op, p.key, b.arg)
      if (cb) top.push({ text: b.label, callback_data: cb })
    }
  }
  if (p.items?.length)
    p.items.forEach((_x, k) =>
      rows.push([
        { text: `${k + 1}. ➡️ Tomorrow`, callback_data: `bp|t|${k}` },
        { text: '✗ Drop', callback_data: `bp|d|${k}` },
        { text: 'Keep today', callback_data: `bp|k|${k}` }
      ])
    )
  if (top.length) rows.unshift(top)
  const lines = p.text.split('\n').map(escHtml)
  return { text: [`${p.face} <b>${escHtml(p.title)}</b>`, ...lines].join('\n'), keyboard: { inline_keyboard: rows } }
}

/** What a Coach card keeps of a push (saved on Ben's log entry as `push`). */
export interface PushCard {
  type: PushType
  key: string
  title: string
  lines: string[]
  items?: ShutdownItem[]
  weekly?: WeeklyCard
}
export const toCard = (p: PushOut): PushCard => ({ type: p.type, key: p.key, title: p.title, lines: p.text.split('\n'), ...(p.items?.length ? { items: p.items } : {}) })
export function pushCardOf(raw: unknown): PushCard | null {
  const o = raw as Partial<PushCard> | null
  if (!o || typeof o !== 'object' || typeof o.key !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.lines)) return null
  if (!['checkin', 'brief', 'shutdown', 'weekly', 'drift'].includes(o.type as string)) return null
  return o as PushCard
}

/** A push as an island card (its kind picks the sound and whether it peeks in Calm). */
export function pushAlert(p: PushOut): IslandAlert {
  const id = `push:${p.key}`
  return {
    id,
    kind: p.type === 'brief' ? 'brief' : p.type === 'shutdown' ? 'shutdown' : 'checkin',
    title: p.title,
    text: p.text,
    face: p.face,
    actions: p.buttons.map((b) => ({ label: b.label, ...(b.primary ? { primary: true } : {}), action: { kind: 'benPush' as const, op: b.op, key: p.key, alertId: id, ...(b.arg ? { arg: b.arg } : {}), ...(b.minutes ? { minutes: b.minutes } : {}) } }))
  }
}

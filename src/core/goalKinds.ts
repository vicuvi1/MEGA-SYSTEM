// Kinds of goals (pure). A goal is one of:
//   target  – a number by a date ("save 3,000 lei by 31 Mar"), the original kind
//   habit   – days a week or month ("work out 4×/week", "in bed by 00:00 5 nights a week")
//   limit   – do less ("at most 5h of gaming a week")
//   repeat  – the same amount every period ("save 2,000 lei every month")
//   project – steps with weights ("Security+: learn domains 1–5, 3 practice exams, book it")
// The extras (steps, look, the why picture, a reward, paused, pinned) live in
// GoalMeta next to the goal. This file is the maths for them: weeks and
// months, streaks, the best week, the pace line in days, today's one step, the
// milestones worth a celebration, and starter goals from the data you have.
// No database, no clock: today comes in.
import { addDays, daysBetween } from './dates'
import {
  expectedAt,
  fmtDelta,
  fmtValue,
  goalCard,
  progressOf,
  shortDay,
  type CheckIn,
  type GoalCard,
  type GoalSource,
  type GoalStatus,
  type MeasureGoal,
  type SourceKind
} from './goals'

export type GoalType = 'target' | 'habit' | 'limit' | 'repeat' | 'project'
export type Per = 'week' | 'month'

export const GOAL_TYPES: { id: GoalType; icon: string; label: string; hint: string }[] = [
  { id: 'target', icon: '🎯', label: 'A number by a date', hint: 'Save 3,000 lei by March, 100 GitHub stars' },
  { id: 'habit', icon: '🔁', label: 'A habit', hint: 'Work out 4× a week, in bed by 00:00 5 nights a week' },
  { id: 'limit', icon: '🛑', label: 'Do less', hint: 'At most 5h of gaming a week' },
  { id: 'repeat', icon: '📅', label: 'Every month', hint: 'Save 2,000 lei every month' },
  { id: 'project', icon: '🧩', label: 'Steps to finish', hint: 'Security+: domains, practice exams, book it' }
]
export const isPeriodType = (t: GoalType | undefined) => t === 'habit' || t === 'limit' || t === 'repeat'

/** Which data can measure which kind of goal ('manual': you log it). */
export const SOURCES_FOR: Record<GoalType, SourceKind[]> = {
  target: ['manual', 'money.saved', 'money.profit', 'money.income', 'body.weight', 'body.workouts', 'sport.reps', 'focus.hours', 'pc.work', 'tasks.done', 'habit.clean'],
  habit: ['manual', 'body.workouts', 'sport.reps', 'sleep.bed', 'water', 'focus.hours', 'pc.work', 'tasks.done'],
  limit: ['manual', 'pc.kind', 'money.spent', 'pc.work'],
  repeat: ['manual', 'money.saved', 'money.income', 'focus.hours', 'body.workouts', 'sport.reps', 'tasks.done', 'pc.work'],
  project: ['manual']
}

export interface GoalStep {
  id: string
  text: string
  /** How big it is next to the others (1–10). */
  weight: number
  /** The day you ticked it, or null. */
  done: string | null
}

export interface RewardLink {
  id: number
  title: string
  emoji?: string | null
  price?: number | null
}

export const COLORS = ['lime', 'cyan', 'violet', 'amber', 'rose', 'blue'] as const
export type GoalColor = (typeof COLORS)[number]
/** Covers are drawn in CSS (no pictures from the internet); 'photo' is a small picture you picked, kept on this device's copy. */
export const COVERS = ['aurora', 'sunrise', 'ocean', 'forest', 'night', 'ember'] as const
export type GoalCover = (typeof COVERS)[number] | 'photo'

export interface GoalMeta {
  type: GoalType
  per: Per
  /** Habits from data: what makes a day count (2,000 ml of water, 0.5 h of focus). */
  dayMin: number
  steps: GoalStep[]
  emoji: string
  color: GoalColor
  cover: GoalCover
  /** A small picture you picked (data URL, made smaller on this device). */
  photo: string | null
  /** "Future you": the picture in words. */
  vision: string
  reward: RewardLink | null
  paused: boolean
  pinned: boolean
  /** Your own order (lower first); null: the default order. */
  order: number | null
}

export const defaultMeta = (type: GoalType = 'target'): GoalMeta => ({
  type,
  per: type === 'repeat' ? 'month' : 'week',
  dayMin: 1,
  steps: [],
  emoji: '',
  color: 'lime',
  cover: 'aurora',
  photo: null,
  vision: '',
  reward: null,
  paused: false,
  pinned: false,
  order: null
})

const TYPES = GOAL_TYPES.map((t) => t.id)
const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

/** Meta from storage (anything missing or broken falls back; a goal from before kinds is a 'target'). */
export function cleanMeta(raw: unknown): GoalMeta {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const type: GoalType = TYPES.includes(r.type) ? r.type : 'target'
  const base = defaultMeta(type)
  const steps: GoalStep[] = Array.isArray(r.steps)
    ? r.steps
        .filter((s: any) => s && str(s.text, 80))
        .slice(0, 40)
        .map((s: any, i: number) => ({ id: str(s.id, 24) || `s${i + 1}`, text: str(s.text, 80), weight: Math.max(1, Math.min(10, Math.round(Number(s.weight) || 1))), done: typeof s.done === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.done) ? s.done : null }))
    : []
  const photo = typeof r.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(r.photo) && r.photo.length < 120_000 ? r.photo : null
  const rw = r.reward && typeof r.reward === 'object' && Number.isFinite(Number(r.reward.id)) && str(r.reward.title, 60) ? { id: Number(r.reward.id), title: str(r.reward.title, 60), emoji: r.reward.emoji ? str(r.reward.emoji, 8) : null, price: Number.isFinite(Number(r.reward.price)) ? Number(r.reward.price) : null } : null
  return {
    type,
    per: r.per === 'month' || r.per === 'week' ? r.per : base.per,
    dayMin: Number.isFinite(Number(r.dayMin)) && Number(r.dayMin) > 0 ? Number(r.dayMin) : 1,
    steps,
    emoji: str(r.emoji, 8),
    color: COLORS.includes(r.color) ? r.color : base.color,
    cover: COVERS.includes(r.cover) || (r.cover === 'photo' && photo) ? r.cover : base.cover,
    photo,
    vision: str(r.vision, 200),
    reward: rw,
    paused: !!r.paused,
    pinned: !!r.pinned,
    order: Number.isFinite(Number(r.order)) && r.order !== null ? Number(r.order) : null
  }
}

// ------------------------------------------------------------ steps

/** Share of a project done (0–100), by weight. */
export function stepsPct(steps: GoalStep[]): number {
  const total = steps.reduce((t, s) => t + s.weight, 0)
  if (!total) return 0
  return Math.round((steps.filter((s) => s.done).reduce((t, s) => t + s.weight, 0) / total) * 1000) / 10
}

export const nextStep = (steps: GoalStep[]): GoalStep | null => steps.find((s) => !s.done) ?? null

/**
 * Steps from words: "learn domain 1..5, 3 practice exams, book exam" →
 * Learn domain 1 … Learn domain 5, Practice exam 1 … 3, Book exam.
 * "x3" or "(3)" at the end sets a step's weight.
 */
export function stepsFromText(text: string): { text: string; weight: number }[] {
  const out: { text: string; weight: number }[] = []
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  for (let part of String(text ?? '').split(/[,;\n]|\s+(?:and|then)\s+/i)) {
    part = part.trim().replace(/\.$/, '')
    if (!part) continue
    let weight = 1
    const w = /\s*(?:\bx\s*(\d{1,2})|\((\d{1,2})\))$/i.exec(part)
    if (w) {
      weight = Math.max(1, Math.min(10, Number(w[1] ?? w[2])))
      part = part.slice(0, w.index).trim()
    }
    // "domain 1..5", "domains 1-5", "chapter 1 to 4"
    const range = /^(.*?)\s*(\d{1,2})\s*(?:\.\.|–|-|to)\s*(\d{1,2})$/i.exec(part)
    if (range && Number(range[3]) > Number(range[2]) && Number(range[3]) - Number(range[2]) < 20) {
      const word = range[1].trim().replace(/s$/i, '')
      for (let i = Number(range[2]); i <= Number(range[3]); i++) out.push({ text: cap(`${word} ${i}`.trim()), weight })
      continue
    }
    // "3 practice exams"
    const many = /^(\d{1,2})\s+(.+)$/i.exec(part)
    if (many && Number(many[1]) > 1 && Number(many[1]) <= 12) {
      const one = many[2].replace(/(ss|x|sh|ch)es$/i, '$1').replace(/([^s])s$/i, '$1')
      for (let i = 1; i <= Number(many[1]); i++) out.push({ text: cap(`${one} ${i}`), weight })
      continue
    }
    out.push({ text: cap(part).slice(0, 80), weight })
  }
  return out.slice(0, 40)
}

// ------------------------------------------------------------ weeks and months

const pad = (n: number) => String(n).padStart(2, '0')
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
const lastOfMonth = (day: string) => {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

/** The week (Monday–Sunday) or month a day is in. */
export function periodOf(per: Per, day: string): { key: string; from: string; to: string } {
  if (per === 'month') return { key: `m${day.slice(0, 7)}`, from: `${day.slice(0, 7)}-01`, to: lastOfMonth(day) }
  const from = mondayOf(day)
  return { key: `w${from}`, from, to: addDays(from, 6) }
}

const periodBefore = (per: Per, from: string) => periodOf(per, addDays(from, -1))

export const perWord = (per: Per) => (per === 'month' ? 'month' : 'week')

export interface PeriodRow {
  key: string
  from: string
  to: string
  /** "This week", "w/c 26 Oct", "Oct". */
  label: string
  value: number
  hit: boolean
}

export interface PeriodInfo {
  per: Per
  /** 'days': a habit counts days that pass `dayMin`; 'sum': limits and repeats add it all up. */
  mode: 'days' | 'sum'
  value: number
  target: number
  hit: boolean
  /** Limits: over the line. */
  over: boolean
  daysLeft: number
  todayValue: number
  todayDone: boolean
  /** The last periods, oldest first; the last one is this one. */
  history: PeriodRow[]
  /** Periods in a row that made it (this one too when it already has). */
  streak: number
  best: PeriodRow | null
  /** The days of this week (habits: the dots). */
  days: { day: string; value: number; done: boolean; future: boolean }[]
  /** At this pace, where the period ends. */
  projected: number
}

const MONTH_SHORT = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

/** Sum (or count of days that pass `dayMin`) between two days. */
function measure(daily: Record<string, number>, from: string, to: string, mode: 'days' | 'sum', dayMin: number): number {
  let n = 0
  for (const [d, v] of Object.entries(daily)) {
    if (d < from || d > to) continue
    n += mode === 'days' ? (v >= dayMin - 1e-9 ? 1 : 0) : v
  }
  return Math.round(n * 100) / 100
}

const hits = (type: GoalType, value: number, target: number) => (type === 'limit' ? value <= target + 1e-9 : value >= target - 1e-9)

/**
 * This week or month of a habit, limit or repeating goal: where you are, the
 * last periods, the streak and the best one. `daily`: day → amount.
 */
export function periodInfo(type: GoalType, per: Per, target: number, daily: Record<string, number>, startDay: string, today: string, dayMin = 1, keep = 8): PeriodInfo {
  const mode: 'days' | 'sum' = type === 'habit' ? 'days' : 'sum'
  const cur = periodOf(per, today)
  const rows: PeriodRow[] = []
  let p = cur
  for (let i = 0; i < 60; i++) {
    if (p.to < startDay) break
    const value = measure(daily, p.from > startDay ? p.from : startDay, p.to < today ? p.to : today, mode, dayMin)
    rows.unshift({ key: p.key, from: p.from, to: p.to, label: i === 0 ? `This ${perWord(per)}` : per === 'month' ? MONTH_SHORT(p.from) : `w/c ${shortDay(p.from)}`, value, hit: hits(type, value, target) })
    p = periodBefore(per, p.from)
  }
  const now = rows[rows.length - 1]
  // A limit is only "made" once its period is over; the others as soon as they get there.
  const nowHit = type === 'limit' ? false : now.hit
  let streak = nowHit ? 1 : 0
  for (let i = rows.length - 2; i >= 0; i--) {
    // the first week of a goal that started mid-week counts only when it made it
    if (rows[i].hit) streak++
    else break
  }
  const past = rows.slice(0, -1)
  const pool = type === 'limit' ? past : rows
  const best = pool.length ? pool.reduce((b, r) => (type === 'limit' ? (r.value < b.value ? r : b) : r.value > b.value ? r : b)) : null
  const len = daysBetween(cur.from, cur.to) + 1
  const daysLeft = daysBetween(today, cur.to) + 1
  const todayValue = Math.round((daily[today] ?? 0) * 100) / 100
  const passed = Math.max(1, len - daysLeft + 1)
  const projected = mode === 'days' ? Math.min(len, Math.round((now.value / passed) * len)) : Math.round((now.value / passed) * len * 10) / 10
  const days: PeriodInfo['days'] = []
  if (per === 'week') for (let i = 0; i < 7; i++) {
    const d = addDays(cur.from, i)
    const v = daily[d] ?? 0
    days.push({ day: d, value: v, done: mode === 'days' ? v >= dayMin - 1e-9 : v > 0, future: d > today })
  }
  return {
    per,
    mode,
    value: now.value,
    target,
    hit: now.hit,
    over: type === 'limit' && now.value > target + 1e-9,
    daysLeft,
    todayValue,
    todayDone: mode === 'days' ? todayValue >= dayMin - 1e-9 : todayValue > 0,
    history: rows.slice(-keep),
    streak,
    best: best && best.value > 0 ? best : type === 'limit' ? best : null,
    days,
    projected
  }
}

/** Ahead / on track / behind / at risk for this week or month (limits: under, close, over). */
export function periodStatusAt(type: GoalType, pi: PeriodInfo): GoalStatus {
  const total = Math.max(pi.daysLeft, daysInPeriod(pi))
  const before = total - pi.daysLeft // whole days before today
  if (type === 'limit') {
    if (pi.over) return 'at risk'
    const allowed = (pi.target * (before + 1)) / total
    if (pi.value > allowed + pi.target * 0.1) return 'behind'
    return pi.value <= allowed * 0.6 ? 'ahead' : 'on track'
  }
  if (pi.hit) return 'ahead'
  const need = pi.target - pi.value
  if (pi.mode === 'days' && need > pi.daysLeft) return 'at risk'
  const expected = (pi.target * before) / total
  const diff = (pi.value - expected) / (pi.target || 1)
  if (diff >= -0.05 || (pi.mode === 'days' && pi.value >= expected - 0.5)) return 'on track'
  return diff <= -0.3 ? 'at risk' : 'behind'
}

function daysInPeriod(pi: PeriodInfo): number {
  const last = pi.history[pi.history.length - 1]
  return last ? daysBetween(last.from, last.to) + 1 : 30
}

// ------------------------------------------------------------ the pace line in days

/**
 * How many days you are behind (+) or ahead (−) of the pace line: how long
 * ago the line was where you are now (or how long until it gets there).
 */
export function daysOffLine(g: MeasureGoal, value: number, today: string): number {
  if (today <= g.startDay) return 0
  const pv = progressOf(g, value)
  const pe = progressOf(g, expectedAt(g, today))
  if (Math.abs(pv - pe) < 1e-9) return 0
  const total = Math.max(1, daysBetween(g.startDay, g.deadline))
  if (pv < pe) {
    for (let k = 1; k <= total; k++) if (progressOf(g, expectedAt(g, addDays(today, -k))) <= pv + 1e-9) return k
    return daysBetween(g.startDay, today)
  }
  for (let k = 1; k <= total; k++) if (progressOf(g, expectedAt(g, addDays(today, k))) >= pv - 1e-9) return -k
  return -daysBetween(today, g.deadline)
}

/** The best calendar week so far (the biggest move toward the target), from the daily series. */
export function bestWeek(g: Pick<MeasureGoal, 'start' | 'target'>, series: { day: string; value: number }[], today: string): { from: string; gain: number } | null {
  if (series.length < 2) return null
  const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day))
  const up = g.target >= g.start
  const at = (day: string) => {
    let v = sorted[0].value
    for (const p of sorted) if (p.day <= day) v = p.value
    return v
  }
  let best: { from: string; gain: number } | null = null
  for (let mon = mondayOf(sorted[0].day); mon <= today; mon = addDays(mon, 7)) {
    const gain = (at(addDays(mon, 6)) - at(addDays(mon, -1))) * (up ? 1 : -1)
    if (gain > 0 && (!best || gain > best.gain)) best = { from: mon, gain: Math.round(gain * 100) / 100 }
  }
  return best
}

// ------------------------------------------------------------ words for a step

const nice = (n: number, unit: string) => {
  const a = Math.abs(n)
  if (unit === 'kg' || unit === 'km' || unit === 'pct') return Math.round(a * 10) / 10
  if (unit === 'hours') return Math.max(0.25, Math.round(a * 4) / 4)
  if (a >= 1000) return Math.round(a / 50) * 50
  if (a >= 100) return Math.round(a / 10) * 10
  return Math.max(1, Math.ceil(a))
}
/** "45 min", "1h30" for hours. */
export const hoursText = (h: number) => {
  const m = Math.round(h * 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`
}
const amount = (g: Pick<MeasureGoal, 'unit' | 'unitLabel' | 'source'>, n: number) => {
  if (g.unit === 'hours') return hoursText(n)
  if (g.source.kind === 'sport.reps' && g.source.arg) return `${fmtValue('count', n)} ${g.source.arg.toLowerCase()}`
  return fmtValue(g.unit, n, g.unitLabel)
}

/** What doing it today means for a habit: "Work out", "In bed by 00:00 tonight", "Drink 2,000 ml". */
export function habitVerb(g: Pick<MeasureGoal, 'title' | 'source' | 'unit' | 'unitLabel'>, dayMin: number): string {
  const s = g.source
  if (s.kind === 'body.workouts') return 'Work out'
  if (s.kind === 'sleep.bed') return `In bed by ${s.arg || '00:00'} tonight`
  if (s.kind === 'water') return `Drink ${fmtValue('ml', dayMin)}`
  if (s.kind === 'focus.hours') return `${hoursText(dayMin)} of ${s.arg || 'focus'}`
  if (s.kind === 'pc.work') return `${hoursText(dayMin)} of real work`
  if (s.kind === 'sport.reps') return `${fmtValue('count', dayMin)} ${(s.arg || 'reps').toLowerCase()}`
  if (s.kind === 'tasks.done') return dayMin > 1 ? `Close ${dayMin} tasks` : 'Close a task'
  return g.title.replace(/\s*\d+\s*(?:×|x|times?)\s*(?:a|per|\/)\s*(?:week|month)\b.*$/i, '').trim() || 'Do it'
}

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * Today's one step for a goal: what to do today to stay on the line. Shown on
 * the card, on Today's list and in Ben's prompt.
 */
export function todayStepOf(c: GoalCard): string {
  const g = c.goal
  const kind = c.kind ?? 'target'
  if (c.paused) return 'Paused'
  if (c.status === 'done') return 'Reached 🏆'
  if (c.status === 'missed') return 'The date passed: set a new one or close it'
  if (c.status === 'not started') return `Starts ${shortDay(g.startDay)}`
  const pi = c.period
  if (pi && kind === 'habit') {
    const verb = habitVerb(g, c.meta?.dayMin ?? 1)
    if (pi.todayDone) return `Done today ✓ · ${pi.value} of ${pi.target} this ${perWord(pi.per)}`
    if (pi.hit) return `${verb}: a bonus day (${pi.target} done this ${perWord(pi.per)})`
    return `${verb} today · ${pi.value} of ${pi.target} this ${perWord(pi.per)}`
  }
  if (pi && kind === 'limit') {
    const left = pi.target - pi.value
    if (pi.over) return `Over by ${amount(g, -left)}: none today`
    return `Under ${amount(g, left / Math.max(1, pi.daysLeft))} today · ${amount(g, left)} left this ${perWord(pi.per)}`
  }
  if (pi && kind === 'repeat') {
    const left = pi.target - pi.value
    if (left <= 0) return `Done this ${perWord(pi.per)} ✓`
    const per = left / Math.max(1, pi.daysLeft)
    return pi.daysLeft > 7 ? `${amount(g, nice(left / Math.ceil(pi.daysLeft / 7), g.unit))} this week · ${amount(g, left)} to go` : `${amount(g, nice(per, g.unit))} today · ${amount(g, left)} to go`
  }
  if (kind === 'project') {
    const s = nextStep(c.meta?.steps ?? [])
    return s ? `Next: ${s.text}` : 'All steps done: mark it reached'
  }
  const per = Math.abs(c.perDayNeeded)
  if (!per) return 'On the line: keep going'
  const small = (g.unit !== 'kg' && g.unit !== 'km' && g.unit !== 'pct' && g.unit !== 'hours' && per < 0.75) || nice(per, g.unit) === 0
  const sign = g.target < g.start ? '−' : '+'
  if (g.source.kind === 'body.weight') return `${sign}${fmtValue('kg', nice(per * 7, 'kg'))} this week: eat clean, move`
  return small ? `${sign}${amount(g, nice(per * 7, g.unit))} this week` : `${sign}${amount(g, nice(per, g.unit))} today`
}

/** The pace line in words: "On track", "3 days behind: 12 pushups today gets you back", "2 days ahead". */
export function paceTextOf(c: GoalCard, today: string): string {
  const g = c.goal
  const kind = c.kind ?? 'target'
  if (c.paused) return 'Paused: no nudges'
  if (c.status === 'done') return g.doneDay ? `Reached on ${shortDay(g.doneDay)}` : 'Reached'
  if (c.status === 'missed') return 'The date passed'
  if (c.status === 'not started') return `Starts ${shortDay(g.startDay)}`
  const pi = c.period
  if (pi) {
    const w = perWord(pi.per)
    if (kind === 'limit') return pi.over ? `Over the limit this ${w}` : c.status === 'behind' ? `Close to the limit: go easy` : `Under the limit · ${pi.daysLeft} ${pi.daysLeft === 1 ? 'day' : 'days'} left`
    if (pi.hit) return `Done this ${w} ✓`
    const need = pi.target - pi.value
    if (c.status === 'at risk') return pi.mode === 'days' ? `Can't reach ${pi.target} this ${w}: make every day count` : `Behind: ${amount(g, need)} to go, ${dayWord(pi.daysLeft)} left`
    if (c.status === 'behind') return pi.mode === 'days' ? `Behind: ${need} more in ${dayWord(pi.daysLeft)}` : `Behind: ${amount(g, need)} in ${dayWord(pi.daysLeft)}`
    return pi.mode === 'days' ? `On track: ${need} more in ${dayWord(pi.daysLeft)}` : `On track: ${amount(g, need)} to go`
  }
  const off = daysOffLine(g, c.value, today)
  if (off > 0 && (c.status === 'behind' || c.status === 'at risk')) {
    const gap = Math.abs(c.expected - c.value)
    if (kind === 'project') {
      const steps = c.meta?.steps ?? []
      const avg = steps.length ? 100 / steps.reduce((t, s) => t + s.weight, 0) : 10
      const n = Math.max(1, Math.round(gap / avg))
      return `${dayWord(off)} behind: ${n} step${n === 1 ? '' : 's'} gets you back`
    }
    return `${dayWord(off)} behind: ${amount(g, nice(gap, g.unit))} ${off > 7 ? 'this week' : 'today'} gets you back`
  }
  if (off < 0 && c.status === 'ahead') return `${dayWord(-off)} ahead of the line 😎`
  return 'On track'
}

// ------------------------------------------------------------ one card, any kind

/** Daily amounts from your own logs (habit, limit, repeat goals you log by hand). */
export function dailyFromCheckins(checkins: CheckIn[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of checkins) if (c.by === 'me' || c.by === 'ben') out[c.day] = Math.round(((out[c.day] ?? 0) + c.value) * 100) / 100
  for (const k of Object.keys(out)) if (out[k] < 0) out[k] = 0
  return out
}

/**
 * A goal card for any kind. `daily`: the day → amount map from the goal's
 * data source (habit, limit and repeat goals that count themselves); goals
 * you log by hand use their check-ins.
 */
export function typedCard(g: MeasureGoal, meta: GoalMeta, all: CheckIn[], today: string, daily?: Record<string, number> | null): GoalCard {
  const mine = all.filter((c) => c.goalId === g.id).sort((a, b) => a.at.localeCompare(b.at))
  const kind = meta.type
  let card: GoalCard
  if (isPeriodType(kind)) {
    const dm = daily ?? dailyFromCheckins(mine)
    const pi = periodInfo(kind, meta.per, g.target, dm, g.startDay, today, kind === 'habit' && g.source.kind === 'manual' ? 1 : meta.dayMin)
    const ended = today > g.deadline
    const status: GoalStatus = g.doneDay || ended ? 'done' : today < g.startDay ? 'not started' : periodStatusAt(kind, pi)
    const auto = g.source.kind !== 'manual'
    const answered = mine.some((c) => (c.by === 'me' || c.by === 'ben' || c.by === 'skip') && periodOf(meta.per, c.day).key === periodOf(meta.per, today).key)
    card = {
      goal: g,
      value: pi.value,
      pct: Math.round(Math.max(0, Math.min(1, g.target ? pi.value / g.target : 0)) * 100),
      expected: 0,
      expectedPct: 0,
      status,
      // "days left" here means left in this week or month (what you can still change)
      daysLeft: pi.daysLeft,
      perDayNeeded: 0,
      perDayNow: null,
      need: kind === 'limit' || pi.hit ? '' : kind === 'habit' ? `${pi.target - pi.value} more` : amount(g, pi.target - pi.value),
      eta: null,
      next: { value: g.target, label: 'Goal', index: 0 },
      milestones: [],
      streak: pi.streak,
      due: !auto && !answered && !meta.paused && status !== 'done' && today > g.startDay && pi.daysLeft <= (meta.per === 'week' ? 3 : 10),
      auto,
      series: pi.history.map((r) => ({ day: r.from, value: r.value })),
      lastAt: mine.length ? mine[mine.length - 1].at : null,
      period: pi
    }
  } else {
    let list = mine
    if (kind === 'project') {
      const pct = stepsPct(meta.steps)
      const g2 = { ...g, unit: 'pct' as const, start: 0, target: 100 }
      const last = list.filter((c) => c.by !== 'skip')
      if (meta.steps.length && (!last.length || last[last.length - 1].value !== pct)) list = [...list, { id: 'steps', goalId: g.id, at: `${today}T23:59:59.000Z`, day: today, value: pct, by: 'auto' }]
      card = goalCard(g2, list, today)
      card.auto = true
      card.due = false
    } else card = goalCard(g, list, today)
    const bw = bestWeek(card.goal, card.series, today)
    card.best = bw ? `Best week: ${fmtDelta(card.goal.unit, (card.goal.target >= card.goal.start ? 1 : -1) * bw.gain, card.goal.unitLabel)} (w/c ${shortDay(bw.from)})` : null
  }
  card.kind = kind
  card.meta = meta
  card.paused = meta.paused
  card.pinned = meta.pinned
  if (meta.paused) card.due = false
  if (card.period) {
    const b = card.period.best
    card.best = b && card.period.history.length > 1 ? `Best ${perWord(meta.per)}: ${kind === 'habit' ? `${b.value} of ${card.goal.target}` : amount(card.goal, b.value)} (${b.label})` : null
  }
  card.todayStep = todayStepOf(card)
  card.pace = paceTextOf(card, today)
  return card
}

/** The page's order: the pinned one, then your own order, then the ones needing you first. */
export function orderCards(cards: GoalCard[]): GoalCard[] {
  const rank: Record<GoalStatus, number> = { 'at risk': 0, behind: 1, 'on track': 2, ahead: 3, 'not started': 4, missed: 5, done: 6 }
  return [...cards].sort((a, b) => {
    const pa = Number(!!b.pinned) - Number(!!a.pinned)
    if (pa) return pa
    const pz = Number(!!a.paused) - Number(!!b.paused)
    if (pz) return pz
    const oa = a.meta?.order ?? null
    const ob = b.meta?.order ?? null
    if (oa != null && ob != null && oa !== ob) return oa - ob
    if (oa != null && ob == null) return -1
    if (ob != null && oa == null) return 1
    return Number(b.due) - Number(a.due) || rank[a.status] - rank[b.status] || a.goal.deadline.localeCompare(b.goal.deadline)
  })
}

/** Moves one goal up or down in your own order: the new order numbers for every goal (ids in the order shown). */
export function moveInOrder(ids: number[], id: number, dir: -1 | 1): number[] {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ------------------------------------------------------------ celebrations

export type Level = 0 | 25 | 50 | 75 | 100

/**
 * The milestone a card stands at, as a key that changes when there is
 * something new to celebrate: 25 / 50 / 75 / 100 % for targets and projects;
 * habits and repeats celebrate the week or month they make.
 */
export function milestoneKey(c: GoalCard): { level: Level; key: string } {
  if (c.period) {
    const hit = c.kind !== 'limit' && c.period.hit
    const k = c.period.history[c.period.history.length - 1]?.key ?? ''
    return { level: hit ? 100 : 0, key: hit ? `${k}:100` : `${k}:0` }
  }
  const p = c.status === 'done' ? 100 : c.pct
  const level = (p >= 100 ? 100 : p >= 75 ? 75 : p >= 50 ? 50 : p >= 25 ? 25 : 0) as Level
  return { level, key: String(level) }
}

/**
 * Which goals passed a new milestone since this device last looked (the page
 * shows one celebration at a time). A goal seen for the first time is only
 * remembered, never celebrated (it was already there).
 */
export function freshMilestones(cards: GoalCard[], seen: Record<string, string>): { celebrate: { card: GoalCard; level: Level }[]; seen: Record<string, string> } {
  const next = { ...seen }
  const out: { card: GoalCard; level: Level }[] = []
  for (const c of cards) {
    const id = String(c.goal.id)
    const { level, key } = milestoneKey(c)
    const before = seen[id]
    next[id] = key
    if (before == null || before === key || !level) continue
    const was = c.period ? 0 : Number(before) || 0
    if (level > was) out.push({ card: c, level })
  }
  return { celebrate: out, seen: next }
}

export function celebrationText(c: GoalCard, level: Level): { title: string; line: string } {
  const g = c.goal
  if (c.period) return { title: `${perWord(c.period.per) === 'week' ? 'Week' : 'Month'} made! 🔥`, line: `${g.title}: ${c.period.value} of ${c.period.target}${c.period.streak > 1 ? ` · ${c.period.streak} in a row` : ''}. That's who you are now.` }
  if (level === 100) return { title: 'Goal reached! 🏆', line: `${g.title}. You said you would, and you did.` }
  if (level === 75) return { title: '75%: the last stretch', line: `${g.title}: three quarters done. Finish it.` }
  if (level === 50) return { title: 'Halfway there! 😎', line: `${g.title}: half done. The second half is shorter, you know how now.` }
  return { title: 'First quarter done 🎉', line: `${g.title}: 25% in. Momentum is real now.` }
}

// ------------------------------------------------------------ starter goals

export interface StarterFacts {
  today: string
  workouts30: number
  focusTop: { subject: string; hours: number } | null
  finance: boolean
  sleepLogs30: number
  waterDays30: number
}

export interface Starter {
  id: string
  icon: string
  title: string
  why: string
  /** Words for the New goal sheet (the same parser as typing). */
  words: string
}

/** Three starter goals that fit the data the app already has. */
export function starterGoals(f: StarterFacts): Starter[] {
  const by = (days: number) => {
    const d = addDays(f.today, days)
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  const list: Starter[] = []
  const perWeek = f.workouts30 >= 14 ? 5 : f.workouts30 >= 8 ? 4 : 3
  list.push({ id: 'workout', icon: '🏋️', title: `Work out ${perWeek}× a week`, why: f.workouts30 ? `You trained ${f.workouts30} times in the last 30 days: make it a rhythm` : 'Counts itself from your workouts', words: `workout ${perWeek} times a week` })
  if (f.finance) list.push({ id: 'save', icon: '🏦', title: `Save 3,000 lei by ${by(90)}`, why: 'Counts itself from Finance Helper', words: `save 3000 lei by ${by(90)}` })
  const subject = f.focusTop?.subject || 'study'
  const hours = f.focusTop ? Math.max(10, Math.round((f.focusTop.hours * 2) / 5) * 5) : 20
  list.push({ id: 'hours', icon: '⏱️', title: `${hours} focus hours of ${subject}`, why: f.focusTop ? `${Math.round(f.focusTop.hours)}h of ${subject} last month: aim higher` : 'Counts itself from the focus timer', words: `finish ${hours} hours of ${subject} by ${by(42)}` })
  if (!f.finance) list.push({ id: 'sleep', icon: '🌙', title: 'In bed by 00:00, 5 nights a week', why: f.sleepLogs30 ? 'Counts itself from Sleep' : 'Log your nights on Sleep', words: 'sleep before 00:00 5 nights a week' })
  return list.slice(0, 3)
}

/** The source label in a few words ("Workouts", "Focus: Rust"). */
export function sourceShort(s: GoalSource): string {
  const k = s.kind
  if (k === 'manual') return 'You log it'
  if (k.startsWith('money.')) return 'Finance Helper'
  if (k === 'body.weight') return 'Your weight'
  if (k === 'body.workouts') return 'Workouts'
  if (k === 'sport.reps') return `Reps: ${s.arg ?? ''}`.trim()
  if (k === 'water') return 'Water'
  if (k === 'sleep.bed') return `Sleep: by ${s.arg ?? '00:00'}`
  if (k === 'focus.hours') return s.arg ? `Focus: ${s.arg}` : 'Focus timer'
  if (k === 'pc.work') return 'PC work time'
  if (k === 'pc.kind') return `PC: ${s.arg ?? ''}`.trim()
  if (k === 'tasks.done') return s.arg ? `Todoist: ${s.arg}` : 'Todoist'
  return 'Clean streak'
}

/** One line for Ben or a list, any kind ("Work out 4×/week: 2 of 4 this week, on track, today: Work out"). */
export function cardSummary(c: GoalCard): string {
  const g = c.goal
  const pi = c.period
  const head = pi ? `${g.title}: ${c.kind === 'habit' ? `${pi.value} of ${pi.target}` : `${amount(g, pi.value)} of ${amount(g, pi.target)}`} this ${perWord(pi.per)}` : c.kind === 'project' ? `${g.title}: ${c.pct}% of the steps by ${shortDay(g.deadline)}` : null
  return head ? `${head}, ${(c.pace ?? '').toLowerCase()}${pi && pi.streak > 1 ? `, ${pi.streak} in a row` : ''}` : ''
}

// Measurable goals on any database with the better-sqlite3 API (the web
// app's copy, the bot server). They sit in focus_goals next to the hour
// goals (kind 'measure'); their check-ins go to goal_checkins and are never
// changed or deleted (a correction is a new check-in). Points are honest and
// small: +3 for the first check-in of a goal's period (you answered on time),
// +15 for a milestone you reached through a check-in. A number that moves by
// itself (auto sources: money, weight, workouts…) never pays.
import { addDays } from '@core/dates'
import { LedgerError } from '@core/ledger'
import {
  CADENCES,
  GOAL_UNITS,
  SOURCES,
  argOptional,
  countsFromStart,
  currentValue,
  firstOfPeriod,
  goalCard,
  isAuto,
  milestonesCrossed,
  milestonesOf,
  periodKey,
  progressOf,
  sortCards,
  type Cadence,
  type CheckIn,
  type GoalCard,
  type GoalSource,
  type GoalUnit,
  type MeasureGoal,
  type Milestone,
  type PaceCurve
} from '@core/goals'
import { CHECKIN_RULE, MILESTONE_RULE, checkinRef, milestoneRef } from '@core/goalsBen'
import { SOURCES_FOR, cleanMeta, defaultMeta, isPeriodType, periodOf, stepsPct, typedCard, type GoalMeta, type GoalType } from '@core/goalKinds'
import { totalsOf, WATER_KIND } from '@core/bodyLog'
import { bodyEvents } from './bodyLog'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import { Discipline } from './discipline'

export interface GoalInput {
  id?: number
  title: string
  unit: GoalUnit
  unitLabel?: string
  start?: number | null
  target: number
  deadline: string
  startDay?: string
  why?: string
  area?: string
  cadence?: Cadence
  source?: GoalSource
  milestones?: Milestone[]
  curve?: PaceCurve
  /** The kind and the extras (steps, look, why picture, reward...). Left out on an edit: kept as they are. */
  meta?: Partial<GoalMeta>
}

/** Open-ended habits and repeats ("every month, no end date"). */
export const NO_END = '2099-12-31'
const META = 'goal_meta:'
/** Kinds of PC time that count as work (the island's day totals). */
const WORK_KINDS = ['coding', 'study', 'writing', 'ctf', 'email', 'meeting', 'money']

export interface CheckInResult {
  card: GoalCard
  /** Points paid now (check-in on time + milestones). */
  paid: number
  milestones: Milestone[]
  done: boolean
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const json = <T>(s: unknown, d: T): T => {
  try {
    const v = JSON.parse(String(s ?? ''))
    return v ?? d
  } catch {
    return d
  }
}
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Finance Helper's synced state (the app may pass its fresher local copy instead). */
export function financeFromDb(db: DB): any {
  try {
    const synced = JSON.parse(getSetting(db, 'app_sync_finance') || 'null')
    if (synced?.data) return synced.data
  } catch {
    /* older copy */
  }
  try {
    return JSON.parse(getSetting(db, 'finance_backup_json') || 'null')
  } catch {
    return null
  }
}

/** Money in and out (lei) between two days, from Finance Helper (amounts are in bani). */
export function moneyBetween(state: any, from: string, to: string): { income: number; spent: number } | null {
  if (!state || !Array.isArray(state.tx)) return null
  let income = 0
  let spent = 0
  for (const t of state.tx) {
    if (!t || t.deleted || typeof t.date !== 'string') continue
    const d = t.date.slice(0, 10)
    if (d < from || d > to) continue
    const v = Math.abs(Number(t.base ?? t.amount) || 0) / 100
    if (t.type === 'income') income += v
    else if (t.type === 'expense') spent += v
  }
  return { income: Math.round(income), spent: Math.round(spent) }
}

export class GoalsService {
  constructor(
    private db: DB,
    private wallet: Wallet
  ) {}

  private rows(all = false): any[] {
    try {
      return this.db.prepare(`SELECT * FROM focus_goals WHERE kind = 'measure'${all ? '' : ' AND archived = 0'} ORDER BY deadline`).all() as any[]
    } catch {
      return []
    }
  }

  private toGoal(r: any): MeasureGoal {
    const source = json<GoalSource>(r.source, { kind: 'manual' })
    return {
      id: Number(r.id),
      title: String(r.title),
      unit: (GOAL_UNITS.some((u) => u.id === r.unit) ? r.unit : 'count') as GoalUnit,
      unitLabel: r.unit_label ? String(r.unit_label) : undefined,
      start: Number(r.start_value) || 0,
      target: Number(r.target ?? r.hours) || 0,
      startDay: String(r.created_day),
      deadline: String(r.deadline),
      why: String(r.why ?? ''),
      area: String(r.area ?? 'Life'),
      cadence: (CADENCES.some((c) => c.id === r.cadence) ? r.cadence : 'weekly') as Cadence,
      source: SOURCES.some((s) => s.id === source.kind) ? source : { kind: 'manual' },
      milestones: json<Milestone[]>(r.milestones, []).filter((m) => Number.isFinite(Number(m?.value))).map((m) => ({ value: Number(m.value), ...(m.label ? { label: String(m.label).slice(0, 30) } : {}) })),
      curve: (['line', 'ramp', 'front'].includes(r.curve) ? r.curve : 'line') as PaceCurve,
      doneDay: r.done_day ? String(r.done_day) : null
    }
  }

  goals(all = false): MeasureGoal[] {
    return this.rows(all).map((r) => this.toGoal(r))
  }

  goal(id: number): MeasureGoal | null {
    const r = this.db.prepare("SELECT * FROM focus_goals WHERE id = ? AND kind = 'measure'").get(id) as any
    return r ? this.toGoal(r) : null
  }

  /** The kind and extras of a goal (a goal from before kinds: a 'target'). */
  meta(id: number): GoalMeta {
    try {
      return cleanMeta(JSON.parse(getSetting(this.db, META + id) || 'null'))
    } catch {
      return defaultMeta()
    }
  }

  /** Changes some extras of a goal (the rest stay; the kind never changes here). */
  setMeta(id: number, patch: Partial<GoalMeta>): GoalMeta {
    const cur = this.meta(id)
    const next = cleanMeta({ ...cur, ...patch, type: cur.type })
    setSetting(this.db, META + id, JSON.stringify(next))
    return next
  }

  checkins(goalId?: number): CheckIn[] {
    try {
      const rows = (goalId == null ? this.db.prepare('SELECT * FROM goal_checkins ORDER BY at').all() : this.db.prepare('SELECT * FROM goal_checkins WHERE goal_id = ? ORDER BY at').all(goalId)) as any[]
      return rows.map((r) => ({ id: String(r.id), goalId: Number(r.goal_id), at: String(r.at), day: String(r.day), value: Number(r.value), by: (['me', 'auto', 'ben', 'skip'].includes(r.who) ? r.who : 'me') as CheckIn['by'], note: r.note ?? null }))
    } catch {
      return []
    }
  }

  /** The number an auto source shows now (null: no data for it). */
  autoValue(g: Pick<MeasureGoal, 'source' | 'startDay'>, now = new Date(), finance?: any): number | null {
    const today = this.wallet.today(now)
    const s = g.source
    try {
      if (s.kind.startsWith('money.')) {
        const fin = finance ?? financeFromDb(this.db)
        const from = s.kind === 'money.saved' ? g.startDay : `${today.slice(0, 7)}-01`
        const m = moneyBetween(fin, from, today)
        if (!m) return null
        return s.kind === 'money.income' ? m.income : m.income - m.spent
      }
      if (s.kind === 'body.weight') {
        const r = this.db.prepare('SELECT weight FROM body_metrics WHERE weight IS NOT NULL ORDER BY day DESC LIMIT 1').get() as any
        return r ? Number(r.weight) : null
      }
      if (s.kind === 'body.workouts') return Number((this.db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE day >= ?').get(g.startDay) as any)?.n ?? 0)
      if (s.kind === 'sport.reps') {
        const want = String(s.arg ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')
        if (!want) return null
        let n = 0
        for (const w of this.db.prepare('SELECT items_json FROM workouts WHERE day >= ?').all(g.startDay) as any[]) {
          for (const it of json<any[]>(w.items_json, [])) {
            const name = String(it?.name ?? it?.exerciseId ?? '').toLowerCase().replace(/[^a-z]/g, '')
            if (name.includes(want) && (it?.unit ?? 'reps') === 'reps') n += Number(it.amount) || 0
          }
        }
        return n
      }
      if (s.kind === 'focus.hours') {
        const r = this.db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM focus_sessions WHERE day >= ? AND lower(subject) = lower(?)').get(g.startDay, String(s.arg ?? '')) as any
        return Math.round((Number(r?.m ?? 0) / 60) * 10) / 10
      }
      if (s.kind === 'tasks.done') {
        const r = this.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE rule_id = 'tasks.todoist_done' AND day >= ? AND undo_of IS NULL AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL)").get(g.startDay) as any
        return Number(r?.n ?? 0)
      }
      if (s.kind === 'habit.clean') return new Discipline(this.db, this.wallet).state(now).current
      // The newer sources: everything since the goal's first day.
      const d = this.dailyValues(s, g.startDay, today, finance)
      if (!d) return null
      return Math.round(Object.values(d).reduce((t, v) => t + v, 0) * 100) / 100
    } catch {
      return null
    }
  }

  /**
   * Day -> amount between two days from a data source (habits, limits and
   * repeats; the newer sources of number goals too). null: no data for it.
   */
  dailyValues(s: GoalSource, from: string, to: string, finance?: any): Record<string, number> | null {
    const out: Record<string, number> = {}
    const add = (day: string, n: number) => {
      if (day < from || day > to || !Number.isFinite(n)) return
      out[day] = Math.round(((out[day] ?? 0) + n) * 100) / 100
    }
    try {
      if (s.kind.startsWith('money.')) {
        const fin = finance ?? financeFromDb(this.db)
        if (!fin || !Array.isArray(fin.tx)) return null
        for (const t of fin.tx) {
          if (!t || t.deleted || typeof t.date !== 'string') continue
          const v = Math.abs(Number(t.base ?? t.amount) || 0) / 100
          const inc = t.type === 'income'
          const exp = t.type === 'expense'
          if (s.kind === 'money.income' && inc) add(t.date.slice(0, 10), v)
          else if (s.kind === 'money.spent' && exp) add(t.date.slice(0, 10), v)
          else if ((s.kind === 'money.saved' || s.kind === 'money.profit') && (inc || exp)) add(t.date.slice(0, 10), inc ? v : -v)
        }
        return out
      }
      if (s.kind === 'body.workouts') {
        for (const r of this.db.prepare('SELECT day, COUNT(*) AS n FROM workouts WHERE day >= ? AND day <= ? GROUP BY day').all(from, to) as any[]) add(String(r.day), Number(r.n))
        return out
      }
      if (s.kind === 'sport.reps') {
        const want = String(s.arg ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')
        if (!want) return null
        for (const w of this.db.prepare('SELECT day, items_json FROM workouts WHERE day >= ? AND day <= ?').all(from, to) as any[]) {
          for (const it of json<any[]>(w.items_json, [])) {
            const name = String(it?.name ?? it?.exerciseId ?? '').toLowerCase().replace(/[^a-z]/g, '')
            if (name.includes(want) && (it?.unit ?? 'reps') === 'reps') add(String(w.day), Number(it.amount) || 0)
          }
        }
        return out
      }
      if (s.kind === 'water') {
        const ev = bodyEvents(this.db, from, to)
        for (const day of new Set(ev.map((e) => e.day))) add(day, totalsOf(ev, day)[WATER_KIND] ?? 0)
        return out
      }
      if (s.kind === 'sleep.bed') {
        // Bedtimes before noon are after midnight (00:30 is later than 23:30).
        const mins = (t: string) => {
          const [a, b] = t.split(':').map(Number)
          const v = (Number.isFinite(a) ? a : 0) * 60 + (Number.isFinite(b) ? b : 0)
          return a < 12 ? v + 1440 : v
        }
        const limit = mins(String(s.arg || '00:00'))
        for (const r of this.db.prepare('SELECT day, bed_time FROM sleep_logs WHERE day >= ? AND day <= ? AND bed_time IS NOT NULL').all(from, to) as any[]) if (/^\d{1,2}:\d{2}/.test(String(r.bed_time))) add(String(r.day), mins(String(r.bed_time)) <= limit ? 1 : 0)
        return out
      }
      if (s.kind === 'focus.hours') {
        const rows = (s.arg ? this.db.prepare('SELECT day, SUM(minutes) AS m FROM focus_sessions WHERE day >= ? AND day <= ? AND lower(subject) = lower(?) GROUP BY day').all(from, to, String(s.arg)) : this.db.prepare('SELECT day, SUM(minutes) AS m FROM focus_sessions WHERE day >= ? AND day <= ? GROUP BY day').all(from, to)) as any[]
        for (const r of rows) add(String(r.day), Math.round((Number(r.m) / 60) * 100) / 100)
        return out
      }
      if (s.kind === 'tasks.done') {
        const rows = this.db.prepare("SELECT day, note FROM ledger WHERE rule_id = 'tasks.todoist_done' AND day >= ? AND day <= ? AND undo_of IS NULL AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL)").all(from, to) as any[]
        const want = String(s.arg ?? '').toLowerCase().trim()
        for (const r of rows) if (!want || String(r.note ?? '').toLowerCase().includes(want)) add(String(r.day), 1)
        return out
      }
      if (s.kind === 'pc.work' || s.kind === 'pc.kind') {
        const log = json<Record<string, { hours?: Record<string, Record<string, number>> }>>(getSetting(this.db, 'island_day_log'), {})
        const kinds = s.kind === 'pc.work' ? WORK_KINDS : [String(s.arg ?? '').toLowerCase().trim()]
        for (const [day, d] of Object.entries(log)) {
          let min = 0
          for (const hour of Object.values(d?.hours ?? {})) for (const [k, v] of Object.entries(hour ?? {})) if (kinds.includes(k)) min += Number(v) || 0
          if (min) add(day, Math.round((min / 60) * 100) / 100)
        }
        return out
      }
    } catch {
      return null
    }
    return null
  }

  /** One card with the right maths for its kind. */
  private cardOf(g: MeasureGoal, meta: GoalMeta, mine: CheckIn[], now: Date, finance?: any): GoalCard {
    const today = this.wallet.today(now)
    if (isPeriodType(meta.type)) {
      const from = periodOf(meta.per, addDays(today, meta.per === 'month' ? -400 : -70)).from
      const daily = isAuto(g.source) ? this.dailyValues(g.source, from < g.startDay ? g.startDay : from, today, finance) : null
      return typedCard(g, meta, mine, today, isAuto(g.source) ? (daily ?? {}) : null)
    }
    if (isAuto(g.source) && meta.type === 'target') {
      const v = this.autoValue(g, now, finance)
      if (v != null && v !== currentValue(g, mine)) mine = [...mine, { id: 'live', goalId: g.id, at: now.toISOString(), day: today, value: v, by: 'auto' }]
    }
    return typedCard(g, meta, mine, today)
  }

  /**
   * The cards, newest numbers in: auto goals get today's number live (not
   * saved; syncAuto keeps one a day for the history). Paused goals only with
   * `paused: true` (the page); Ben, the island and the tick leave them be.
   */
  cards(now = new Date(), finance?: any, opts: { paused?: boolean } = {}): GoalCard[] {
    const all = this.checkins()
    const out = this.goals()
      .map((g) => ({ g, meta: this.meta(g.id) }))
      .filter((x) => opts.paused || !x.meta.paused)
      .map(({ g, meta }) => this.cardOf(g, meta, all.filter((c) => c.goalId === g.id), now, finance))
    return sortCards(out)
  }

  /** One card by id (paused ones too). */
  card(id: number, now = new Date(), finance?: any): GoalCard | null {
    const g = this.goal(id)
    return g ? this.cardOf(g, this.meta(id), this.checkins(id), now, finance) : null
  }

  /**
   * Auto goals: keep at most one number a day in the history when it moved,
   * and mark the goal done when it gets there (no points: it moved by itself).
   * Returns the goals whose number was saved.
   */
  syncAuto(now = new Date(), finance?: any): number[] {
    const today = this.wallet.today(now)
    const out: number[] = []
    for (const g of this.goals()) {
      if (!isAuto(g.source) || g.doneDay || this.meta(g.id).type !== 'target') continue
      const v = this.autoValue(g, now, finance)
      if (v == null) continue
      const mine = this.checkins(g.id)
      if (mine.some((c) => c.day === today && c.by === 'auto')) continue
      if (v === currentValue(g, mine)) continue
      this.db.prepare("INSERT INTO goal_checkins (id, goal_id, at, day, value, who, note) VALUES (?, ?, ?, ?, ?, 'auto', NULL)").run(rid(), g.id, now.toISOString(), today, v)
      if (progressOf(g, v) >= 1) this.db.prepare('UPDATE focus_goals SET done_day = ? WHERE id = ?').run(today, g.id)
      out.push(g.id)
    }
    return out
  }

  save(input: GoalInput, now = new Date(), finance?: any): MeasureGoal {
    const title = String(input.title ?? '').trim().slice(0, 80)
    if (!title) throw new LedgerError('Name the goal, e.g. "Profit 5,000 lei a month"')
    const prevMeta = input.id ? this.meta(input.id) : null
    const type: GoalType = prevMeta && input.id ? (input.meta?.type ?? prevMeta.type) : (input.meta?.type ?? 'target')
    const period = isPeriodType(type)
    const deadline = period && !input.deadline ? NO_END : String(input.deadline ?? '')
    if (!DAY.test(deadline)) throw new LedgerError('Pick the deadline')
    const today = this.wallet.today(now)
    if (!input.id && deadline <= today) throw new LedgerError('The deadline needs to be after today')
    const steps = type === 'project' ? (input.meta?.steps ?? prevMeta?.steps ?? []) : []
    if (type === 'project' && !steps.length) throw new LedgerError('Add the steps, e.g. "Learn domain 1"')
    const target = type === 'project' ? 100 : Number(input.target)
    if (!Number.isFinite(target)) throw new LedgerError('What number are you aiming for?')
    if (period && target <= 0) throw new LedgerError(type === 'habit' ? 'How many times? e.g. 4' : 'How much? e.g. 5')
    const unit: GoalUnit = type === 'project' ? 'pct' : GOAL_UNITS.some((u) => u.id === input.unit) ? input.unit : 'count'
    const source: GoalSource = type !== 'project' && input.source && SOURCES.some((s) => s.id === input.source!.kind) && SOURCES_FOR[type].includes(input.source.kind) ? { kind: input.source.kind, ...(input.source.arg ? { arg: String(input.source.arg).trim().slice(0, 40) } : {}) } : { kind: 'manual' }
    const meta = SOURCES.find((s) => s.id === source.kind)!
    if (meta.needsArg && !source.arg && !argOptional(source.kind)) throw new LedgerError(`${meta.label}: which one? (${meta.needsArg})`)
    const startDay = input.startDay && DAY.test(input.startDay) && input.startDay <= today ? input.startDay : today
    let start = type !== 'target' ? 0 : input.start == null || !Number.isFinite(Number(input.start)) ? null : Number(input.start)
    if (start == null) start = isAuto(source) && !countsFromStart(source.kind) ? (this.autoValue({ source, startDay }, now, finance) ?? 0) : 0
    if (!period && start === target) throw new LedgerError('The target is where you are already: aim for a different number')
    const per = input.meta?.per ?? prevMeta?.per ?? (type === 'repeat' ? 'month' : 'week')
    const cadence: Cadence = period ? (per === 'month' ? 'monthly' : 'weekly') : CADENCES.some((c) => c.id === input.cadence) ? input.cadence! : 'weekly'
    const curve: PaceCurve = input.curve && ['line', 'ramp', 'front'].includes(input.curve) ? input.curve : 'line'
    const milestones = (input.milestones ?? []).filter((m) => Number.isFinite(Number(m?.value))).slice(0, 8).map((m) => ({ value: Number(m.value), ...(m.label ? { label: String(m.label).trim().slice(0, 30) } : {}) }))
    const vals = {
      title,
      unit,
      unit_label: unit === 'custom' ? String(input.unitLabel ?? '').trim().slice(0, 16) || null : null,
      target,
      start_value: start,
      why: String(input.why ?? '').trim().slice(0, 140),
      area: String(input.area ?? 'Life').trim().slice(0, 24) || 'Life',
      cadence,
      source: JSON.stringify(source),
      milestones: JSON.stringify(milestones),
      curve,
      deadline
    }
    const metaOut = (id: number) => {
      const base = prevMeta ?? defaultMeta(type)
      setSetting(this.db, META + id, JSON.stringify(cleanMeta({ ...base, ...(input.meta ?? {}), type, per, steps })))
    }
    if (input.id) {
      const cur = this.goal(input.id)
      if (!cur) throw new LedgerError('That goal is gone')
      this.db
        .prepare('UPDATE focus_goals SET title = @title, unit = @unit, unit_label = @unit_label, target = @target, hours = @target, start_value = @start_value, why = @why, area = @area, cadence = @cadence, source = @source, milestones = @milestones, curve = @curve, deadline = @deadline WHERE id = @id')
        .run({ ...vals, id: input.id })
      metaOut(input.id)
      return this.goal(input.id)!
    }
    const r = this.db
      .prepare("INSERT INTO focus_goals (title, subject, deadline, hours, created_day, kind, unit, unit_label, target, start_value, why, area, cadence, source, milestones, curve) VALUES (@title, '', @deadline, @target, @day, 'measure', @unit, @unit_label, @target, @start_value, @why, @area, @cadence, @source, @milestones, @curve)")
      .run({ ...vals, day: startDay })
    const id = Number(r.lastInsertRowid)
    metaOut(id)
    return this.goal(id)!
  }

  archive(id: number): void {
    this.db.prepare("UPDATE focus_goals SET archived = 1 WHERE id = ? AND kind = 'measure'").run(id)
  }

  /** Pause (no nudges, no check-ins due) or carry on. */
  setPaused(id: number, paused: boolean): GoalMeta {
    return this.setMeta(id, { paused, ...(paused ? { pinned: false } : {}) })
  }

  /** The one focus goal at the top of the page (pinning one unpins the others). */
  setPinned(id: number, pinned: boolean): void {
    if (pinned) for (const g of this.goals()) if (g.id !== id && this.meta(g.id).pinned) this.setMeta(g.id, { pinned: false })
    this.setMeta(id, { pinned })
  }

  /** Your own order: the ids as you want them shown. */
  reorder(ids: number[]): void {
    ids.forEach((id, i) => {
      if (this.goal(id)) this.setMeta(id, { order: i })
    })
  }

  /** Mark it reached yourself (no points: those come from what you logged) or open it again. */
  setDone(id: number, done: boolean, now = new Date()): void {
    this.db.prepare("UPDATE focus_goals SET done_day = ? WHERE id = ? AND kind = 'measure'").run(done ? this.wallet.today(now) : null, id)
  }

  /**
   * Habit, limit and repeating goals you log by hand: add an amount for today
   * (1 = "did it today"; a negative amount takes some back). The first log of
   * a period that adds something pays +3, as a check-in does.
   */
  logPeriod(id: number, amount: number, now = new Date(), onDay?: string): CheckInResult {
    const g = this.goal(id)
    if (!g) throw new LedgerError('That goal is gone')
    const meta = this.meta(id)
    if (!isPeriodType(meta.type) || isAuto(g.source)) throw new LedgerError('This goal counts itself')
    if (!Number.isFinite(amount) || !amount || Math.abs(amount) > 1e7) throw new LedgerError('Type how much, e.g. 1')
    const today = this.wallet.today(now)
    // An earlier day of this week or month (Ben's "3 so far"), never the future.
    const day = onDay && DAY.test(onDay) && onDay <= today && periodOf(meta.per, onDay).key === periodOf(meta.per, today).key ? onDay : today
    return this.db.transaction(() => {
      const before = this.checkins(id)
      const dayHas = before.filter((c) => c.day === day && (c.by === 'me' || c.by === 'ben')).reduce((t, c) => t + c.value, 0)
      if (amount < 0 && dayHas + amount < -1e-9) throw new LedgerError('Nothing to take back today')
      const onTime = amount > 0 && firstOfPeriod(g, before, today)
      this.db.prepare("INSERT INTO goal_checkins (id, goal_id, at, day, value, who, note) VALUES (?, ?, ?, ?, ?, 'me', 'log')").run(rid(), id, now.toISOString(), day, amount)
      let paid = 0
      if (onTime) paid += this.coinsOf(this.wallet.payOnce(CHECKIN_RULE, { day: today, ref: checkinRef(id, periodKey(g.cadence, today, g.startDay)), note: `Logged: ${g.title}`, now }))
      return { card: typedCard(g, meta, this.checkins(id), today), paid, milestones: [], done: false }
    })()
  }

  /**
   * Ticks a step of a project goal (or unticks it). The new share done goes
   * into the history as a check-in, so milestones pay as they do for any goal
   * you report yourself (each once).
   */
  toggleStep(id: number, stepId: string, now = new Date()): CheckInResult {
    const meta = this.meta(id)
    if (meta.type !== 'project') throw new LedgerError('This goal has no steps')
    if (!meta.steps.some((s) => s.id === stepId)) throw new LedgerError('That step is gone')
    const today = this.wallet.today(now)
    const steps = meta.steps.map((s) => (s.id === stepId ? { ...s, done: s.done ? null : today } : s))
    this.setMeta(id, { steps })
    return this.checkIn(id, stepsPct(steps), 'me', 'step', now)
  }

  /**
   * A check-in: the number now (a new row, never an edit). Pays +3 when it is
   * the first one of this goal's period, +15 per milestone it reaches (each
   * once), and marks the goal done when it gets there.
   */
  checkIn(id: number, value: number, by: 'me' | 'ben' = 'me', note: string | null = null, now = new Date()): CheckInResult {
    const g = this.goal(id)
    if (!g) throw new LedgerError('That goal is gone')
    if (!Number.isFinite(value)) throw new LedgerError('Type the number, e.g. 3400')
    if (Math.abs(value) > 1e9) throw new LedgerError('That number is too big')
    const today = this.wallet.today(now)
    const meta = this.meta(id)
    if (isPeriodType(meta.type)) {
      // "The number now" for a week or month: log the difference.
      if (isAuto(g.source)) throw new LedgerError('This goal counts itself')
      const card = typedCard(g, meta, this.checkins(id), today)
      const diff = Math.round((value - card.value) * 100) / 100
      if (!diff) return { card, paid: 0, milestones: [], done: false }
      if (meta.type !== 'habit' || !card.period) return this.logPeriod(id, diff, now)
      // A habit counts days: "3 so far" fills this week's empty days from today back
      // (or takes back the latest ones).
      const days = card.period.days.length ? card.period.days : [{ day: today, done: card.period.todayDone, future: false, value: card.period.todayValue }]
      const pick = days.filter((d) => !d.future && (diff > 0 ? !d.done : d.done)).reverse().slice(0, Math.abs(Math.round(diff)))
      let last: CheckInResult = { card, paid: 0, milestones: [], done: false }
      let paid = 0
      for (const d of pick) {
        last = this.logPeriod(id, diff > 0 ? 1 : -1, now, d.day)
        paid += last.paid
      }
      return { ...last, paid }
    }
    return this.db.transaction(() => {
      const before = this.checkins(id)
      const prev = currentValue(g, before)
      const onTime = firstOfPeriod(g, before, today)
      this.db.prepare('INSERT INTO goal_checkins (id, goal_id, at, day, value, who, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(rid(), id, now.toISOString(), today, value, by, note ? String(note).slice(0, 140) : null)
      let paid = 0
      // Honest: a check-in pays for answering on time, only on goals you report yourself.
      if (onTime && !isAuto(g.source)) {
        const lid = this.wallet.payOnce(CHECKIN_RULE, { day: today, ref: checkinRef(id, periodKey(g.cadence, today, g.startDay)), note: `Checked in: ${g.title}`, now })
        paid += this.coinsOf(lid)
      }
      const crossed = isAuto(g.source) ? [] : milestonesCrossed(g, prev, value)
      const list = milestonesOf(g)
      for (const m of crossed) {
        const lid = this.wallet.payOnce(MILESTONE_RULE, { day: today, ref: milestoneRef(id, list.findIndex((x) => x.value === m.value)), note: `Milestone: ${g.title} · ${m.label ?? m.value}`, now })
        paid += this.coinsOf(lid)
      }
      const done = progressOf(g, value) >= 1 && !g.doneDay
      if (done) {
        this.db.prepare('UPDATE focus_goals SET done_day = ? WHERE id = ?').run(today, id)
        if (!isAuto(g.source)) {
          const lid = this.wallet.payOnce(MILESTONE_RULE, { day: today, ref: milestoneRef(id, 'done'), note: `Goal reached: ${g.title}`, now })
          paid += this.coinsOf(lid)
        }
      }
      const fresh = this.goal(id)!
      return { card: typedCard(fresh, meta, this.checkins(id), today), paid, milestones: crossed, done }
    })()
  }

  private coinsOf(ledgerId: number): number {
    if (!ledgerId) return 0
    return Number((this.db.prepare('SELECT coins FROM ledger WHERE id = ?').get(ledgerId) as any)?.coins ?? 0)
  }

  /** "Skip" this period: answered, no number, no points. */
  skip(id: number, now = new Date()): GoalCard {
    const g = this.goal(id)
    if (!g) throw new LedgerError('That goal is gone')
    const today = this.wallet.today(now)
    this.db.prepare("INSERT INTO goal_checkins (id, goal_id, at, day, value, who, note) VALUES (?, ?, ?, ?, ?, 'skip', NULL)").run(rid(), id, now.toISOString(), today, currentValue(g, this.checkins(id)))
    return goalCard(g, this.checkins(id), today)
  }

  /** The check-ins of the last days (newest first), for the page's history. */
  recent(days = 30, now = new Date()): CheckIn[] {
    const from = addDays(this.wallet.today(now), -days)
    return this.checkins().filter((c) => c.day >= from).reverse()
  }
}

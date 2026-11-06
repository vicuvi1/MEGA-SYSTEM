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
import type { DB } from './db'
import { getSetting } from './settings'
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
}

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
    } catch {
      return null
    }
    return null
  }

  /**
   * The cards, newest numbers in: auto goals get today's number live (not
   * saved; syncAuto keeps one a day for the history).
   */
  cards(now = new Date(), finance?: any): GoalCard[] {
    const today = this.wallet.today(now)
    const all = this.checkins()
    return sortCards(
      this.goals().map((g) => {
        const mine = all.filter((c) => c.goalId === g.id)
        if (isAuto(g.source)) {
          const v = this.autoValue(g, now, finance)
          if (v != null && v !== currentValue(g, mine)) mine.push({ id: 'live', goalId: g.id, at: now.toISOString(), day: today, value: v, by: 'auto' })
        }
        return goalCard(g, mine, today)
      })
    )
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
      if (!isAuto(g.source) || g.doneDay) continue
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
    if (!DAY.test(String(input.deadline ?? ''))) throw new LedgerError('Pick the deadline')
    const today = this.wallet.today(now)
    if (!input.id && input.deadline <= today) throw new LedgerError('The deadline needs to be after today')
    const target = Number(input.target)
    if (!Number.isFinite(target)) throw new LedgerError('What number are you aiming for?')
    const unit: GoalUnit = GOAL_UNITS.some((u) => u.id === input.unit) ? input.unit : 'count'
    const source: GoalSource = input.source && SOURCES.some((s) => s.id === input.source!.kind) ? { kind: input.source.kind, ...(input.source.arg ? { arg: String(input.source.arg).trim().slice(0, 40) } : {}) } : { kind: 'manual' }
    const meta = SOURCES.find((s) => s.id === source.kind)!
    if (meta.needsArg && !source.arg) throw new LedgerError(`${meta.label}: which one? (${meta.needsArg})`)
    const startDay = input.startDay && DAY.test(input.startDay) && input.startDay <= today ? input.startDay : today
    let start = input.start == null || !Number.isFinite(Number(input.start)) ? null : Number(input.start)
    if (start == null) start = isAuto(source) && !countsFromStart(source.kind) ? (this.autoValue({ source, startDay }, now, finance) ?? 0) : 0
    if (start === target) throw new LedgerError('The target is where you are already: aim for a different number')
    const cadence: Cadence = CADENCES.some((c) => c.id === input.cadence) ? input.cadence! : 'weekly'
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
      deadline: input.deadline
    }
    if (input.id) {
      const cur = this.goal(input.id)
      if (!cur) throw new LedgerError('That goal is gone')
      this.db
        .prepare('UPDATE focus_goals SET title = @title, unit = @unit, unit_label = @unit_label, target = @target, hours = @target, start_value = @start_value, why = @why, area = @area, cadence = @cadence, source = @source, milestones = @milestones, curve = @curve, deadline = @deadline WHERE id = @id')
        .run({ ...vals, id: input.id })
      return this.goal(input.id)!
    }
    const r = this.db
      .prepare("INSERT INTO focus_goals (title, subject, deadline, hours, created_day, kind, unit, unit_label, target, start_value, why, area, cadence, source, milestones, curve) VALUES (@title, '', @deadline, @target, @day, 'measure', @unit, @unit_label, @target, @start_value, @why, @area, @cadence, @source, @milestones, @curve)")
      .run({ ...vals, day: startDay })
    return this.goal(Number(r.lastInsertRowid))!
  }

  archive(id: number): void {
    this.db.prepare("UPDATE focus_goals SET archived = 1 WHERE id = ? AND kind = 'measure'").run(id)
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
      return { card: goalCard(fresh, this.checkins(id), today), paid, milestones: crossed, done }
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

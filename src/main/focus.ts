// Focus sessions, the daily plan and goals, on any database with the
// better-sqlite3 API (the desktop file, the web app's copy, the bot server).
import { addDays } from '@core/dates'
import { LedgerError, balance } from '@core/ledger'
import {
  FOCUS_DAILY_COINS,
  PLAN_ITEM_COINS,
  focusCoins,
  funCost,
  goalProgress,
  sessionMinutes,
  weekReport,
  type DayPlan,
  type FocusGoal,
  type FocusSession,
  type GoalProgress,
  type WeekReport
} from '@core/focus'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

/** What a session is for, so its end can tick it off (a must-do or a Todoist task). */
export interface FocusTask {
  kind: 'mustdo' | 'todoist'
  /** Todoist task id; for a must-do, its text. */
  ref: string
  title: string
}

export interface RunningFocus {
  subject: string
  startedAt: string
  planned: number
  task?: FocusTask | null
}

export interface FocusState {
  today: string
  running: RunningFocus | null
  todayMin: number
  todayBySubject: { subject: string; minutes: number }[]
  subjects: string[]
  recent: FocusSession[]
  goals: GoalProgress[]
  plan: DayPlan
  week: WeekReport
  funToday: number
  focusCoinsToday: number
  /** Today's sessions with their times (for the timeline's done vs planned). */
  todaySessions: { subject: string; startedAt: string | null; endedAt: string | null; minutes: number }[]
}

const RUNNING = 'focus_running'

export class FocusService {
  constructor(private db: DB, private wallet: Wallet) {}

  private sessions(sinceDay: string): FocusSession[] {
    return (this.db.prepare('SELECT id, day, subject, minutes, coins FROM focus_sessions WHERE day >= ? ORDER BY id DESC').all(sinceDay) as FocusSession[]).map((r) => ({
      ...r,
      minutes: Number(r.minutes),
      coins: Number(r.coins)
    }))
  }

  private running(): RunningFocus | null {
    try {
      return JSON.parse(getSetting(this.db, RUNNING) || 'null')
    } catch {
      return null
    }
  }

  private funMin(fromDay: string, toDay: string): number {
    const rows = this.db.prepare("SELECT coins FROM ledger WHERE module = 'fun' AND kind = 'spend' AND day >= ? AND day <= ?").all(fromDay, toDay) as { coins: number }[]
    return rows.reduce((t, r) => t - Number(r.coins), 0)
  }

  plan(day: string): DayPlan {
    const row = this.db.prepare('SELECT * FROM day_plans WHERE day = ?').get(day) as { items: string; review: string | null; reasons: string } | undefined
    if (!row) return { day, items: [], review: null, reasons: [] }
    const parse = (s: string) => {
      try {
        return JSON.parse(s)
      } catch {
        return []
      }
    }
    return { day, items: parse(row.items), review: row.review, reasons: parse(row.reasons) }
  }

  private savePlan(p: DayPlan, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO day_plans (day, items, review, reasons, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET items = excluded.items, review = excluded.review, reasons = excluded.reasons, updated_at = excluded.updated_at`
      )
      .run(p.day, JSON.stringify(p.items.slice(0, 5)), p.review, JSON.stringify(p.reasons), now.toISOString())
  }

  private timed(day: string): FocusState['todaySessions'] {
    try {
      return (this.db.prepare('SELECT subject, started_at, ended_at, minutes FROM focus_sessions WHERE day = ? ORDER BY id').all(day) as any[]).map((r) => ({
        subject: String(r.subject),
        startedAt: r.started_at ? String(r.started_at) : null,
        endedAt: r.ended_at ? String(r.ended_at) : null,
        minutes: Number(r.minutes)
      }))
    } catch {
      return []
    }
  }

  state(now = new Date()): FocusState {
    const today = this.wallet.today(now)
    const all = this.sessions(addDays(today, -400))
    const todays = all.filter((s) => s.day === today)
    const by = new Map<string, number>()
    for (const s of todays) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes)
    const goals = (this.db.prepare('SELECT * FROM focus_goals WHERE archived = 0 ORDER BY deadline').all() as any[]).map((g) => {
      const goal: FocusGoal = { id: Number(g.id), title: String(g.title), subject: String(g.subject), deadline: String(g.deadline), hours: Number(g.hours), createdDay: String(g.created_day) }
      const done = all.filter((s) => s.day >= goal.createdDay && s.subject.toLowerCase() === goal.subject.toLowerCase()).reduce((t, s) => t + s.minutes, 0)
      return goalProgress(goal, done, today)
    })
    const plans = Array.from({ length: 7 }, (_, i) => this.plan(addDays(today, -i)))
    const subjects = [...new Set([...goals.map((g) => g.subject), ...all.map((s) => s.subject)])].slice(0, 8)
    return {
      today,
      running: this.running(),
      todayMin: todays.reduce((t, s) => t + s.minutes, 0),
      todayBySubject: [...by].map(([subject, minutes]) => ({ subject, minutes })).sort((a, b) => b.minutes - a.minutes),
      subjects,
      recent: all.slice(0, 10),
      goals,
      plan: this.plan(today),
      week: weekReport(all, plans, this.funMin(addDays(today, -6), today), today),
      funToday: this.funMin(today, today),
      focusCoinsToday: todays.reduce((t, s) => t + s.coins, 0),
      todaySessions: this.timed(today)
    }
  }

  /** Starts the timer (one at a time; it keeps running across devices). */
  start(subject: string, planned = 50, now = new Date(), task: FocusTask | null = null): FocusState {
    const name = String(subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('What are you focusing on? e.g. Math')
    if (this.running()) throw new LedgerError('A focus session is already running: stop it first')
    const minutes = Math.min(180, Math.max(5, Math.round(planned) || 50))
    const t = task && (task.kind === 'mustdo' || task.kind === 'todoist') ? { kind: task.kind, ref: String(task.ref).slice(0, 200), title: String(task.title).slice(0, 200) } : null
    setSetting(this.db, RUNNING, JSON.stringify({ subject: name, startedAt: now.toISOString(), planned: minutes, task: t }))
    return this.state(now)
  }

  /** Stops the timer and logs the minutes; coins for them (up to the daily limit). */
  stop(now = new Date()): { session: FocusSession; coins: number; state: FocusState; task: FocusTask | null } {
    const run = this.running()
    if (!run) throw new LedgerError('No focus session is running')
    const minutes = sessionMinutes(run.startedAt, run.planned, now)
    return this.db.transaction(() => {
      setSetting(this.db, RUNNING, 'null')
      return { ...this.log(run.subject, minutes, now, run.startedAt), task: run.task ?? null }
    })()
  }

  /** Adds minutes to the running timer (the island's +5 / +15); at most 4 hours in all. */
  extend(minutes: number, now = new Date()): FocusState {
    const run = this.running()
    if (!run) throw new LedgerError('No focus session is running')
    const m = Math.round(Number(minutes) || 0)
    if (!m) return this.state(now)
    const planned = Math.min(240, Math.max(5, run.planned + m))
    setSetting(this.db, RUNNING, JSON.stringify({ ...run, planned }))
    return this.state(now)
  }

  /** Drops the running timer without logging it. */
  cancel(now = new Date()): FocusState {
    setSetting(this.db, RUNNING, 'null')
    return this.state(now)
  }

  /** A session you did without the timer (today pays coins; earlier days count without). */
  add(subject: string, minutes: number, day?: string, now = new Date()) {
    const name = String(subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('Which subject?')
    const m = Math.round(minutes)
    if (!(m >= 1 && m <= 600)) throw new LedgerError('Minutes from 1 to 600')
    return this.db.transaction(() => this.log(name, m, now, null, day))()
  }

  private log(subject: string, minutes: number, now: Date, startedAt: string | null, day?: string) {
    const today = this.wallet.today(now)
    const d = day && day <= today && day >= addDays(today, -14) ? day : today
    const earned = this.sessions(today).filter((s) => s.day === today).reduce((t, s) => t + s.coins, 0)
    const coins = d === today ? Math.max(0, Math.min(focusCoins(minutes), FOCUS_DAILY_COINS - earned)) : 0
    const end = now.toISOString()
    const start = startedAt ?? new Date(now.getTime() - minutes * 60000).toISOString()
    const id = Number(
      this.db.prepare('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, ?)').run(d, subject, minutes, start, end, coins).lastInsertRowid
    )
    if (coins > 0 || minutes > 0) {
      this.wallet.append({ ts: end, day: today, module: 'focus', kind: 'earn', coins, xp: minutes, ruleId: 'focus.session', ref: `focus:${id}`, note: `Focus ${minutes} min · ${subject}` })
    }
    return { session: { id, day: d, subject, minutes, coins }, coins, state: this.state(now) }
  }

  /** Today's 1–3 (up to 5) must-dos. Keeps what was already ticked. */
  setPlan(items: string[], now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const cur = this.plan(d)
    const next = items
      .map((t) => String(t).trim().slice(0, 140))
      .filter(Boolean)
      .slice(0, 5)
      .map((text) => ({ text, done: cur.items.find((i) => i.text === text)?.done ?? false }))
    if (!next.length) throw new LedgerError('Write at least one must-do')
    this.savePlan({ ...cur, items: next }, now)
    return this.plan(d)
  }

  /** Ticks (or unticks) a must-do. The first tick of each pays its coins (3 a day). */
  togglePlan(index: number, now = new Date(), day?: string): { plan: DayPlan; coins: number } {
    const d = day ?? this.wallet.today(now)
    const p = this.plan(d)
    const item = p.items[index]
    if (!item) throw new LedgerError('No must-do with that number')
    item.done = !item.done
    let coins = 0
    return this.db.transaction(() => {
      this.savePlan(p, now)
      if (item.done && d === this.wallet.today(now)) {
        // Paid once per must-do (by its words, not its position: removing one
        // before it must not block the others), at most 3 a day.
        const ref = `plan:${d}:${item.text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`
        const entries = this.wallet.entries()
        const paidToday = entries.filter((e) => e.ruleId === 'plan.item_done' && e.day === d).length
        if (!entries.some((e) => e.ref === ref) && paidToday < 3) {
          this.wallet.append({ ts: now.toISOString(), day: d, module: 'plan', kind: 'earn', coins: PLAN_ITEM_COINS, xp: 15, ruleId: 'plan.item_done', ref, note: `Must-do: ${item.text.slice(0, 80)}` })
          coins = PLAN_ITEM_COINS
        }
      }
      return { plan: this.plan(d), coins }
    })()
  }

  /** The evening review: what got in the way, a line about the day. */
  review(text: string | null, reasons: string[], now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const p = this.plan(d)
    this.savePlan({ ...p, review: text?.trim().slice(0, 500) || p.review, reasons: [...new Set(reasons.map((r) => String(r).slice(0, 40)))].slice(0, 6) }, now)
    return this.plan(d)
  }

  saveGoal(g: { id?: number; title: string; subject: string; deadline: string; hours: number }, now = new Date()): FocusState {
    const title = String(g.title || '').trim().slice(0, 80)
    const subject = String(g.subject || title).trim().slice(0, 40)
    if (!title) throw new LedgerError('Name the goal, e.g. "Math exam"')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) throw new LedgerError('Pick the deadline')
    if (!(g.hours > 0 && g.hours <= 2000)) throw new LedgerError('How many hours does it need?')
    if (g.id) this.db.prepare('UPDATE focus_goals SET title = ?, subject = ?, deadline = ?, hours = ? WHERE id = ?').run(title, subject, g.deadline, g.hours, g.id)
    else this.db.prepare('INSERT INTO focus_goals (title, subject, deadline, hours, created_day) VALUES (?, ?, ?, ?, ?)').run(title, subject, g.deadline, g.hours, this.wallet.today(now))
    return this.state(now)
  }

  archiveGoal(id: number, now = new Date()): FocusState {
    this.db.prepare('UPDATE focus_goals SET archived = 1 WHERE id = ?').run(id)
    return this.state(now)
  }

  /** Fun time costs coins (1 a minute); you can't spend coins you don't have. */
  fun(minutes: number, what = 'Fun', now = new Date()): { cost: number; balance: number } {
    const cost = funCost(minutes)
    if (!(minutes >= 1 && minutes <= 600)) throw new LedgerError('Minutes from 1 to 600')
    return this.db.transaction(() => {
      const bal = balance(this.wallet.entries())
      if (bal < cost) throw new LedgerError(`Not enough coins: ${minutes} min of fun costs ${cost}, you have ${bal}. Focus first!`)
      this.wallet.append({ ts: now.toISOString(), day: this.wallet.today(now), module: 'fun', kind: 'spend', coins: -cost, xp: 0, ruleId: null, ref: null, note: `${String(what).slice(0, 40)} · ${minutes} min` })
      return { cost, balance: bal - cost }
    })()
  }
}

// Focus sessions, the daily plan and goals, on any database with the
// better-sqlite3 API (the desktop file, the web app's copy, the bot server).
import { planKey, type PlanGone } from '@core/focus'
import { addDays } from '@core/dates'
import { LedgerError, balance } from '@core/ledger'
import {
  FOCUS_DAILY_COINS,
  PLAN_ITEM_COINS,
  focusCoins,
  funCost,
  goalProgress,
  pausedMsOf,
  sessionMinutes,
  weekReport,
  type DayPlan,
  type PlanInput,
  type PlanItem,
  type FocusGoal,
  type FocusSession,
  type GoalProgress,
  type WeekReport
} from '@core/focus'
import { cleanStages, type FocusStage } from '@core/focusFlow'
import type { DB } from './db'
import { getSetting, setSetting, readSetting, writeSetting } from './settings'
import type { Wallet } from './wallet'
import { dayStreak, extraRef, isExtra, luckyRoll, streakBonus, STREAK_BONUS } from '@core/rewardsKit'

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
  /** IC1: paused since (ISO), or null / missing while it runs. */
  pausedAt?: string | null
  /** IC1: milliseconds paused before the pause going on now (paused time never counts). */
  pausedMs?: number
  /** IC11: what comes after this timer (a break, then the next block), set by the island. */
  stages?: FocusStage[]
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

const planCols = (from: string, src: number) =>
  `SELECT ${src} AS src, key AS pos, json_extract(value, '$.id') AS k, COALESCE(json_extract(value, '$.editedAt'), 0) AS at, value AS v FROM json_each(${from}) WHERE json_extract(value, '$.id') IS NOT NULL`
const goneCols = (from: string) => `SELECT json_extract(value, '$.id') AS k, COALESCE(json_extract(value, '$.editedAt'), 0) AS at FROM json_each(${from}) WHERE json_extract(value, '$.id') IS NOT NULL`
/**
 * The must-do write (args: planArgs). When the day has
 * a row already, the two lists are merged inside the statement:
 * - a must-do in both: the copy changed later (`editedAt`) stays, the incoming one on a tie;
 * - a must-do in only one of them stays (the incoming list's order first);
 * - a removed must-do (`removed`) is left out unless its copy is newer than the removal;
 * - must-dos saved before ids existed are replaced by the incoming list (it was made from them).
 * The review and its reasons are not touched (saveReview). The incoming lists are
 * read from the arguments again and the row by its day: SQLite sees neither `excluded`
 * nor the row being updated inside these subqueries (so the arguments repeat: planArgs).
 */
/** PLAN_MERGE's arguments, in the order its question marks come. */
export const planArgs = (day: string, items: string, updatedAt: string, removed: string): string[] => [day, items, updatedAt, removed, day, items, day, removed, day, removed]
export const PLAN_MERGE = `INSERT INTO day_plans (day, items, review, reasons, updated_at, removed) VALUES (?, ?, NULL, '[]', ?, ?)
  ON CONFLICT(day) DO UPDATE SET
    items = (
      WITH c AS (${planCols('(SELECT items FROM day_plans WHERE day = ?)', 0)} UNION ALL ${planCols('?', 1)}),
           g AS (${goneCols("COALESCE((SELECT removed FROM day_plans WHERE day = ?), '[]')")} UNION ALL ${goneCols('?')})
      SELECT COALESCE(json_group_array(json(v)), '[]') FROM (
        SELECT c.v FROM c
        WHERE NOT EXISTS (SELECT 1 FROM c d WHERE d.k = c.k AND (d.at > c.at OR (d.at = c.at AND d.src > c.src)))
          AND NOT EXISTS (SELECT 1 FROM g WHERE g.k = c.k AND g.at >= c.at)
        ORDER BY (SELECT MAX(d.src) FROM c d WHERE d.k = c.k) DESC, (SELECT d.pos FROM c d WHERE d.k = c.k ORDER BY d.src DESC LIMIT 1)
      )
    ),
    removed = (
      WITH g AS (${goneCols("COALESCE((SELECT removed FROM day_plans WHERE day = ?), '[]')")} UNION ALL ${goneCols('?')})
      SELECT COALESCE(json_group_array(json_object('id', k, 'editedAt', at)), '[]') FROM (SELECT k, MAX(at) AS at FROM g GROUP BY k ORDER BY k)
    ),
    updated_at = MAX(day_plans.updated_at, excluded.updated_at)`
const luck = () => ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST ? 1 : Math.random())

export class FocusService {
  // `rand` rolls the lucky gift (RG7); under the test runner there is no luck unless a test passes its own.
  constructor(private db: DB, private wallet: Wallet, private rand: () => number = luck) {}

  private sessions(sinceDay: string): FocusSession[] {
    return (this.db.prepare('SELECT id, day, subject, minutes, coins FROM focus_sessions WHERE day >= ? ORDER BY id DESC').all(sinceDay) as FocusSession[]).map((r) => ({
      ...r,
      minutes: Number(r.minutes),
      coins: Number(r.coins)
    }))
  }

  private running(): RunningFocus | null {
    try {
      return readSetting(this.db, RUNNING) as RunningFocus | null
    } catch {
      return null
    }
  }

  private funMin(fromDay: string, toDay: string): number {
    const rows = this.db.prepare("SELECT coins FROM ledger WHERE module = 'fun' AND kind = 'spend' AND day >= ? AND day <= ?").all(fromDay, toDay) as { coins: number }[]
    return rows.reduce((t, r) => t - Number(r.coins), 0)
  }

  plan(day: string): DayPlan {
    const row = this.db.prepare('SELECT * FROM day_plans WHERE day = ?').get(day) as { items: string; review: string | null; reasons: string; removed?: string | null } | undefined
    if (!row) return { day, items: [], review: null, reasons: [] }
    const parse = (s: string | null | undefined) => {
      try {
        const v = JSON.parse(s || '[]')
        return Array.isArray(v) ? v : []
      } catch {
        return []
      }
    }
    return { day, items: parse(row.items), review: row.review, reasons: parse(row.reasons), removed: parse(row.removed) }
  }

  /**
   * Saves the day's must-dos. `p.items` is the list as it should be now.
   * Each must-do has an id (planKey) and the time it was last changed; one
   * that left the list is remembered in `removed` with the time. The statement
   * itself merges with the row that is there (PLAN_MERGE), because a change
   * made offline is replayed later as it is: the newer copy of a must-do wins,
   * one that only the other device has is kept, and one that was removed stays
   * removed unless it was added again later. Nothing changed: nothing written.
   */
  private savePlan(p: DayPlan, now: Date): void {
    const cur = this.plan(p.day)
    const t = now.getTime()
    const was = new Map(cur.items.map((i) => [i.id ?? planKey(i), i]))
    const gone = new Map((cur.removed ?? []).map((g) => [g.id, Number(g.editedAt) || 0]))
    const seen = new Set<string>()
    const items: PlanItem[] = []
    for (const i of p.items) {
      const id = planKey(i)
      if (seen.has(id)) continue
      seen.add(id)
      const old = was.get(id)
      const same = !!old && old.id === id && old.text === i.text && !!old.done === !!i.done && (old.todoistId ?? null) === (i.todoistId ?? null)
      // Later than its own removal, so a must-do added again stays.
      const editedAt = same ? Number(old!.editedAt) || 0 : Math.max(t, (gone.get(id) ?? -1) + 1, (Number(old?.editedAt) || 0) + 1)
      items.push({ text: i.text, done: !!i.done, ...(i.todoistId ? { todoistId: i.todoistId } : {}), id, editedAt })
    }
    const removed: PlanGone[] = [...was].filter(([id]) => !seen.has(id)).map(([id, old]) => ({ id, editedAt: Math.max(t, (Number(old.editedAt) || 0) + 1) }))
    if (!removed.length && JSON.stringify(items) === JSON.stringify(cur.items)) return
    this.db.prepare(PLAN_MERGE).run(...planArgs(p.day, JSON.stringify(items), now.toISOString(), JSON.stringify(removed)))
  }

  /** The evening review's line and reasons: its own write, the must-dos are not touched. */
  private saveReview(day: string, review: string | null, reasons: string[], now: Date): void {
    this.db
      .prepare(
        `INSERT INTO day_plans (day, items, review, reasons, updated_at) VALUES (?, '[]', ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET review = excluded.review, reasons = excluded.reasons, updated_at = MAX(day_plans.updated_at, excluded.updated_at)`
      )
      .run(day, review, JSON.stringify(reasons), now.toISOString())
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
    const goals = (this.db.prepare("SELECT * FROM focus_goals WHERE archived = 0 AND COALESCE(kind, 'hours') = 'hours' ORDER BY deadline").all() as any[]).map((g) => {
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
  start(subject: string, planned = 50, now = new Date(), task: FocusTask | null = null, stages: FocusStage[] | null = null): FocusState {
    const name = String(subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('What are you focusing on? e.g. Math')
    if (this.running()) throw new LedgerError('A focus session is already running: stop it first')
    const minutes = Math.min(180, Math.max(5, Math.round(planned) || 50))
    const t = task && (task.kind === 'mustdo' || task.kind === 'todoist') ? { kind: task.kind, ref: String(task.ref).slice(0, 200), title: String(task.title).slice(0, 200) } : null
    const st = cleanStages(stages)
    writeSetting(this.db, RUNNING, { subject: name, startedAt: now.toISOString(), planned: minutes, task: t, ...(st.length ? { stages: st } : {}) })
    return this.state(now)
  }

  /** IC1: pauses the running timer; paused time doesn't count (and earns nothing). */
  pause(now = new Date()): FocusState {
    const run = this.running()
    if (!run) throw new LedgerError('No focus session is running')
    if (run.pausedAt) return this.state(now)
    writeSetting(this.db, RUNNING, { ...run, pausedAt: now.toISOString(), pausedMs: Math.max(0, Number(run.pausedMs) || 0) })
    return this.state(now)
  }

  /** IC1: goes on after a pause; the end moves later by the time paused. */
  resume(now = new Date()): FocusState {
    const run = this.running()
    if (!run) throw new LedgerError('No focus session is running')
    if (!run.pausedAt) return this.state(now)
    // At most 4 hours of pauses in all (a forgotten pause doesn't hold a timer for days).
    const pausedMs = Math.min(4 * 3600_000, pausedMsOf(run, now.getTime()))
    writeSetting(this.db, RUNNING, { ...run, pausedAt: null, pausedMs })
    return this.state(now)
  }

  /** IC7: a new name for the running timer (its minutes go to the new subject). */
  rename(subject: string, now = new Date()): FocusState {
    const run = this.running()
    if (!run) throw new LedgerError('No focus session is running')
    const name = String(subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('What are you focusing on? e.g. Math')
    writeSetting(this.db, RUNNING, { ...run, subject: name })
    return this.state(now)
  }

  /** Stops the timer and logs the minutes; coins for them (up to the daily limit). */
  stop(now = new Date()): { session: FocusSession; coins: number; state: FocusState; task: FocusTask | null } {
    return this.db.transaction(() => {
      // Read inside the change: a second stop (another device, the bot) finds nothing running.
      const run = this.running()
      if (!run) throw new LedgerError('No focus session is running')
      // IC1: paused time never counts (a pause going on now included).
      const minutes = sessionMinutes(run.startedAt, run.planned, now, pausedMsOf(run, now.getTime()))
      writeSetting(this.db, RUNNING, null)
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
    writeSetting(this.db, RUNNING, { ...run, planned })
    return this.state(now)
  }

  /** Drops the running timer without logging it. */
  cancel(now = new Date()): FocusState {
    writeSetting(this.db, RUNNING, null)
    return this.state(now)
  }

  /** A session you did without the timer: it counts in your stats, but only timed sessions pay (BG11). */
  add(subject: string, minutes: number, day?: string, now = new Date()) {
    const name = String(subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('Which subject?')
    const m = Math.round(minutes)
    if (!(m >= 1 && m <= 600)) throw new LedgerError('Minutes from 1 to 600')
    return this.db.transaction(() => this.log(name, m, now, null, day, false))()
  }

  private log(subject: string, minutes: number, now: Date, startedAt: string | null, day?: string, pays = true) {
    const today = this.wallet.today(now)
    const d = day && day <= today && day >= addDays(today, -14) ? day : today
    const earned = this.sessions(today).filter((s) => s.day === today).reduce((t, s) => t + s.coins, 0)
    const coins = pays && d === today ? Math.max(0, Math.min(focusCoins(minutes), FOCUS_DAILY_COINS - earned)) : 0
    const end = now.toISOString()
    const start = startedAt ?? new Date(now.getTime() - minutes * 60000).toISOString()
    // The same timer logged twice (two devices stopping it): keep the first.
    if (startedAt) {
      const dup = this.db.prepare('SELECT id, day, subject, minutes, coins FROM focus_sessions WHERE started_at = ?').get(startedAt) as { id: number; day: string; subject: string; minutes: number; coins: number } | undefined
      if (dup) return { session: dup, coins: 0, state: this.state(now) }
    }
    const id = Number(
      this.db.prepare('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, ?)').run(d, subject, minutes, start, end, coins).lastInsertRowid
    )
    if (coins > 0 || minutes > 0) {
      const ledgerId = this.wallet.append({ ts: end, day: today, module: 'focus', kind: 'earn', coins, xp: minutes, ruleId: 'focus.session', ref: `focus:${id}`, note: `Focus ${minutes} min · ${subject}` })
      // RG6: a 7-day focus streak adds a small, capped extra to a real, paid session (undone with it).
      if (coins > 0) {
        const live = this.wallet.effective()
        const days = live.filter((e) => e.ruleId === 'focus.session' && e.coins > 0).map((e) => e.day)
        const extra = streakBonus(coins, dayStreak(days, today))
        if (extra) this.wallet.append({ ts: end, day: today, module: 'focus', kind: 'earn', coins: extra, xp: 0, ruleId: null, ref: extraRef(ledgerId, 'streak'), note: `Focus streak bonus (+${Math.round(STREAK_BONUS.pct * 100)}%)` })
      }
    }
    return { session: { id, day: d, subject, minutes, coins }, coins, state: this.state(now) }
  }

  /** Today's 1–3 (up to 5) must-dos. Keeps what was already ticked. */
  setPlan(items: PlanInput[], now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const cur = this.plan(d)
    const next = items
      .map((x) => (typeof x === 'string' ? { text: x, todoistId: null } : x))
      .map((x) => ({ text: String(x.text ?? '').trim().slice(0, 140), todoistId: x.todoistId ? String(x.todoistId) : null }))
      .filter((x) => x.text)
      .map(({ text, todoistId }) => {
        // Same must-do as before: by its Todoist id, else by its words (keeps done and the link).
        const was = cur.items.find((i) => (todoistId && i.todoistId === todoistId) || i.text === text)
        const id = todoistId ?? was?.todoistId ?? null
        return { text, done: was?.done ?? false, ...(id ? { todoistId: id } : {}) }
      })
    if (!next.length) throw new LedgerError('Write at least one must-do')
    // At most 5 are taken from one list; one that is already there is never cut by that.
    const have = new Set(cur.items.map((i) => i.id ?? planKey(i)))
    let room = 5
    this.savePlan({ ...cur, items: next.filter((x) => have.has(planKey(x)) || room-- > 0) }, now)
    return this.plan(d)
  }

  /**
   * The must-dos follow Todoist (core/todoFollow.ts): a linked task renamed,
   * moved to another day or deleted, or done there. Writes the list as given,
   * never unticks, and pays nothing (a task done in Todoist pays through its
   * own Todoist rule). An empty list changes nothing.
   */
  followTodoist(items: PlanItem[], now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const cur = this.plan(d)
    const next = items
      .map((x) => {
        const was = cur.items.find((i) => (x.todoistId && i.todoistId === x.todoistId) || i.text === x.text)
        return { text: String(x.text ?? '').trim().slice(0, 140), done: !!x.done || !!was?.done, ...(x.todoistId ? { todoistId: String(x.todoistId) } : {}) }
      })
      .filter((x) => x.text)
      .slice(0, 5)
    if (!next.length) return cur
    this.savePlan({ ...cur, items: next }, now)
    return this.plan(d)
  }

  /**
   * Takes one must-do off the day's list (a ticked one keeps its points: it
   * was done). Returns it with its place, for Undo (restorePlan).
   */
  removePlan(index: number, now = new Date(), day?: string): { plan: DayPlan; removed: PlanItem; index: number } {
    const d = day ?? this.wallet.today(now)
    const p = this.plan(d)
    const item = p.items[index]
    if (!item) throw new LedgerError('No must-do with that number')
    this.savePlan({ ...p, items: p.items.filter((_, k) => k !== index) }, now)
    return { plan: this.plan(d), removed: item, index }
  }

  /** Undo of removePlan: the must-do is back where it was, ticked as it was (no points are paid again). */
  restorePlan(item: Pick<PlanItem, 'text' | 'done' | 'todoistId'>, index: number, now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const p = this.plan(d)
    const text = String(item.text ?? '').trim().slice(0, 140)
    if (!text) throw new LedgerError('Nothing to put back')
    const back: PlanItem = { text, done: !!item.done, ...(item.todoistId ? { todoistId: String(item.todoistId) } : {}) }
    const rest = p.items.filter((i) => (i.id ?? planKey(i)) !== planKey(back))
    const at = Math.max(0, Math.min(rest.length, Math.round(index) || 0))
    this.savePlan({ ...p, items: [...rest.slice(0, at), back, ...rest.slice(at)] }, now)
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
          const ledgerId = this.wallet.append({ ts: now.toISOString(), day: d, module: 'plan', kind: 'earn', coins: PLAN_ITEM_COINS, xp: 15, ruleId: 'plan.item_done', ref, note: `Must-do: ${item.text.slice(0, 80)}` })
          coins = PLAN_ITEM_COINS
          // RG7: now and then a finished must-do brings a lucky gift (capped a day, undone with the must-do).
          const lucky = luckyRoll(this.rand(), entries.filter((e) => e.day === d && isExtra(e, 'lucky')).length)
          if (lucky) {
            this.wallet.append({ ts: now.toISOString(), day: d, module: 'plan', kind: 'earn', coins: lucky, xp: 0, ruleId: null, ref: extraRef(ledgerId, 'lucky'), note: `Lucky +${lucky} for a finished must-do` })
            coins += lucky
          }
        }
      }
      // Unticked: a lucky gift that came with it goes back (it was only for finishing it).
      if (!item.done) {
        const ref = `plan:${d}:${item.text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`
        const live = this.wallet.effective()
        const paid = live.find((e) => e.ref === ref)
        const gift = paid && live.find((e) => e.ref === extraRef(paid.id, 'lucky'))
        if (gift) {
          try {
            this.wallet.undo(gift.id, 'Must-do unticked', now)
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e
          }
        }
      }
      return { plan: this.plan(d), coins }
    })()
  }

  /** The evening review: what got in the way, a line about the day. */
  review(text: string | null, reasons: string[], now = new Date(), day?: string): DayPlan {
    const d = day ?? this.wallet.today(now)
    const p = this.plan(d)
    this.saveReview(d, text?.trim().slice(0, 500) || p.review, [...new Set(reasons.map((r) => String(r).slice(0, 40)))].slice(0, 6), now)
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

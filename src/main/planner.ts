import { effective, LedgerError } from '@core/ledger'
import {
  BLOCK_RULES, blockOn, blocksToMiss, finishAllowedAt, isOverdue, planFinish, planSkip, planTaskComplete, sortTasks,
  taskOn, TASKS_DAILY_COIN_CAP, validateBlock, validateTask, type Block, type BlockStatus, type Task
} from '@core/plan'
import type { BlockInput, BlockView, Category, ScheduleState, TaskInput, TasksState, TaskView } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import type { ShieldService } from './shields'

interface TaskRow {
  id: number
  title: string
  category: string
  coins: number
  xp: number
  priority: 1 | 2 | 3
  due: string | null
  repeat: Task['repeat']
  weekdays: number
  notes: string | null
  created_day: string
}

interface BlockRow {
  id: number
  title: string
  kind: Block['kind']
  start: string
  minutes: number
  weekdays: number
  date: string | null
  remind_min: number
  created_day: string
}

interface LogRow {
  block_id: number
  day: string
  status: Exclude<BlockStatus, 'pending'>
  started_at: string | null
  ledger_id: number | null
}

const toTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, category: r.category, coins: r.coins, xp: r.xp, priority: r.priority, due: r.due,
  repeat: r.repeat, weekdays: r.weekdays, notes: r.notes, createdDay: r.created_day
})

const toBlock = (r: BlockRow): Block => ({
  id: r.id, title: r.title, kind: r.kind, start: r.start, minutes: r.minutes, weekdays: r.weekdays, date: r.date,
  remindMin: r.remind_min, createdDay: r.created_day
})

/** Local wall-clock time on a day key, as an instant. */
export function atLocal(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00`)
}


export interface EconomyBuffChecker {
  isBuffActive(effectKind: string, now?: Date): boolean
  getBuffMultiplier(effectKind: string, now?: Date): number
}

export class Tasks {
  private economy?: EconomyBuffChecker
  constructor(private db: DB, private wallet: Wallet, private shieldService?: ShieldService) {}

  setEconomy(economy: EconomyBuffChecker): void {
    this.economy = economy
  }

  private liveLedgerIds(): Set<number> {
    return new Set(effective(this.wallet.entries()).map((e) => e.id))
  }

  /** Days each task was completed, ignoring completions undone in History. */
  private doneDays(live: Set<number>): Map<number, Set<string>> {
    const out = new Map<number, Set<string>>()
    const rows = this.db.prepare('SELECT task_id, day, ledger_id FROM task_done').all() as { task_id: number; day: string; ledger_id: number }[]
    for (const r of rows) {
      if (!live.has(r.ledger_id)) continue
      if (!out.has(r.task_id)) out.set(r.task_id, new Set())
      out.get(r.task_id)!.add(r.day)
    }
    return out
  }

  private task(id: number): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ? AND archived = 0').get(id) as TaskRow | undefined
    if (!row) throw new LedgerError('Task not found')
    return toTask(row)
  }

  private coinsToday(today: string): number {
    return effective(this.wallet.entries())
      .filter((e) => e.module === 'tasks' && e.day === today && e.ref?.startsWith('task:'))
      .reduce((s, e) => s + Math.max(0, e.coins), 0)
  }

  categories(): Category[] {
    return this.db.prepare('SELECT id, label, color FROM categories WHERE archived = 0 ORDER BY sort, label').all() as Category[]
  }

  state(now = new Date()): TasksState {
    const today = this.wallet.today(now)
    const live = this.liveLedgerIds()
    const done = this.doneDays(live)
    const rows = (this.db.prepare('SELECT * FROM tasks WHERE archived = 0').all() as TaskRow[]).map(toTask)
    const views: TaskView[] = []
    for (const t of rows) {
      const days = done.get(t.id) ?? new Set<string>()
      if (!taskOn(t, today, days)) continue
      const sorted = [...days].sort()
      views.push({
        ...t,
        done: t.repeat === 'none' ? days.size > 0 : days.has(today),
        overdue: isOverdue(t, today, days),
        lastDone: sorted[sorted.length - 1] ?? null
      })
    }
    return { today, categories: this.categories(), tasks: sortTasks(views), coinsToday: this.coinsToday(today), dailyCap: TASKS_DAILY_COIN_CAP }
  }

  save(input: TaskInput, now = new Date()): void {
    const t = { ...input, title: input.title.trim(), notes: input.notes?.trim() || null, due: input.due || null }
    validateTask(t)
    if (!this.categories().some((c) => c.id === t.category)) throw new LedgerError('Unknown category')
    const params = { title: t.title, category: t.category, coins: t.coins, xp: t.xp, priority: t.priority, due: t.due, repeat: t.repeat, weekdays: t.weekdays, notes: t.notes }
    if (input.id) {
      this.task(input.id)
      this.db.prepare('UPDATE tasks SET title=@title, category=@category, coins=@coins, xp=@xp, priority=@priority, due=@due, repeat=@repeat, weekdays=@weekdays, notes=@notes WHERE id=@id').run({ ...params, id: input.id })
    } else {
      this.db.prepare('INSERT INTO tasks (title, category, coins, xp, priority, due, repeat, weekdays, notes, created_day) VALUES (@title, @category, @coins, @xp, @priority, @due, @repeat, @weekdays, @notes, @createdDay)').run({ ...params, createdDay: this.wallet.today(now) })
    }
  }

  archive(id: number): void {
    this.task(id)
    this.db.prepare('UPDATE tasks SET archived = 1 WHERE id = ?').run(id)
  }

  complete(id: number, now = new Date()): number {
    return this.db.transaction(() => {
      const t = this.task(id)
      const today = this.wallet.today(now)
      const days = this.doneDays(this.liveLedgerIds()).get(id) ?? new Set<string>()
      let { coins, xp } = planTaskComplete(t, today, days, this.coinsToday(today))
      if (this.economy?.isBuffActive('multiplier_boost', now)) {
        const mult = this.economy.getBuffMultiplier('multiplier_boost', now) || 2.0
        coins = Math.round(coins * mult)
      }
      if (this.economy?.isBuffActive('xp_boost', now)) {
        const xpMult = this.economy.getBuffMultiplier('xp_boost', now) || 1.5
        xp = Math.round(xp * xpMult)
      }
      const ledgerId = this.wallet.append({ ts: now.toISOString(), day: today, module: 'tasks', kind: 'earn', coins, xp, ref: `task:${id}`, note: t.title })
      // A row left behind by a completion that was undone in History.
      this.db.prepare('DELETE FROM task_done WHERE task_id = ? AND day = ?').run(id, today)
      this.db.prepare('INSERT INTO task_done (task_id, day, ledger_id) VALUES (?, ?, ?)').run(id, today, ledgerId)

      // Perk: Shadow Monarch's Extraction (Level 50)
      if (t.priority === 1) {
        try {
          const summary = this.wallet.summary(now)
          const hasExtraction = summary.level.perks.some((p) => p.id === 'shadow_monarch_extraction' && p.unlocked)
          if (hasExtraction) {
            const currentStreak = parseInt(getSetting(this.db, 'perk.shadow_monarch.p1_streak') || '0', 10) + 1
            if (currentStreak >= 7) {
              setSetting(this.db, 'perk.shadow_monarch.p1_streak', '0')
              this.shieldService?.awardFreeShield('Shadow Monarch Extraction: 7 consecutive P1 tasks')
            } else {
              setSetting(this.db, 'perk.shadow_monarch.p1_streak', String(currentStreak))
            }
          }
        } catch {
          // Perk non-fatal
        }
      }

      return ledgerId
    }).immediate()
  }

  uncomplete(id: number, now = new Date()): void {
    this.db.transaction(() => {
      const t = this.task(id)
      const today = this.wallet.today(now)
      const live = this.liveLedgerIds()
      const rows = this.db.prepare('SELECT day, ledger_id FROM task_done WHERE task_id = ?').all(id) as { day: string; ledger_id: number }[]
      const row = rows.find((r) => live.has(r.ledger_id) && (t.repeat === 'none' || r.day === today))
      if (!row) throw new LedgerError('This task is not done')
      this.wallet.undo(row.ledger_id, 'Task unticked', now)
      this.db.prepare('DELETE FROM task_done WHERE task_id = ? AND day = ?').run(id, row.day)
    }).immediate()
  }

  saveCategory(c: Category): void {
    const id = c.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (!id || !c.label.trim()) throw new LedgerError('A category needs a name')
    if (!/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new LedgerError('Color must look like #A1B2C3')
    this.db
      .prepare(
        `INSERT INTO categories (id, label, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories))
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color, archived = 0`
      )
      .run(id, c.label.trim(), c.color)
  }

  archiveCategory(id: string): void {
    this.db.prepare('UPDATE categories SET archived = 1 WHERE id = ?').run(id)
  }
}

export class Schedule {
  private economy?: EconomyBuffChecker
  constructor(private db: DB, private wallet: Wallet) {}

  setEconomy(economy: EconomyBuffChecker): void {
    this.economy = economy
  }

  private blocks(): Block[] {
    return (this.db.prepare('SELECT * FROM blocks WHERE archived = 0 ORDER BY start').all() as BlockRow[]).map(toBlock)
  }

  private block(id: number): Block {
    const row = this.db.prepare('SELECT * FROM blocks WHERE id = ? AND archived = 0').get(id) as BlockRow | undefined
    if (!row) throw new LedgerError('Block not found')
    return toBlock(row)
  }

  private log(id: number, day: string): LogRow | undefined {
    return this.db.prepare('SELECT * FROM block_log WHERE block_id = ? AND day = ?').get(id, day) as LogRow | undefined
  }

  /** Pays out a block's rule if it has one; limits that block it just mean no coins. */
  private payout(ruleId: string | null, b: Block, day: string, now: Date): number | null {
    if (!ruleId) return null
    try {
      return this.wallet.awardRule(ruleId, { now, day, ref: `block:${b.id}:${day}`, note: b.title })
    } catch (e) {
      if (e instanceof LedgerError) return null
      throw e
    }
  }

  /** Closes study blocks from past days that were left open, with the skip penalty. */
  closeMissed(now = new Date()): number {
    const today = this.wallet.today(now)
    const closed = new Set(
      (this.db.prepare("SELECT block_id, day FROM block_log WHERE status != 'running'").all() as { block_id: number; day: string }[]).map((r) => `${r.block_id}:${r.day}`)
    )
    const misses = blocksToMiss(this.blocks(), closed, today)
    this.db.transaction(() => {
      for (const { block, day } of misses) {
        const ledgerId = this.payout(BLOCK_RULES[block.kind].skipped, block, day, now)
        this.db
          .prepare(
            `INSERT INTO block_log (block_id, day, status, ended_at, ledger_id) VALUES (?, ?, 'missed', ?, ?)
             ON CONFLICT(block_id, day) DO UPDATE SET status = 'missed', ended_at = excluded.ended_at, ledger_id = excluded.ledger_id`
          )
          .run(block.id, day, now.toISOString(), ledgerId)
      }
    })()
    return misses.length
  }

  state(day?: string, now = new Date()): ScheduleState {
    this.closeMissed(now)
    const today = this.wallet.today(now)
    const d = day ?? today
    const views: BlockView[] = this.blocks()
      .filter((b) => blockOn(b, d))
      .map((b) => {
        const log = this.log(b.id, d)
        const startsAt = atLocal(d, b.start)
        return {
          ...b,
          day: d,
          status: log?.status ?? 'pending',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + b.minutes * 60_000).toISOString(),
          startedAt: log?.started_at ?? null,
          finishAllowedAt: log?.status === 'running' && log.started_at ? finishAllowedAt(log.started_at, b.minutes).toISOString() : null
        }
      })
    return { day: d, today, blocks: views, all: this.blocks() }
  }

  save(input: BlockInput, now = new Date()): void {
    const b = { ...input, title: input.title.trim(), date: input.date || null, weekdays: input.date ? 0 : input.weekdays }
    validateBlock(b)
    const params = { title: b.title, kind: b.kind, start: b.start, minutes: b.minutes, weekdays: b.weekdays, date: b.date, remindMin: b.remindMin }
    if (input.id) {
      this.block(input.id)
      this.db.prepare('UPDATE blocks SET title=@title, kind=@kind, start=@start, minutes=@minutes, weekdays=@weekdays, date=@date, remind_min=@remindMin WHERE id=@id').run({ ...params, id: input.id })
    } else {
      this.db.prepare('INSERT INTO blocks (title, kind, start, minutes, weekdays, date, remind_min, created_day) VALUES (@title, @kind, @start, @minutes, @weekdays, @date, @remindMin, @createdDay)').run({ ...params, createdDay: this.wallet.today(now) })
    }
  }

  archive(id: number): void {
    this.block(id)
    this.db.prepare('UPDATE blocks SET archived = 1 WHERE id = ?').run(id)
  }

  private todayBlock(id: number, now: Date): { b: Block; day: string; log: LogRow | undefined } {
    const b = this.block(id)
    const day = this.wallet.today(now)
    if (!blockOn(b, day)) throw new LedgerError('This block is not on today')
    return { b, day, log: this.log(id, day) }
  }

  start(id: number, now = new Date()): void {
    const { b, day, log } = this.todayBlock(id, now)
    if (log) throw new LedgerError(log.status === 'running' ? 'Already running' : 'This block is already closed')
    const running = this.db.prepare("SELECT b.title FROM block_log l JOIN blocks b ON b.id = l.block_id WHERE l.day = ? AND l.status = 'running'").get(day) as { title: string } | undefined
    if (running) throw new LedgerError(`Finish or skip "${running.title}" first`)
    this.db.prepare("INSERT INTO block_log (block_id, day, status, started_at) VALUES (?, ?, 'running', ?)").run(b.id, day, now.toISOString())
  }

  finish(id: number, now = new Date()): void {
    this.db.transaction(() => {
      const { b, day, log } = this.todayBlock(id, now)
      planFinish(log?.status ?? 'pending', log?.started_at ?? null, b.minutes, now)
      const ledgerId = this.payout(BLOCK_RULES[b.kind].done, b, day, now)
      this.db.prepare("UPDATE block_log SET status = 'done', ended_at = ?, ledger_id = ? WHERE block_id = ? AND day = ?").run(now.toISOString(), ledgerId, b.id, day)

      // Perk: Iron Focus (INT 25)
      if (ledgerId && b.kind === 'study') {
        try {
          const summary = this.wallet.summary(now)
          const hasIronFocus = summary.level.perks.some((p) => p.id === 'iron_focus' && p.unlocked)
          if (hasIronFocus) {
            const entry = this.wallet.entries().find((e) => e.id === ledgerId)
            const baseCoins = entry?.coins ?? 0
            if (baseCoins > 0) {
              const bonusCoins = Math.max(1, Math.round(baseCoins * 0.2))
              this.wallet.append({
                ts: now.toISOString(),
                day,
                module: 'perks',
                kind: 'earn',
                coins: bonusCoins,
                xp: 0,
                ref: `perk:iron_focus:${b.id}:${day}`,
                note: 'Perk: Iron Focus (+20% coins)'
              })
            }
          }
        } catch {
          // Perk non-fatal
        }
      }
    }).immediate()
  }

  skip(id: number, now = new Date()): void {
    this.db.transaction(() => {
      const { b, day, log } = this.todayBlock(id, now)
      planSkip(log?.status ?? 'pending')
      const ledgerId = this.payout(BLOCK_RULES[b.kind].skipped, b, day, now)
      this.db
        .prepare(
          `INSERT INTO block_log (block_id, day, status, ended_at, ledger_id) VALUES (?, ?, 'skipped', ?, ?)
           ON CONFLICT(block_id, day) DO UPDATE SET status = 'skipped', ended_at = excluded.ended_at, ledger_id = excluded.ledger_id`
        )
        .run(b.id, day, now.toISOString(), ledgerId)
    }).immediate()
  }
}

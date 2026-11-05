import { dayKey } from '@core/dates'
import { balance, LedgerError, planUndo, totalXp, effective, type LedgerEntry, type NewEntry } from '@core/ledger'
import { levelInfo, type StatAllocation } from '@core/levels'
import { planAward, type Rule } from '@core/rules'
import { questRef, questState, type QuestState } from '@core/quests'
import type { Summary } from '@shared/api'
import type { DB } from './db'

interface LedgerRow {
  id: number
  ts: string
  day: string
  module: string
  kind: LedgerEntry['kind']
  coins: number
  xp: number
  rule_id: string | null
  ref: string | null
  note: string | null
  undo_of: number | null
}

interface RuleRow {
  id: string
  module: string
  title: string
  coins: number
  xp: number
  daily_cap: number
  cooldown_min: number
  enabled: number
}

const toEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id, ts: r.ts, day: r.day, module: r.module, kind: r.kind, coins: r.coins, xp: r.xp,
  ruleId: r.rule_id, ref: r.ref, note: r.note, undoOf: r.undo_of
})

const toRule = (r: RuleRow): Rule => ({
  id: r.id, module: r.module, title: r.title, coins: r.coins, xp: r.xp,
  dailyCap: r.daily_cap, cooldownMin: r.cooldown_min, enabled: !!r.enabled
})

/** Database side of the wallet; all decisions are made by the pure core. */
export class Wallet {
  constructor(private db: DB, private timeZone?: string) {}

  entries(): LedgerEntry[] {
    return (this.db.prepare('SELECT * FROM ledger ORDER BY id').all() as LedgerRow[]).map(toEntry)
  }

  /** Appends a row the core already validated. Call inside a transaction. */
  append(e: NewEntry): number {
    const res = this.db
      .prepare(
        `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note, undo_of)
         VALUES (@ts, @day, @module, @kind, @coins, @xp, @ruleId, @ref, @note, @undoOf)`
      )
      .run({ ruleId: null, ref: null, note: null, undoOf: null, ...e })
    return Number(res.lastInsertRowid)
  }

  getStatAllocation(): StatAllocation {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'hunter.stat_allocation'").get() as { value: string } | undefined
      if (!row?.value) return { str: 0, agi: 0, vit: 0, int: 0, sen: 0 }
      const parsed = JSON.parse(row.value)
      return {
        str: Math.max(0, Math.floor(Number(parsed.str) || 0)),
        agi: Math.max(0, Math.floor(Number(parsed.agi) || 0)),
        vit: Math.max(0, Math.floor(Number(parsed.vit) || 0)),
        int: Math.max(0, Math.floor(Number(parsed.int) || 0)),
        sen: Math.max(0, Math.floor(Number(parsed.sen) || 0))
      }
    } catch {
      return { str: 0, agi: 0, vit: 0, int: 0, sen: 0 }
    }
  }

  saveStatAllocation(alloc: StatAllocation): void {
    this.db.prepare(
      `INSERT INTO settings (key, value) VALUES ('hunter.stat_allocation', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(JSON.stringify(alloc))
  }

  allocateStats(stat: 'str' | 'agi' | 'vit' | 'int' | 'sen', points = 1): Summary {
    if (points <= 0) return this.summary()
    const current = this.summary()
    if (current.level.attributes.unallocatedPoints < points) {
      throw new LedgerError('Not enough unallocated stat points available')
    }
    const alloc = this.getStatAllocation()
    alloc[stat] = (alloc[stat] ?? 0) + points
    this.saveStatAllocation(alloc)
    return this.summary()
  }

  resetStatAllocation(): Summary {
    this.saveStatAllocation({ str: 0, agi: 0, vit: 0, int: 0, sen: 0 })
    return this.summary()
  }

  summary(now = new Date()): Summary {
    const today = dayKey(now, this.timeZone)
    const totals = (this.db.prepare(`
      SELECT 
        COALESCE(SUM(coins), 0) AS balance,
        COALESCE(SUM(CASE WHEN xp > 0 THEN xp ELSE 0 END), 0) AS total_xp
      FROM ledger
      WHERE kind != 'undo'
        AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
    `).get() as { balance: number; total_xp: number }) ?? { balance: 0, total_xp: 0 }

    const todayRows = (this.db.prepare(`
      SELECT * FROM ledger
      WHERE day = ?
        AND kind != 'undo'
        AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
      ORDER BY id ASC
    `).all(today) as LedgerRow[]).map(toEntry)

    const recentRows = (this.db.prepare(`
      SELECT * FROM ledger ORDER BY id DESC LIMIT 12
    `).all() as LedgerRow[]).map(toEntry)

    const xp = totals.total_xp
    const allocated = this.getStatAllocation()
    let hunterStats: any = { allocated }
    try {
      const workoutCount = (this.db.prepare("SELECT COUNT(*) as c FROM workouts").get() as any)?.c ?? 0
      const cleanStreakDays = (this.db.prepare("SELECT COUNT(*) as c FROM discipline_events WHERE kind = 'checkin'").get() as any)?.c ?? 0
      const focusBlocksCount = (this.db.prepare("SELECT COUNT(*) as c FROM block_log WHERE status = 'done'").get() as any)?.c ?? 0
      const onTimeWakeups = (this.db.prepare("SELECT COUNT(*) as c FROM sleep_logs WHERE on_time = 1").get() as any)?.c ?? 0
      const budgetDays = (this.db.prepare("SELECT COUNT(*) as c FROM reward_vault_ledger WHERE kind = 'surplus_credit'").get() as any)?.c ?? 0
      hunterStats = { workoutCount, cleanStreakDays, focusBlocksCount, onTimeWakeups, budgetDays, allocated }
    } catch {
      // fallback
    }

    return {
      balance: totals.balance,
      totalXp: xp,
      level: levelInfo(xp, hunterStats),
      today,
      todayCoins: todayRows.reduce((s, e) => s + e.coins, 0),
      todayXp: todayRows.reduce((s, e) => s + e.xp, 0),
      todayRules: [...new Set(todayRows.map((e) => e.ruleId).filter(Boolean) as string[])],
      recent: recentRows
    }
  }

  history(limit = 100): LedgerEntry[] {
    const rows = this.db.prepare('SELECT * FROM ledger ORDER BY id DESC LIMIT ?').all(limit) as LedgerRow[]
    return rows.map(toEntry)
  }

  rules(): Rule[] {
    return (this.db.prepare('SELECT * FROM rules ORDER BY sort, id').all() as RuleRow[]).map(toRule)
  }

  rule(id: string): Rule {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined
    if (!row) throw new LedgerError(`Unknown rule ${id}`)
    return toRule(row)
  }

  saveRule(rule: Rule): void {
    if (!rule.id.trim() || !rule.title.trim()) throw new LedgerError('A rule needs an id and a title')
    for (const n of [rule.coins, rule.xp, rule.dailyCap, rule.cooldownMin]) {
      if (!Number.isInteger(n)) throw new LedgerError('Numbers must be whole numbers')
    }
    if (rule.xp < 0 || rule.dailyCap < 0 || rule.cooldownMin < 0) throw new LedgerError('XP, cap and cooldown cannot be negative')
    this.db
      .prepare(
        `INSERT INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
         VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled,
                 COALESCE((SELECT sort FROM rules WHERE id = @id), (SELECT COALESCE(MAX(sort), 0) + 1 FROM rules)))
         ON CONFLICT(id) DO UPDATE SET module = excluded.module, title = excluded.title, coins = excluded.coins,
           xp = excluded.xp, daily_cap = excluded.daily_cap, cooldown_min = excluded.cooldown_min, enabled = excluded.enabled`
      )
      .run({ ...rule, enabled: rule.enabled ? 1 : 0 })
  }

  award(ruleId: string, note?: string, now = new Date()): number {
    return this.awardRule(ruleId, { note, now })
  }

  /** Awards a rule; `day` books it on another day (e.g. a missed block from yesterday). */
  awardRule(ruleId: string, opts: { note?: string; now?: Date; day?: string; ref?: string } = {}): number {
    const now = opts.now ?? new Date()
    return this.db.transaction(() => {
      const row = planAward(this.rule(ruleId), this.entries(), now, opts.day ?? dayKey(now, this.timeZone), opts.note)
      return this.append({ ...row, ref: opts.ref ?? null })
    }).immediate()
  }

  /**
   * The one way to pay a reward for a thing that happened (P4): rule, the day
   * it counts for, and a ref naming the thing ("bed:2026-11-04", "fin:logged:…").
   * Paid at most once per ref (a ref whose payment was undone can be paid
   * again); a rule that is off or a day's limit used returns 0. Returns the
   * ledger id, or 0 when nothing was paid.
   */
  payOnce(ruleId: string, opts: { day?: string; ref: string; note?: string; now?: Date }): number {
    const now = opts.now ?? new Date()
    return this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id FROM ledger WHERE ref = ? AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL)').all(opts.ref) as { id: number }[]
      if (rows.length) return 0
      try {
        return this.awardRule(ruleId, { now, day: opts.day, ref: opts.ref, note: opts.note })
      } catch (e) {
        if (e instanceof LedgerError) return 0
        throw e
      }
    })()
  }

  quests(now = new Date()): QuestState {
    return questState(this.today(now), this.entries())
  }

  /** Pays the daily quest bonus once all three are done. */
  claimQuests(now = new Date()): number {
    return this.db.transaction(() => {
      const q = this.quests(now)
      if (!q.allDone) throw new LedgerError('Finish all three quests first')
      if (q.claimed) throw new LedgerError('Already claimed today')
      return this.append({ ts: now.toISOString(), day: q.day, module: 'quests', kind: 'earn', coins: q.bonus.coins, xp: q.bonus.xp, ref: questRef(q.day), note: 'Daily quests complete' })
    }).immediate()
  }

  today(now = new Date()): string {
    return dayKey(now, this.timeZone)
  }

  undo(id: number, note: string, now = new Date()): number {
    return this.db.transaction(() => {
      const row = planUndo(this.entries(), id, note, now.toISOString(), dayKey(now, this.timeZone))
      return this.append(row)
    }).immediate()
  }
}

import { dayKey } from '@core/dates'
import { balance, LedgerError, planUndo, totalXp, effective, type LedgerEntry, type NewEntry } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { planAward, type Rule } from '@core/rules'
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

  private insert(e: NewEntry): number {
    const res = this.db
      .prepare(
        `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note, undo_of)
         VALUES (@ts, @day, @module, @kind, @coins, @xp, @ruleId, @ref, @note, @undoOf)`
      )
      .run({ ruleId: null, ref: null, note: null, undoOf: null, ...e })
    return Number(res.lastInsertRowid)
  }

  summary(now = new Date()): Summary {
    const all = this.entries()
    const today = dayKey(now, this.timeZone)
    const live = effective(all).filter((e) => e.day === today)
    const xp = totalXp(all)
    return {
      balance: balance(all),
      totalXp: xp,
      level: levelInfo(xp),
      today,
      todayCoins: live.reduce((s, e) => s + e.coins, 0),
      todayXp: live.reduce((s, e) => s + e.xp, 0),
      recent: all.slice(-12).reverse()
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
    return this.db.transaction(() => {
      const row = planAward(this.rule(ruleId), this.entries(), now, dayKey(now, this.timeZone), note)
      return this.insert(row)
    }).immediate()
  }

  undo(id: number, note: string, now = new Date()): number {
    return this.db.transaction(() => {
      const row = planUndo(this.entries(), id, note, now.toISOString(), dayKey(now, this.timeZone))
      return this.insert(row)
    }).immediate()
  }
}

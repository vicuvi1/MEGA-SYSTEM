import type { Bridge } from './bridge'
import { createMockApi } from './mock'
import { TursoClient } from '@core/tursoClient'
import { dayKey } from '@core/dates'
import { levelInfo } from '@core/levels'

const DEFAULT_URL = 'https://life-os-vicuvi1.aws-eu-central-1.turso.io'
const DEFAULT_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMyNzg3ODIsImlkIjoiMDFhMTg3YmMtZTMwMS03NjMxLTk1ZWItOTZlZWYwZjliYWI5Iiwia2lkIjoiaTR0SmlyVldhQWpaMjBqVGl4amV0djdlX01Takk3VjJoYjJETHdPY0ZlMCIsInJpZCI6IjNjOGYwZjRlLTU4N2ItNDQzNy05ZTJiLWFlNDVhMDI4Mjg5MiJ9.zgJsjcY3LncWY_DHcmQmbPaZBybHd1xff3Cwi3RTpHPfEo2XU_nCUa2VYS0VFmVKKntzCXR9ZV7Vh2geaIdyCA'

export function getTursoConfig(): { url: string; token: string } {
  const envUrl = (import.meta as any).env?.VITE_TURSO_URL
  const envToken = (import.meta as any).env?.VITE_TURSO_TOKEN
  const localUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('turso_url') : null
  const localToken = typeof localStorage !== 'undefined' ? localStorage.getItem('turso_token') : null

  return {
    url: localUrl || envUrl || DEFAULT_URL,
    token: localToken || envToken || DEFAULT_TOKEN
  }
}

export function createTursoWebBridge(): Bridge {
  const base = createMockApi()
  const cfg = getTursoConfig()
  const client = new TursoClient({ url: cfg.url, authToken: cfg.token })

  return {
    ...base,
    wallet: {
      ...base.wallet,
      summary: async () => {
        try {
          const today = dayKey(new Date())
          const totals = await client.query<{ balance: number; total_xp: number }>(`
            SELECT 
              COALESCE(SUM(coins), 0) AS balance,
              COALESCE(SUM(CASE WHEN xp > 0 THEN xp ELSE 0 END), 0) AS total_xp
            FROM ledger
            WHERE kind != 'undo'
              AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
          `)
          const balance = totals[0]?.balance ?? 0
          const totalXp = totals[0]?.total_xp ?? 0

          const todayRows = await client.query<any>(`
            SELECT * FROM ledger
            WHERE day = ?
              AND kind != 'undo'
              AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
            ORDER BY id ASC
          `, [today])

          const recent = await client.query<any>(`SELECT * FROM ledger ORDER BY id DESC LIMIT 12`)

          const statsQuery = await client.query<any>(`
            SELECT 
              (SELECT COUNT(*) FROM workouts) as workoutCount,
              (SELECT COUNT(*) FROM discipline_events WHERE kind = 'checkin') as cleanStreakDays,
              (SELECT COUNT(*) FROM block_log WHERE status = 'done') as focusBlocksCount,
              (SELECT COUNT(*) FROM sleep_logs WHERE on_time = 1) as onTimeWakeups,
              (SELECT COUNT(*) FROM reward_vault_ledger WHERE kind = 'surplus_credit') as budgetDays
          `)
          const hunterStats = statsQuery[0] || {}

          return {
            balance,
            totalXp,
            level: levelInfo(totalXp, hunterStats),
            today,
            todayCoins: todayRows.reduce((s, e) => s + (e.coins || 0), 0),
            todayXp: todayRows.reduce((s, e) => s + (e.xp || 0), 0),
            todayRules: [...new Set(todayRows.map((e) => e.rule_id).filter(Boolean))],
            recent: recent.map((r) => ({
              id: r.id,
              ts: r.ts,
              day: r.day,
              module: r.module,
              kind: r.kind,
              coins: r.coins,
              xp: r.xp,
              ruleId: r.rule_id,
              ref: r.ref,
              note: r.note,
              undoOf: r.undo_of
            }))
          }
        } catch (e) {
          console.warn('[Turso Web Fallback] wallet.summary:', e)
          return base.wallet.summary()
        }
      },
      award: async (ruleId: string, note?: string) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const ruleRows = await client.query<any>('SELECT * FROM rules WHERE id = ?', [ruleId])
          const rule = ruleRows[0] || { coins: 5, xp: 10, module: 'general', title: ruleId }

          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note)
             VALUES (?, ?, ?, 'earn', ?, ?, ?, null, ?)`,
            [now.toISOString(), day, rule.module, rule.coins, rule.xp, ruleId, note || rule.title]
          )
        } catch (e) {
          console.warn('[Turso Web] award error:', e)
        }
        return base.wallet.award(ruleId, note)
      }
    },
    discipline: {
      ...base.discipline,
      checkIn: async () => {
        try {
          const now = new Date()
          const day = dayKey(now)
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('checkin', ?, ?)`,
            [day, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'discipline', 'earn', 20, 40, 'discipline.checkin', 'Clean day check-in')`,
            [now.toISOString(), day]
          )
        } catch (e) {
          console.warn('[Turso Web] checkIn error:', e)
        }
        return base.discipline.checkIn()
      },
      oath: async () => {
        try {
          const now = new Date()
          const day = dayKey(now)
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('oath', ?, ?)`,
            [day, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'discipline', 'earn', 3, 5, 'discipline.oath', 'Spartan morning oath sworn')`,
            [now.toISOString(), day]
          )
        } catch (e) {
          console.warn('[Turso Web] oath error:', e)
        }
        return base.discipline.oath()
      }
    },
    money: {
      ...base.money,
      addExpense: async (amountBani: number, category: string, note?: string) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const rounded = Math.round(amountBani)
          await client.execute(
            `INSERT INTO expenses (day, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)`,
            [day, rounded, category.trim(), note?.trim() || null, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'money', 'earn', 3, 0, 'money.logged', ?)`,
            [now.toISOString(), day, `Logged expense: ${category}`]
          )
        } catch (e) {
          console.warn('[Turso Web] addExpense error:', e)
        }
        return base.money.addExpense(amountBani, category, note)
      }
    }
  }
}

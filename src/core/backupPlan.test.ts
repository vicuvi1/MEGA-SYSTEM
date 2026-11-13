import { describe, expect, it } from 'vitest'
import { backupTables, backupsToDelete, dailyBackupName, fkOrder, localBackupsToDelete, markRestoredApps, parseLocalBackup, restorePlan, restoreStatements, riskBackupName, runRestorePlan, settingCopy } from './backupPlan'

describe('backups', () => {
  it('backs up every data table, not the plumbing', () => {
    expect(backupTables(['tasks', 'focus_sessions', 'day_plans', 'cloud_snapshots', 'cloud_snapshot_parts', 'restore_stage_tasks', 'desktop_outbox', 'bot_seen_updates', 'sqlite_sequence', 'ledger'])).toEqual(['day_plans', 'focus_sessions', 'ledger', 'tasks'])
  })

  it('restore replaces tables, only adds missing history, keeps the PIN and moves the data marker', () => {
    const snap = {
      version: 2,
      exportedAt: 'x',
      tables: {
        tasks: [{ id: 1, title: 'Read', gone_column: 'x' }],
        ledger: [{ id: 1, coins: 5 }],
        settings: [{ key: 'pin_hash', value: 'old' }, { key: 'coach_style', value: '{"tone":4}' }],
        focus_sessions: [{ id: 3, subject: 'Math' }],
        not_here_anymore: [{ id: 1 }]
      }
    }
    const cols = { tasks: ['id', 'title'], ledger: ['id', 'coins'], settings: ['key', 'value'], focus_sessions: ['id', 'subject'] }
    const s = restoreStatements(snap, cols, 'v9')
    const sql = s.map((x) => x.sql)
    expect(sql).toContain('DELETE FROM "tasks"')
    expect(sql).not.toContain('DELETE FROM "ledger"')
    expect(sql).not.toContain('DELETE FROM "settings"')
    expect(sql).toContain('INSERT OR IGNORE INTO "ledger" ("id", "coins") SELECT "id", "coins" FROM "restore_stage_ledger" WHERE rowid BETWEEN 1 AND 1 ORDER BY rowid')
    expect(sql).toContain('INSERT INTO "restore_stage_tasks" (rowid, "id", "title") VALUES (?, ?, ?)')
    expect(sql).toContain('INSERT INTO "tasks" ("id", "title") SELECT "id", "title" FROM "restore_stage_tasks" WHERE rowid BETWEEN 1 AND 1 ORDER BY rowid')
    expect(sql.some((x) => x.includes('not_here_anymore'))).toBe(false)
    expect(s.some((x) => x.args.includes('old'))).toBe(false)
    expect(s.some((x) => x.args.includes('{"tone":4}'))).toBe(true)
    // The staging tables go away inside the same transaction.
    expect(sql[sql.length - 1]).toMatch(/^DROP TABLE IF EXISTS "restore_stage_/)
    expect(s.find((x) => x.sql.includes("'data_version'"))!.args).toEqual(['v9'])
    expect(() => restoreStatements({} as any, cols, 'v')).toThrow('not a Life System backup')
  })

  it('puts tables back in foreign-key order: parents in first, children deleted first', () => {
    const refs = { purchases: ['ledger', 'rewards'], ledger: ['ledger'], task_completions: ['tasks', 'ledger'] }
    const order = fkOrder(['task_completions', 'purchases', 'tasks', 'rewards', 'ledger'], refs)
    const at = (t: string) => order.indexOf(t)
    expect(at('ledger')).toBeLessThan(at('purchases'))
    expect(at('rewards')).toBeLessThan(at('purchases'))
    expect(at('tasks')).toBeLessThan(at('task_completions'))
    // A cycle still gives every table once.
    expect(fkOrder(['a', 'b'], { a: ['b'], b: ['a'] }).sort()).toEqual(['a', 'b'])
    const snap = { version: 2, exportedAt: 'x', tables: { purchases: [{ id: 1, reward_id: 1 }], rewards: [{ id: 1 }], tasks: [{ id: 1 }], task_completions: [{ id: 1, task_id: 1 }] } }
    const cols = { purchases: ['id', 'reward_id'], rewards: ['id'], tasks: ['id'], task_completions: ['id', 'task_id'] }
    const swap = restorePlan(snap, cols, 'v', { refs }).swap.map((x) => x.sql)
    const del = (t: string) => swap.indexOf(`DELETE FROM "${t}"`)
    const ins = (t: string) => swap.findIndex((x) => x.startsWith(`INSERT INTO "${t}"`))
    expect(del('purchases')).toBeLessThan(del('rewards'))
    expect(del('task_completions')).toBeLessThan(del('tasks'))
    expect(ins('rewards')).toBeLessThan(ins('purchases'))
    expect(ins('tasks')).toBeLessThan(ins('task_completions'))
  })

  it('a backup of any size goes in many small requests; a long text in pieces', () => {
    const long = 'x'.repeat(2500)
    const snap = { version: 2, exportedAt: 'x', tables: { notes: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, body: i === 7 ? long : `note ${i}` })) } }
    const plan = restorePlan(snap, { notes: ['id', 'body'] }, 'v', { batchChars: 2000, batchStmts: 10, pieceChars: 1000 })
    expect(plan.stage.length).toBeGreaterThan(5)
    for (const b of plan.stage) expect(b.length).toBeLessThanOrEqual(10)
    const pieces = plan.stage.flat().filter((s) => s.sql.startsWith('UPDATE "restore_stage_notes" SET "body" = "body" || ?'))
    expect(pieces.map((p) => p.args)).toEqual([
      ['x'.repeat(1000), 8],
      ['x'.repeat(500), 8]
    ])
    // The swap itself carries no data, so it stays one small transaction.
    expect(plan.swap.every((s) => s.args.length <= 1)).toBe(true)
  })

  it('a failed restore drops its staging tables and changes nothing else', async () => {
    const plan = restorePlan({ version: 2, exportedAt: 'x', tables: { tasks: [{ id: 1 }] } }, { tasks: ['id'] }, 'v')
    const sent: string[][] = []
    const write = async (stmts: { sql: string }[]) => {
      sent.push(stmts.map((s) => s.sql))
      if (stmts.some((s) => s.sql.startsWith('DELETE'))) throw new Error('database said no')
    }
    await expect(runRestorePlan(plan, write)).rejects.toThrow('database said no')
    expect(sent[sent.length - 1]).toEqual(['DROP TABLE IF EXISTS "restore_stage_tasks"'])
  })

  it('marks the apps restored so no device merges its old copy back in', () => {
    const snap = {
      version: 2,
      exportedAt: 'x',
      tables: { settings: [{ key: 'app_sync_waky', value: JSON.stringify({ savedAt: 1, editedAt: 1, data: { days: { a: 1 } } }) }, { key: 'theme', value: '"dark"' }] },
      financeState: { tx: [{ id: 't1' }], settings: { pin: '1234' } }
    }
    const { snap: out, apps } = markRestoredApps(snap, 'r1', 5000, { financeState: (s) => ({ tx: s.tx }) })
    expect(apps).toEqual({ financeState: { tx: [{ id: 't1' }] }, wakyState: { days: { a: 1 } } })
    expect(JSON.parse(String(out.tables.settings.find((r) => r.key === 'app_sync_finance')!.value))).toEqual({ savedAt: 5000, editedAt: 5000, restore: 'r1', data: { tx: [{ id: 't1' }] } })
    expect(JSON.parse(String(out.tables.settings.find((r) => r.key === 'app_sync_waky')!.value)).restore).toBe('r1')
    expect(settingCopy(out, 'app_sync_waky')).toEqual({ days: { a: 1 } })
    // The input is not changed.
    expect(snap.tables.settings).toHaveLength(2)
  })

  it('keeps 30 days of old daily JSON files plus the first of each month for a year', () => {
    const names = ['life-system-2025-10-15.json', 'life-system-2026-03-01.json', 'life-system-2026-03-09.json', 'life-system-2026-10-01.json', 'life-system-2026-10-04.json', 'life-system-2026-10-20.json', 'notes.txt']
    expect(backupsToDelete(names, '2026-11-04')).toEqual(['life-system-2025-10-15.json', 'life-system-2026-03-09.json', 'life-system-2026-10-04.json'])
  })
})

describe('local backup rotation: 14 daily, 8 weekly, 12 monthly', () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') - i * 864e5).toISOString().slice(0, 10))

  it('names say the day and what a backup was made before', () => {
    expect(dailyBackupName('2026-11-12')).toBe('life-system-2026-11-12.zip')
    expect(riskBackupName('2026-11-12', '093015', 'Finance re-price!')).toBe('life-system-2026-11-12-093015-before-finance-re-price.zip')
    expect(parseLocalBackup('life-system-2026-11-12-093015-before-finance-re-price.zip')).toMatchObject({ day: '2026-11-12', kind: 'risk', time: '093015', before: 'finance-re-price' })
    expect(parseLocalBackup('life-system-2026-11-12.zip')).toMatchObject({ kind: 'daily' })
    expect(parseLocalBackup('holiday.zip')).toBeNull()
  })

  it('after two years of daily backups keeps 14 + 8 weekly + 12 monthly, never a stranger file', () => {
    const names = [...days('2026-11-12', 730).map(dailyBackupName), 'my-notes.zip']
    const del = localBackupsToDelete(names, '2026-11-12')
    expect(del).not.toContain('my-notes.zip')
    const kept = names.filter((n) => !del.includes(n) && n !== 'my-notes.zip').map((n) => parseLocalBackup(n)!.day).sort().reverse()
    // The newest 14 days, every one.
    expect(kept.slice(0, 14)).toEqual(days('2026-11-12', 14))
    // 8 distinct weeks and 12 distinct months are covered, and no more than 14 + 8 + 12 files.
    expect(kept.length).toBeLessThanOrEqual(34)
    const weeks = new Set(kept.map((d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }))
    expect(weeks.size).toBeGreaterThanOrEqual(8)
    expect(new Set(kept.map((d) => d.slice(0, 7))).size).toBe(12)
    expect(kept[kept.length - 1] >= '2025-12-01').toBe(true)
    expect(del).toContain(dailyBackupName('2025-01-01'))
  })

  it('a PC that was off for months still keeps its older copies', () => {
    const names = ['2026-01-05', '2026-01-06', '2026-03-10', '2026-11-12'].map(dailyBackupName)
    expect(localBackupsToDelete(names, '2026-11-12')).toEqual([])
  })

  it('keeps the newest 30 "before" backups and both files of a kept day', () => {
    const risk = Array.from({ length: 35 }, (_, i) => riskBackupName('2026-11-01', String(100000 + i), 'import'))
    const names = [...risk, 'life-system-2026-11-12.json', 'life-system-2026-11-12.zip']
    const del = localBackupsToDelete(names, '2026-11-12')
    expect(del).toHaveLength(5)
    expect(del).toContain(riskBackupName('2026-11-01', '100000', 'import'))
    expect(del).not.toContain('life-system-2026-11-12.json')
  })
})

import { redactRows as redact } from './backupPlan'
describe('no secrets in backups', () => {
  it('drops the PIN hash, tokens, Google sign-in and bot setup from settings', () => {
    const rows = ['pin_hash', 'google_oauth', 'bot_bridge_config', 'session_epoch', 'todoist_token', 'theme', 'coach_memory'].map((key) => ({ key, value: 'x' }))
    expect(redact('settings', rows).map((r) => r.key)).toEqual(['theme', 'coach_memory'])
    expect(redact('ledger', [{ key: 'pin_hash' }])).toHaveLength(1)
  })
})

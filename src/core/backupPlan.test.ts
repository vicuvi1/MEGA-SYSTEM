import { describe, expect, it } from 'vitest'
import { backupTables, backupsToDelete, restoreStatements } from './backupPlan'

describe('backups', () => {
  it('backs up every data table, not the plumbing', () => {
    expect(backupTables(['tasks', 'focus_sessions', 'day_plans', 'cloud_snapshots', 'desktop_outbox', 'bot_seen_updates', 'sqlite_sequence', 'ledger'])).toEqual(['day_plans', 'focus_sessions', 'ledger', 'tasks'])
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
    expect(sql).toContain('INSERT OR IGNORE INTO "ledger" ("id", "coins") VALUES (?, ?)')
    expect(sql).toContain('INSERT INTO "tasks" ("id", "title") VALUES (?, ?)')
    expect(sql).toContain('INSERT INTO "focus_sessions" ("id", "subject") VALUES (?, ?)')
    expect(s.some((x) => x.args.includes('old'))).toBe(false)
    expect(s.some((x) => x.args.includes('{"tone":4}'))).toBe(true)
    expect(s[s.length - 1].args).toEqual(['v9'])
    expect(() => restoreStatements({} as any, cols, 'v')).toThrow('not a Life System backup')
  })

  it('keeps 30 days of daily files plus the first of each month for a year', () => {
    const names = ['life-system-2025-10-15.json', 'life-system-2026-03-01.json', 'life-system-2026-03-09.json', 'life-system-2026-10-01.json', 'life-system-2026-10-04.json', 'life-system-2026-10-20.json', 'notes.txt']
    expect(backupsToDelete(names, '2026-11-04')).toEqual(['life-system-2025-10-15.json', 'life-system-2026-03-09.json', 'life-system-2026-10-04.json'])
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

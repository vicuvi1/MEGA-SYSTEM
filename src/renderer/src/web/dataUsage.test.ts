import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { requestBytes, utf8Bytes } from '@core/dataCenter'
import { dbUsage } from './dataUsage'
import { rowsDbOf } from './restoreDrill'

describe('Data center: sizes in the database copy', () => {
  it('measures every table and setting in bytes, biggest first, and a setting as it travels', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.exec(m)
    // Made-up data: a Money copy with quotes and non-ASCII text, a small setting, a few points.
    const money = JSON.stringify({ savedAt: 1, data: { tx: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, note: 'made-up "plăcintă"', amount: i })) } })
    db.run("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?), ('theme', '\"dark\"')", [money])
    for (let i = 1; i <= 20; i++) db.run("INSERT INTO ledger (ts, day, module, kind, coins, note) VALUES ('2026-11-01T08:00:00Z', '2026-11-01', 'test', 'earn', ?, 'made-up')", [i])
    db.run('CREATE TABLE cloud_snapshots (day TEXT, data TEXT)')
    db.run('CREATE TABLE restore_stage_ledger (id INTEGER)')

    const u = dbUsage(rowsDbOf(db))
    const s = u.settings.find((x) => x.key === 'app_sync_finance')!
    expect(u.settings[0].key).toBe('app_sync_finance')
    expect(s.bytes).toBe(utf8Bytes(money))
    expect(s.requestBytes).toBe(requestBytes(money))
    expect(u.settings.find((x) => x.key === 'theme')).toEqual({ key: 'theme', bytes: 6, requestBytes: 10 })

    const ledger = u.tables.find((t) => t.name === 'ledger')!
    expect(ledger.rows).toBe(20)
    expect(ledger.bytes).toBeGreaterThan(20 * 40)
    expect(u.tables[0].name).toBe('settings')
    expect(u.tables[0].bytes).toBeGreaterThanOrEqual(s.bytes)
    // The server's backups and a restore's staging tables are not this device's data.
    expect(u.tables.some((t) => t.name.startsWith('cloud_snapshot') || t.name.startsWith('restore_stage_'))).toBe(false)
  })

  it('an empty database measures as nothing', async () => {
    const SQL = await initSqlJs()
    expect(dbUsage(rowsDbOf(new SQL.Database()))).toEqual({ tables: [], settings: [] })
  })
})

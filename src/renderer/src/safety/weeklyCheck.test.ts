import { describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { deflateRawSync } from 'node:zlib'
import { MIGRATIONS } from '@core/schema'
import { makeZip, utf8 } from '@core/zip'
import { checkDue, checkLine, runBackupCheck, type CheckNote } from '@core/weeklyBackupCheck'
import { restoreDrill, rowsDbOf, snapshotOf } from '../web/restoreDrill'
import { backupTextOf } from './backupFiles'

const NOW = new Date('2026-11-10T09:00:00Z')

function madeUpBackup(SQL: SqlJsStatic): string {
  const db = new SQL.Database()
  for (const m of MIGRATIONS) db.exec(m)
  db.run("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"')")
  for (let i = 1; i <= 30; i++) db.run("INSERT INTO ledger (ts, day, module, kind, coins, note) VALUES (?, '2026-11-01', 'test', 'earn', ?, ?)", [`2026-11-01T0${i % 10}:00:00Z`, i, `made-up ${i}`])
  db.run("INSERT INTO tasks (title, category, created_day) VALUES ('Read 10 pages', 'university', '2026-11-01')")
  const snap = { ...snapshotOf(rowsDbOf(db), 'test', new Date('2026-11-09T12:00:00Z')), financeState: { tx: [{ id: 't1', amount: 5 }] } }
  return JSON.stringify(snap)
}

const zipOf = (json: string) => makeZip([{ name: 'backup.json', data: utf8(json) }], (u8) => new Uint8Array(deflateRawSync(u8)))

function deps(SQL: SqlJsStatic, bytes: Uint8Array, over: Record<string, unknown> = {}) {
  return {
    files: [{ name: 'life-system-2026-11-09.zip', day: '2026-11-09' }],
    read: async () => bytes,
    textOf: (b: Uint8Array) => backupTextOf(b),
    drill: (t: string) => restoreDrill(SQL, t),
    now: NOW,
    ...over
  }
}

describe('weekly backup check', () => {
  it('a good backup passes and the line shows the date, backup day and row count', async () => {
    const SQL = await initSqlJs()
    const n = await runBackupCheck(deps(SQL, zipOf(madeUpBackup(SQL))))
    expect(n.state).toBe('ok')
    expect(n.rows).toBeGreaterThan(30)
    expect(checkLine(n, '2026-11-10')).toBe(`Last backup check: 10 Nov · OK (backup from 9 Nov, ${n.rows!.toLocaleString('en-US')} rows)`)
  })

  it('a truncated zip fails with a short reason and never throws', async () => {
    const SQL = await initSqlJs()
    const z = zipOf(madeUpBackup(SQL))
    const n = await runBackupCheck(deps(SQL, z.subarray(0, Math.floor(z.length / 2))))
    expect(n.state).toBe('failed')
    expect(n.msg.length).toBeGreaterThan(0)
    expect(n.msg.length).toBeLessThanOrEqual(120)
    expect(checkLine(n, '2026-11-10')).toContain('Failed: ')
  })

  it('broken JSON and an empty backup fail', async () => {
    const SQL = await initSqlJs()
    expect((await runBackupCheck(deps(SQL, utf8('{"tables": {"ledg')))).state).toBe('failed')
    const empty = JSON.stringify({ version: 2, tables: { settings: [] } })
    const n = await runBackupCheck(deps(SQL, utf8(empty)))
    expect(n.state).toBe('failed')
  })

  it('an app copy that does not parse fails', async () => {
    const SQL = await initSqlJs()
    const snap = JSON.parse(madeUpBackup(SQL))
    snap.sportState = 'not json {'
    const n = await runBackupCheck(deps(SQL, utf8(JSON.stringify(snap)), { drill: () => ({ ok: true, msg: 'x', rows: 5 }) }))
    expect(n.state).toBe('failed')
    expect(n.msg).toMatch(/Sport Track/)
  })

  it('an encrypted backup is reported as encrypted, not as a failure, and is not opened', async () => {
    const SQL = await initSqlJs()
    let opened = false
    const n = await runBackupCheck(deps(SQL, utf8('LSENC1 made-up bytes'), { textOf: async () => { opened = true; return '' } }))
    expect(n.state).toBe('encrypted')
    expect(opened).toBe(false)
    expect(checkLine(n, '2026-11-10')).toBe("Last backup check: 10 Nov · Can't check: backup is encrypted")
    const flagged = await runBackupCheck(deps(SQL, utf8(JSON.stringify({ encrypted: true, data: 'abc' }))))
    expect(flagged.state).toBe('encrypted')
  })

  it('no backup file yet is "can\'t check", not a failure', async () => {
    const SQL = await initSqlJs()
    expect((await runBackupCheck(deps(SQL, new Uint8Array(), { files: [] }))).state).toBe('none')
  })

  it('does not touch the real data: the drill only builds its own database', async () => {
    const SQL = await initSqlJs()
    const real = new SQL.Database()
    for (const m of MIGRATIONS) real.exec(m)
    real.run("INSERT INTO tasks (title, category, created_day) VALUES ('Keep me', 'body', '2026-11-01')")
    const before = JSON.stringify(rowsDbOf(real).prepare('SELECT * FROM tasks').all())
    await runBackupCheck(deps(SQL, utf8(madeUpBackup(SQL))))
    expect(JSON.stringify(rowsDbOf(real).prepare('SELECT * FROM tasks').all())).toBe(before)
  })

  it('weekly gating: due with no check, not before 7 days, due at 7 days', () => {
    const at = (iso: string): CheckNote => ({ at: iso, state: 'ok', msg: '' })
    expect(checkDue(null, NOW)).toBe(true)
    expect(checkDue(at('2026-11-04T09:00:01Z'), NOW)).toBe(false)
    expect(checkDue(at('2026-11-03T09:00:00Z'), NOW)).toBe(true)
    expect(checkDue(at('garbage'), NOW)).toBe(true)
  })
})

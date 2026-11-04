import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { restoreDrill, snapshotOf } from './restoreDrill'

const wrap = (raw: any) => ({ prepare: (sql: string) => ({ all: () => { const r = raw.exec(sql)[0]; return r ? r.values.map((v: any[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, v[i]]))) : [] } }) })

describe('restore drill', () => {
  it('a real backup comes back row for row; a broken one is caught', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.exec(m)
    db.run("INSERT INTO settings (key, value) VALUES ('theme', 'dark'), ('pin_hash', 'x')")
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map((v) => String(v[0]))
    expect(tables).toContain('ledger')
    const snap = snapshotOf(wrap(db), 'test', new Date('2026-11-04T12:00:00Z'))
    expect(snap.tables.settings.some((r: any) => r.key === 'theme')).toBe(true)
    const good = restoreDrill(SQL, JSON.stringify(snap))
    expect(good).toMatchObject({ ok: true })
    expect(good.rows).toBeGreaterThan(0)

    // A row that can't go back in (unknown NOT NULL column missing) is reported.
    const broken = JSON.parse(JSON.stringify(snap))
    const t = Object.keys(broken.tables).find((k) => k !== 'settings' && broken.tables[k].length)!
    broken.tables[t].push({ nope: 1 })
    expect(restoreDrill(SQL, JSON.stringify(broken)).ok).toBe(false)
    expect(restoreDrill(SQL, '{oops').ok).toBe(false)
    expect(restoreDrill(SQL, '{"tables":{}}').ok).toBe(false)
  })
})

// "Export everything" and "Restore from file" (2026-11-12).
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { inflateRawSync, deflateRawSync } from 'node:zlib'
import initSqlJs from 'sql.js'
import { listZip, makeZip, readZipEntry, utf8 } from '@core/zip'
import { appCsvs, backupTextOf, exportEverything, toCsv } from './backupFiles'

const require = createRequire(import.meta.url)
const loadSql = () => initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
const snap = {
  version: 2,
  exportedAt: '2026-11-12T08:00:00Z',
  tables: { tasks: [{ id: 1, title: 'Read, then "write"' }, { id: 2, title: '=SUM(A1)' }], settings: [{ key: 'theme', value: '"dark"' }] },
  financeState: { tx: [{ id: 't1', amount: 1250, cur: 'MDL', note: 'made-up' }], settings: { theme: 'dark' } },
  wakyState: { days: { '2026-11-11': { wake: '06:40' }, '2026-11-12': { wake: '06:45', note: 'x' } } },
  financeEnc: 'sealed'
}

describe('export everything', () => {
  it('one zip: the full JSON, every table as CSV, every app as JSON and CSV', async () => {
    const zip = await exportEverything(snap as any, new Date('2026-11-12T08:00:00Z'))
    const items = listZip(zip)
    const names = items.map((i) => i.name)
    expect(names).toEqual(expect.arrayContaining(['life-system-backup.json', 'tables/settings.csv', 'tables/tasks.csv', 'apps/finance.json', 'apps/finance/tx.csv', 'apps/waky.json', 'apps/waky/days.csv', 'apps/finance-locked.json', 'manifest.json', 'README.txt']))
    const read = async (n: string) => new TextDecoder().decode(await readZipEntry(items.find((i) => i.name === n)!, (u8) => new Uint8Array(inflateRawSync(u8))))
    expect(JSON.parse(await read('life-system-backup.json'))).toEqual(snap)
    expect(await read('tables/tasks.csv')).toBe('id,title\r\n1,"Read, then ""write"""\r\n2,\'=SUM(A1)\r\n')
    expect(await read('apps/finance/tx.csv')).toBe('id,amount,cur,note\r\nt1,1250,MDL,made-up\r\n')
    expect(await read('apps/waky/days.csv')).toBe('key,wake,note\r\n2026-11-11,06:40,\r\n2026-11-12,06:45,x\r\n')
    expect(JSON.parse(await read('manifest.json')).digest.tables.tasks.rows).toBe(2)
    // The export holds nothing secret: it is what the backup holds (secret settings are left out before).
    expect(await read('README.txt')).toMatch(/PIN, keys and tokens are never/)
  })

  it('CSV of mixed rows and app data shapes', () => {
    expect(toCsv([{ a: 1 }, { b: [1, 2] }])).toBe('a,b\r\n1,\r\n,"[1,2]"\r\n')
    expect(appCsvs({ list: [1, 2], none: [], map: {} })).toEqual([])
  })
})

describe('restore from file', () => {
  it('takes a local backup zip, an export zip, plain JSON, and a zip with only the database file', async () => {
    const json = JSON.stringify(snap)
    expect(await backupTextOf(utf8(json))).toBe(json)
    const local = makeZip([{ name: 'backup.json', data: utf8(json) }, { name: 'README.txt', data: utf8('x') }], (u8) => new Uint8Array(deflateRawSync(u8)))
    expect(await backupTextOf(local)).toBe(json)
    const exported = await exportEverything(snap as any)
    expect(JSON.parse(await backupTextOf(exported))).toEqual(snap)

    // A "before update" copy: only this PC's database file.
    const SQL = await loadSql()
    const db = new SQL.Database()
    db.exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO tasks VALUES (1, 'made-up'); CREATE TABLE sys_auth (k TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('pin_hash', 'x'), ('theme', '1')")
    const onlyDb = makeZip([{ name: 'life-system.sqlite', data: db.export() }])
    const fromDb = JSON.parse(await backupTextOf(onlyDb, loadSql))
    expect(fromDb.tables.tasks).toEqual([{ id: 1, title: 'made-up' }])
    expect(fromDb.tables.sys_auth).toBeUndefined()
    expect(fromDb.tables.settings).toEqual([{ key: 'theme', value: '1' }])

    await expect(backupTextOf(utf8('{"hello":1}'))).rejects.toThrow('not a Life System backup')
    await expect(backupTextOf(makeZip([{ name: 'photo.jpg', data: utf8('x') }]))).rejects.toThrow('no Life System backup')
  })
})

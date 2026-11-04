import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { BrowserDb } from './browserDb'
import { addNotif, dismissNotif, listNotifs, readNotifs } from './notifications'

const require = createRequire(import.meta.url)

describe('notification storage', () => {
  it('adds once, reads, dismisses, keeps the newest 200', async () => {
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const raw = new SQL.Database()
    for (const m of MIGRATIONS) raw.exec(m)
    const db = new BrowserDb(raw) as any
    const n = (i: number) => ({ id: `ben:${i}`, at: new Date(Date.UTC(2026, 10, 4, 10, 0, i)).toISOString(), kind: 'ben' as const, title: `Hi ${i}`, body: null, action: { kind: 'page' as const, page: 'coach', label: 'Reply' } })
    addNotif(db, n(1))
    addNotif(db, n(1))
    addNotif(db, n(2))
    expect(listNotifs(db).map((x) => x.id)).toEqual(['ben:2', 'ben:1'])
    expect(listNotifs(db)[0].action).toEqual({ kind: 'page', page: 'coach', label: 'Reply' })
    readNotifs(db, ['ben:1'])
    expect(listNotifs(db).filter((x) => !x.readAt).map((x) => x.id)).toEqual(['ben:2'])
    readNotifs(db, null)
    expect(listNotifs(db).every((x) => x.readAt)).toBe(true)
    dismissNotif(db, 'ben:2')
    expect(listNotifs(db).map((x) => x.id)).toEqual(['ben:1'])
    for (let i = 3; i < 260; i++) addNotif(db, n(i))
    expect(Number(raw.exec('SELECT COUNT(*) FROM notifications')[0].values[0][0])).toBe(200)
  })
})

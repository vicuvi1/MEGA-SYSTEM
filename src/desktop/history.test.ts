// MC11 on a made-up Chrome History file: copied, read with sql.js, only
// listed sites counted, only minutes per site come back.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { toChromeTime } from '../core/browserHistory'
import { browserDistraction } from './history'

const dir = mkdtempSync(join(tmpdir(), 'ls-hist-test-'))
const savedXdg = process.env.XDG_CONFIG_HOME
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

describe.skipIf(process.platform === 'win32' || process.platform === 'darwin')('browser history reader', () => {
  it('counts yesterday on listed sites from a copy of the History file', async () => {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const db = new SQL.Database()
    db.run('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT)')
    db.run('CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, visit_duration INTEGER)')
    const now = new Date()
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    y.setHours(20, 0, 0, 0)
    db.run("INSERT INTO urls VALUES (1, 'https://www.youtube.com/watch?v=made-up'), (2, 'https://docs.example.test/x'), (3, 'https://www.reddit.com/r/made-up')")
    db.run('INSERT INTO visits VALUES (1, 1, ?, ?)', [toChromeTime(y.getTime()), 25 * 60 * 1e6])
    db.run('INSERT INTO visits VALUES (2, 2, ?, ?)', [toChromeTime(y.getTime() + 30 * 60_000), 40 * 60 * 1e6])
    db.run('INSERT INTO visits VALUES (3, 3, ?, ?)', [toChromeTime(y.getTime() + 80 * 60_000), 10 * 60 * 1e6])
    const prof = join(dir, 'google-chrome', 'Default')
    mkdirSync(prof, { recursive: true })
    writeFileSync(join(prof, 'History'), Buffer.from(db.export()))
    process.env.XDG_CONFIG_HOME = dir
    const r = await browserDistraction(['youtube.com', 'reddit.com'], now)
    expect(r.yesterday).toEqual({ 'youtube.com': 25, 'reddit.com': 10 })
    expect(r.line).toBe('25 min on YouTube, 10 min on Reddit yesterday')
    expect(JSON.stringify(r)).not.toContain('made-up')
  }, 20_000)
})

// MC11 on the PC: minutes on your listed sites from Chrome / Edge / Brave
// history. Only when "Distraction minutes from browser history" is on. Each
// History file is copied to a temporary file (the browser keeps the real one
// locked), read with sql.js, and the copy deleted at once. Only visits to
// listed sites are counted; only "site → minutes" leaves this file.
import { copyFile, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { distractMinutes, fromChromeTime, historyFiles, historyLine, toChromeTime, type Visit } from '../core/browserHistory'

type SqlJs = { Database: new (data?: Uint8Array) => { exec(sql: string, params?: unknown[]): { values: unknown[][] }[]; close(): void } }
let sqlP: Promise<SqlJs> | null = null
const sql = () => {
  if (!sqlP) {
    const require = createRequire(import.meta.url)
    sqlP = import('sql.js').then((m: any) => (m.default ?? m)({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) }))
  }
  return sqlP
}

const midnight = (d: Date, back = 0) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - back)
  return x.getTime()
}

/** Visits since `from` (ms) in every History file found (one copy at a time). */
async function visitsSince(from: number): Promise<Visit[]> {
  const SQL = await sql()
  const out: Visit[] = []
  for (const f of historyFiles(process.platform, homedir(), process.env)) {
    if (!(await stat(f.path).then((s) => s.isFile(), () => false))) continue
    const tmp = join(tmpdir(), `ls-history-${randomBytes(6).toString('hex')}.db`)
    try {
      await copyFile(f.path, tmp)
      const db = new SQL.Database(new Uint8Array(await readFile(tmp)))
      try {
        // The address is read only to find its site; it never leaves this function.
        const rows = db.exec('SELECT urls.url, visits.visit_time, visits.visit_duration FROM visits JOIN urls ON urls.id = visits.url WHERE visits.visit_time >= ?', [toChromeTime(from)])[0]?.values ?? []
        for (const [url, t, d] of rows) out.push({ url: String(url), at: fromChromeTime(Number(t)), durMs: Number(d) / 1000 })
      } finally {
        db.close()
      }
    } catch {
      /* locked, missing or not a history file: skip it */
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }
  return out
}

/** Yesterday's and today's minutes per listed site, and Ben's line for yesterday. */
export async function browserDistraction(sites: string[], now = new Date()): Promise<{ today: Record<string, number>; yesterday: Record<string, number>; line: string; todayLine: string }> {
  const y0 = midnight(now, 1)
  const t0 = midnight(now)
  const visits = await visitsSince(y0)
  const yesterday = distractMinutes(visits, sites, y0, t0)
  const today = distractMinutes(visits, sites, t0, now.getTime())
  return { yesterday, today, line: historyLine(yesterday, 'yesterday'), todayLine: historyLine(today, 'today') }
}

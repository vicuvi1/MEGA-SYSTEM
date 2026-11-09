// The goal ladder on a real (fake Turso) database: facts counted from the
// existing logs, the 3-goal cap, the swap, the Sunday review saving the week
// plan's big 3, and no points for any of it. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createLadder } from './ladderApi'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Sunday 15 Nov 2026, 10:00: review day.
  vi.setSystemTime(new Date('2026-11-15T10:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fakeTurso(): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  // Made-up week: 3 workouts, 2 weigh-ins, 4 hours of focus.
  for (const d of ['2026-11-09', '2026-11-11', '2026-11-13']) remote.run("INSERT INTO workouts (day, ts, title, items_json) VALUES (?, ?, 'Upper', '[]')", [d, `${d}T18:00:00Z`])
  for (const [d, w] of [['2026-11-10', 70.2], ['2026-11-12', 70.4]] as const) remote.run('INSERT INTO body_metrics (day, weight, updated_at) VALUES (?, ?, ?)', [d, w, `${d}T07:00:00Z`])
  for (const d of ['2026-11-10', '2026-11-12']) remote.run("INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at) VALUES (?, 'Maths', 120, ?, ?)", [d, `${d}T09:00:00Z`, `${d}T11:00:00Z`])
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}
const count = (db: SqlJsDatabase, sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0)

async function open() {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
  await mirror.ready
  const web = createWebServices(mirror)
  return { web, ladder: createLadder(Promise.resolve(web)) }
}

describe('goal ladder on the database', () => {
  it('counts actions from the existing logs and shows 3 critical goals', async () => {
    fakeTurso()
    const { ladder } = await open()
    const v = await ladder.view()
    expect(v.cards.map((c) => c.goal.id)).toEqual(['gain', 'strong', 'study'])
    const gain = v.cards[0]
    expect(gain.week.actions.map((a) => a.text)).toEqual(['3/5 workouts', '0/6 protein days', '2/3 weigh-ins'])
    expect(v.cards[2].week.actions[0].text).toBe('4/10 h focus')
    expect(gain.timeline).toHaveLength(12)
    expect(v.weeklyDue).toBe(true)
    expect(v.weekly.top3).toHaveLength(3)
  })
  it('a 4th goal is refused, a swap works, and the Sunday review saves the big 3 with no points', async () => {
    const remote = fakeTurso()
    const { ladder, web } = await open()
    await expect(ladder.activate('sleep')).rejects.toThrow(/Up to 3/)
    await ladder.swap('study', 'sleep')
    let v = await ladder.view()
    expect(v.cards.map((c) => c.goal.id)).toEqual(['gain', 'strong', 'sleep'])
    const before = count(remote, 'SELECT COUNT(*) FROM ledger')
    const picks = v.weekly.top3
    await ladder.finishWeek(v.weekly.week, [...picks, 'Clean the room'], picks)
    await web.read(() => null)
    v = await ladder.view()
    expect(v.weeklyDue).toBe(false)
    const plan = await web.read((s) => s.weekPlan.saved())
    expect(plan?.week).toBe('2026-11-16')
    expect(plan?.big3.map((b) => b.text)).toEqual(picks)
    expect(plan?.parked).toEqual(['Clean the room'])
    expect(count(remote, 'SELECT COUNT(*) FROM ledger')).toBe(before)
  })
})

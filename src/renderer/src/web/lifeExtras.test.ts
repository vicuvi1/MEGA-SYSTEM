import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createExtras } from './lifeExtras'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function fakeTurso(): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
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
  return { web, extras: createExtras(Promise.resolve(web)) }
}

describe('your own habits, paid honestly (FT1)', () => {
  it('a tap pays once a day; taking it back undoes the points', async () => {
    const remote = fakeTurso()
    const { web, extras } = await open()
    const v = await extras.editHabits({ op: 'add', name: 'Read 10 pages' })
    const id = v.rows[0].id
    const r = await extras.tapHabit(id)
    expect(r.paid).toBe(2)
    expect(r.view.rows[0]).toMatchObject({ done: true, streak: 1 })
    expect((await extras.tapHabit(id)).paid).toBe(0)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id = 'habit.own'")).toBe(1)
    const back = await extras.untapHabit(id)
    expect(back.rows[0].done).toBe(false)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE kind = 'undo' AND ref LIKE 'habit:%'")).toBe(1)
    expect((await web.wallet.summary()).balance).toBe(0)
  })
  it('the wallet refuses a bare award of the habit rule', async () => {
    fakeTurso()
    const { web } = await open()
    await expect(web.wallet.award('habit.own')).rejects.toThrow(/own section/)
  })
})

describe('life modes keep the workout streak (FT4)', () => {
  it('sick days count as rest days without using the rest budget', async () => {
    fakeTurso()
    const { web, extras } = await open()
    const m = await extras.setMode('sick', 3)
    expect(m.current).toMatchObject({ kind: 'sick', days: 3, dayN: 1 })
    const body = await web.body.state()
    expect(body.restToday).toBe(true)
    expect(body.modeRest).toEqual([m.today])
    expect(body.restLeftThisWeek).toBe(2)
    expect((await extras.setMode(null)).current).toBeNull()
  })
})

describe('a reward that unlocks with a streak (FT21)', () => {
  it('cannot be bought until the streak is there, even with the points', async () => {
    fakeTurso()
    const { web, extras } = await open()
    const shop = await web.shop.save({ title: 'Headphones', price: 1, realCost: 0, tier: 'bronze', pinned: false, note: null } as any)
    const reward = shop.rewards.find((r: any) => r.title === 'Headphones')!
    const h = await extras.editHabits({ op: 'add', name: 'Stretch' })
    await extras.tapHabit(h.rows[0].id)
    const locks = await extras.setUnlock(reward.id, { kind: 'streak', streak: 'workout', days: 5 })
    expect(locks.states[String(reward.id)]).toMatchObject({ met: false })
    await expect(web.shop.redeem(reward.id)).rejects.toThrow(/5-day training streak/)
    await extras.setUnlock(reward.id, null)
    await expect(web.shop.redeem(reward.id)).resolves.toBeTruthy()
  })
})

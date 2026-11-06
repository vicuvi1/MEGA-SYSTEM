import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { SPORT_KEY, createSportSync, mergeSport } from './sportSync'
import { sportToday } from '@core/sportShared'
import { logChanges } from '../../../main/bodyLog'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function fakeTurso() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}

/** A browser's localStorage. */
function storage(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}

const sport = (lastDate: string, push: number, history: any[] = []) => ({
  lastDate,
  xp: 10,
  exercises: [{ id: 'ex_pushups', name: 'Push-ups', target: 100, doneToday: push }],
  water: { currentMl: 0, targetMl: 2700 },
  history
})

async function device(store: Storage) {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
  await mirror.ready
  return { mirror, sync: createSportSync(mirror, store) }
}

describe('Sport Track sync', () => {
  it('merges two versions of the same day: higher reps, history from both', () => {
    const a = sport('2026-10-31', 30, [{ id: 2, title: 'run' }])
    const b = sport('2026-10-31', 50, [{ id: 1, title: 'gym' }])
    const m = mergeSport(a, b, true)
    expect(m.exercises[0].doneToday).toBe(50)
    expect(m.history.map((h: any) => h.id)).toEqual([2, 1])
  })

  it('a correction down (undo, −250 ml) survives the merge (N1)', () => {
    const a: any = sport('2026-10-31', 30, [])
    a.exercises[0].fixedAt = 1000
    a.water = { currentMl: 250, fixedAt: 1000 }
    const b: any = sport('2026-10-31', 60, [])
    b.water = { currentMl: 500 }
    const m = mergeSport(a, b, false)
    expect(m.exercises[0].doneToday).toBe(30)
    expect(m.water.currentMl).toBe(250)
  })

  it("never brings yesterday's reps into today", () => {
    const m = mergeSport(sport('2026-10-30', 90), sport('2026-10-31', 10), true)
    expect(m.lastDate).toBe('2026-10-31')
    expect(m.exercises[0].doneToday).toBe(10)
  })

  it('reps logged on the phone show on the PC, and both edits survive', async () => {
    const remote = fakeTurso()
    const phone = storage()
    const pc = storage()
    const today = sportToday()
    phone.setItem(SPORT_KEY, JSON.stringify(sport(today, 40, [{ id: 5, title: 'phone workout' }])))
    const p = await device(phone)
    await p.sync.sync()
    expect(String(remote.exec("SELECT value FROM settings WHERE key = 'sport_tracker_json'")[0].values[0][0])).toContain('phone workout')

    const c = await device(pc)
    await c.sync.sync()
    expect(JSON.parse(pc.getItem(SPORT_KEY)!).exercises[0].doneToday).toBe(40)

    // Both change before syncing again.
    pc.setItem(SPORT_KEY, JSON.stringify({ ...JSON.parse(pc.getItem(SPORT_KEY)!), history: [{ id: 9, title: 'pc workout' }, { id: 5, title: 'phone workout' }] }))
    await c.sync.sync()
    // +30 reps on the phone go through the one log (as updateSport and Sport Track do).
    phone.setItem(SPORT_KEY, JSON.stringify(sport(today, 70, [{ id: 5, title: 'phone workout' }])))
    await p.mirror.refresh()
    await p.mirror.write((db) => logChanges(db as any, [{ kind: 'reps:ex_pushups', amount: 30 }], 'phone'))
    await p.sync.sync()
    const mine = JSON.parse(phone.getItem(SPORT_KEY)!)
    expect(mine.exercises[0].doneToday).toBe(70)
    expect(mine.history.map((h: any) => h.title)).toEqual(['pc workout', 'phone workout'])

    await c.mirror.refresh()
    await c.sync.sync()
    expect(JSON.parse(pc.getItem(SPORT_KEY)!)).toEqual(mine)
  })
})

describe('the day log (training calendar) syncs too', () => {
  it('keeps days from both devices; an edited past day from the newer one; today the higher count', async () => {
    const { mergeSport } = await import('./sportSync')
    const pc = { lastDate: '2026-11-04', exercises: [], days: { '2026-11-01': { a: 50 }, '2026-10-31': { a: 80 }, '2026-11-04': { a: 30 } } }
    const phone = { lastDate: '2026-11-04', exercises: [], days: { '2026-11-02': { a: 40 }, '2026-10-31': { a: 20 }, '2026-11-04': { a: 10, b: 5 } } }
    const m = mergeSport(pc, phone, true)
    expect(m.days['2026-11-01']).toEqual({ a: 50 })
    expect(m.days['2026-11-02']).toEqual({ a: 40 })
    expect(m.days['2026-10-31']).toEqual({ a: 80 })
    expect(m.days['2026-11-04']).toEqual({ a: 30, b: 5 })
  })
})

describe('deletions stick across devices', () => {
  it('a session deleted on this device does not come back from the other one', async () => {
    const { pruneDeleted } = await import('./appSync')
    const { SPORT, mergeSport } = await import('./sportSync')
    const a = { id: 1, title: 'Run' }
    const b = { id: 2, title: 'Gym' }
    const base = { lastDate: '2026-11-04', history: [a, b] }
    const mine = { lastDate: '2026-11-04', history: [b] } // deleted "Run" here
    const theirs = { lastDate: '2026-11-04', history: [{ id: 3, title: 'Swim' }, a, b] } // added "Swim" there
    const out = pruneDeleted(SPORT, mergeSport(mine, theirs, true), base, mine, theirs)
    expect(out.history.map((h: any) => h.title).sort()).toEqual(['Gym', 'Swim'])
  })
})

describe('mergeSport: badges and "not yet"', () => {
  it('keeps every badge already shown (earliest day) and the later "not yet"', () => {
    const a = { lastDate: '2026-11-06', badges: { first: '2026-10-01', streak3: '2026-11-02' }, notYet: { wide_pushup: '2026-11-10' } }
    const b = { lastDate: '2026-11-06', badges: { first: '2026-10-03', record: '2026-11-05' }, notYet: { wide_pushup: '2026-11-13', jump_squat: '2026-11-09' } }
    const m = mergeSport(a, b, false)
    expect(m.badges).toEqual({ first: '2026-10-01', streak3: '2026-11-02', record: '2026-11-05' })
    expect(m.notYet).toEqual({ wide_pushup: '2026-11-13', jump_squat: '2026-11-09' })
    expect(mergeSport({ lastDate: '2026-11-06' }, { lastDate: '2026-11-06' }, true).badges).toBeUndefined()
  })
})

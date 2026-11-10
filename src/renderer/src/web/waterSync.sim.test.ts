// Water and reps on several devices at once, with made-up numbers: a phone,
// a PC that goes offline, the bot server (Telegram, Sporty), the island and
// the embedded Sport Track app. Every screen on every device must end on the
// same total: the one log's sum (body_log), never the higher of two copies.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { sharedView, sportForDay, sportToday } from '@core/sportShared'
import { defaultSport } from '@core/sportCards'
import { totalsOf, WATER_KIND } from '@core/bodyLog'
import { bodyEvents, logChanges, logEntries, logReps, logWater, repairFromLog, sportNow, toggleEntry } from '../../../main/bodyLog'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { SPORT_KEY, createSportSync } from './sportSync'
import { waterToday } from './coachStatus'
import { setSportLogger, updateSport } from '../sportTrack'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

function storage(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}

/** 2026-11-06 at a local hour (the app's day turns at 04:00 local time). */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m)

let remote: SqlJsDatabase
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(6, 15))
  Mirror.RETRY_BASE = 0
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true })
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' })
  remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const st = defaultSport(sportToday())
  remote.run("INSERT INTO settings (key, value) VALUES ('sport_tracker_json', ?)", [JSON.stringify({ savedAt: Date.now(), data: st })])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setSportLogger(null)
  Mirror.RETRY_BASE = 5000
})

/** A device: its own copy of the database (a Mirror), its own browser storage and Sport Track sync; `offline` cuts its network. */
async function device(name: string) {
  const net = { offline: false }
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    if (net.offline) throw new TypeError('Failed to fetch')
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  }) as unknown as typeof fetch
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', name, undefined, fetchImpl))
  await mirror.ready
  const store = storage()
  const sync = createSportSync(mirror, store)
  await sync.sync()
  /** This device's Sport Track copy changed through updateSport (the island, Today's buttons): logged through its own database copy. */
  const local = (fn: (s: any) => void, source: string) => {
    vi.stubGlobal('localStorage', store)
    setSportLogger((changes, src) => mirror.write((db) => logChanges(db as any, changes, src || name)))
    updateSport(fn, { source })
  }
  return { name, net, mirror, store, sync, local }
}
type Device = Awaited<ReturnType<typeof device>>

/** Wait for the loggers' writes (they run in the background like in the app). */
const settle = async (...ds: Device[]) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    for (const d of ds) {
      await d.mirror.refresh().catch(() => {})
      await d.sync.sync()
    }
  }
}

/** Every place that shows today's water on a device. */
async function waterEverywhere(d: Device): Promise<Record<string, number>> {
  return d.mirror.read((db) => ({
    // Today's card, Ben, the island and its Day page (coach.status → waterToday).
    [`${d.name} status`]: waterToday(db, {} as any).ml,
    // Telegram's water card and Sporty's state (the shared copy with the log's sums).
    [`${d.name} shared copy`]: sharedView(sportNow(db as any), sportToday()).water.ml,
    // Sport Track's copy on this device (the embedded app and readSport()).
    [`${d.name} Sport Track copy`]: Number(sportForDay(JSON.parse(d.store.getItem(SPORT_KEY) || 'null'), sportToday()).water.currentMl) || 0,
    // The history list's sum.
    [`${d.name} history`]: logEntries(db as any, sportToday()).filter((e) => !e.removed).reduce((t, e) => t + e.amount, 0)
  }))
}
const repsOn = (d: Device) => Number(JSON.parse(d.store.getItem(SPORT_KEY) || 'null')?.exercises?.find((e: any) => e.id === 'ex_pushups')?.doneToday) || 0
const remoteWater = () => {
  const v = remote.exec("SELECT value FROM settings WHERE key = 'sport_tracker_json'")[0]?.values[0]?.[0]
  return JSON.parse(String(v)).data.water.currentMl
}

describe('water on every device ends on the same total', () => {
  it('phone/Telegram, an offline PC, the island, an undo, the embedded app and the 04:00 day turn', async () => {
    const phone = await device('phone')
    const pc = await device('pc')
    const server = await device('server')

    // Telegram's 💧 +500 button (the server), delivered twice by Telegram: it counts once.
    await server.mirror.write((db) => logWater(db as any, 500, 'telegram', { id: 'tg-1' }))
    await server.mirror.write((db) => logWater(db as any, 500, 'telegram', { id: 'tg-1' }))

    // The PC is offline and logs a glass (the app's water button: coach.water).
    pc.net.offline = true
    await pc.mirror.write((db) => logWater(db as any, 250, 'pc'))
    expect(pc.mirror.pendingOffline).toBe(1)
    // Meanwhile the phone's embedded Sport Track app logs +250 (EmbedHost → the log).
    await phone.mirror.refresh()
    await phone.mirror.write((db) => logChanges(db as any, [{ kind: WATER_KIND, amount: 250, id: 'st-a1' }], 'sport'))
    // The PC is back: its glass is not refused or dropped, it adds up.
    pc.net.offline = false
    await settle(pc, phone, server)
    expect(pc.mirror.failedSync).toHaveLength(0)

    // The island on the PC: +250 with the tap's id.
    await pc.mirror.write((db) => logWater(db as any, 250, 'island', { id: 'isl-t1' }))
    // An undo on the phone: Today's −250 button.
    await phone.mirror.refresh()
    await phone.mirror.write((db) => logWater(db as any, -250, 'phone'))
    await settle(phone, pc, server)

    // 500 + 250 + 250 + 250 − 250
    const all = { ...(await waterEverywhere(phone)), ...(await waterEverywhere(pc)), ...(await waterEverywhere(server)) }
    for (const [where, ml] of Object.entries(all)) expect([where, ml]).toEqual([where, 1000])
    expect(remoteWater()).toBe(1000)

    // A wrong entry removed from the history list on the PC, then brought back (Undo): both reach the phone.
    await pc.mirror.write((db) => toggleEntry(db as any, 'isl-t1', 'pc'))
    await settle(pc, phone)
    expect((await waterEverywhere(phone))['phone status']).toBe(750)
    await phone.mirror.write((db) => toggleEntry(db as any, 'isl-t1', 'phone'))
    await settle(phone, pc)
    expect((await waterEverywhere(pc))['pc Sport Track copy']).toBe(1000)

    // 03:30 the next calendar day is still tonight: the glass counts on the 6th.
    vi.setSystemTime(at(7, 3, 30))
    await pc.mirror.write((db) => logWater(db as any, 250, 'pc'))
    await settle(pc, phone, server)
    for (const [where, ml] of Object.entries({ ...(await waterEverywhere(phone)), ...(await waterEverywhere(pc)) })) expect([where, ml]).toEqual([where, 1250])

    // 04:01: a new day starts at 0 everywhere; the 6th keeps its 1250 in the log.
    vi.setSystemTime(at(7, 4, 1))
    await settle(pc, phone, server)
    for (const [where, ml] of Object.entries({ ...(await waterEverywhere(phone)), ...(await waterEverywhere(pc)), ...(await waterEverywhere(server)) })) expect([where, ml]).toEqual([where, 0])
    expect(await phone.mirror.read((db) => totalsOf(bodyEvents(db as any, '2026-11-06'), '2026-11-06')[WATER_KIND])).toBe(1250)
  })

  it('a copy holding an old take-back (or any other stale number) is put right, not copied to the others', async () => {
    const phone = await device('phone')
    const pc = await device('pc')
    await phone.mirror.write((db) => logWater(db as any, 750, 'phone'))
    await settle(phone, pc)
    // The PC's copy says 100 with a newer "take-back" mark (what used to win every merge).
    const mine = JSON.parse(pc.store.getItem(SPORT_KEY)!)
    pc.store.setItem(SPORT_KEY, JSON.stringify({ ...mine, water: { ...mine.water, currentMl: 100, fixedAt: Date.now() + 1e6 } }))
    await settle(pc, phone)
    expect((await waterEverywhere(pc))['pc Sport Track copy']).toBe(750)
    expect((await waterEverywhere(phone))['phone Sport Track copy']).toBe(750)
    expect(remoteWater()).toBe(750)
  })

  it('the day the log starts, what was already logged counts once on every device (and the repair puts the past right)', async () => {
    // Before this version: the shared copy already says 1250 for today.
    const st = { ...defaultSport(sportToday()), water: { currentMl: 1250, targetMl: 2700, glassSizeMl: 250 } }
    remote.run("UPDATE settings SET value = ? WHERE key = 'sport_tracker_json'", [JSON.stringify({ savedAt: Date.now(), data: st })])
    const phone = await device('phone')
    const pc = await device('pc')
    // Both log a glass before they saw each other's: "logged earlier" is one row (same id), not two.
    await Promise.all([phone.mirror.write((db) => logWater(db as any, 250, 'phone')), pc.mirror.write((db) => logWater(db as any, 250, 'pc'))])
    await settle(phone, pc)
    expect((await waterEverywhere(phone))['phone status']).toBe(1750)
    expect((await waterEverywhere(pc))['pc Sport Track copy']).toBe(1750)
    expect(await pc.mirror.read((db) => logEntries(db as any, sportToday()).map((e) => [e.amount, e.source]))).toEqual([
      [1250, 'earlier'],
      [250, expect.any(String)],
      [250, expect.any(String)]
    ])
    // A drifted shared copy (written by something outside the log) is rebuilt on start.
    const bad = JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'sport_tracker_json'")[0].values[0][0]))
    bad.data.water.currentMl = 400
    remote.run("UPDATE settings SET value = ? WHERE key = 'sport_tracker_json'", [JSON.stringify(bad)])
    const next = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 'next', undefined, (async (_u: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }) as unknown as typeof fetch))
    await next.ready
    const changes = await next.write((db) => repairFromLog(db as any))
    expect(changes).toEqual([{ day: sportToday(), what: 'water', from: 400, to: 1750 }])
    expect(remoteWater()).toBe(1750)
  })
})

describe('reps use the same log', () => {
  it('Sporty, an offline PC (Today buttons / island), an undo and the embedded app: one total everywhere', async () => {
    const phone = await device('phone')
    const pc = await device('pc')
    const server = await device('server')
    // Sporty / Telegram: +20 push-ups on the server.
    await server.mirror.write((db) => logReps(db as any, 'pushups', 20, 'sporty'))
    // The PC offline: Today's "+10" (updateSport → the log).
    pc.net.offline = true
    pc.local((d) => (d.exercises.find((e: any) => e.id === 'ex_pushups').doneToday += 10), 'pc')
    await new Promise((r) => setTimeout(r, 0))
    pc.net.offline = false
    // The island +5 and its undo (−5), on the PC.
    pc.local((d) => (d.exercises.find((e: any) => e.id === 'ex_pushups').doneToday += 5), 'island')
    pc.local((d) => (d.exercises.find((e: any) => e.id === 'ex_pushups').doneToday -= 5), 'island')
    // The phone's embedded Sport Track app: +15.
    await phone.mirror.refresh()
    await phone.mirror.write((db) => logChanges(db as any, [{ kind: 'reps:ex_pushups', amount: 15, id: 'st-r1' }], 'sport'))
    await settle(pc, phone, server)
    await settle(pc, phone, server)
    expect([repsOn(phone), repsOn(pc)]).toEqual([45, 45])
    expect(await server.mirror.read((db) => sharedView(sportNow(db as any), sportToday()).exercises.find((e) => e.id === 'ex_pushups')?.done)).toBe(45)
  })
})

describe('a logged set never makes the sync drop a new exercise', () => {
  it('the log writes the reps first, the sync after: the exercise added here and its reps stay', async () => {
    const pc = await device('pc')
    // Body → Training: the first set of a move you never did adds the exercise and its reps, with push-ups done too
    // (updateSport → the log at once); the app notes the edit, and its sync runs a moment later.
    pc.local((d) => {
      d.exercises.push({ id: 'ex_new_rows', name: 'Table rows', target: 24, unit: 'reps', active: false, doneToday: 10 })
      d.exercises.find((e: any) => e.id === 'ex_pushups').doneToday += 5
    }, 'body')
    pc.store.setItem('life_sync_sport_tracker_json_edited', String(Date.now()))
    // The log's write lands a little after the edit (it rewrites the shared copy with the new sums).
    vi.setSystemTime(Date.now() + 800)
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
    vi.setSystemTime(Date.now() + 700)
    await pc.sync.sync()
    const ids = (s: any) => (s?.exercises ?? []).map((e: any) => e.id)
    const mine = JSON.parse(pc.store.getItem(SPORT_KEY) || 'null')
    expect(ids(mine)).toContain('ex_new_rows')
    expect(ids(await pc.mirror.read((db) => sportNow(db as any)))).toContain('ex_new_rows')
    expect(mine.exercises.find((e: any) => e.id === 'ex_new_rows').doneToday).toBe(10)
  })
})

// Goal plans booked into the calendar, rebooked after a miss; the coach's history.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import type { CalEvent } from '@core/dayTime'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createRhythm } from './rhythmBot'
import { getSetting } from '../../../main/settings'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fakeCalendar() {
  let n = 0
  const events: CalEvent[] = []
  return {
    events,
    api: {
      events: async (from: string, to: string) => events.filter((e) => e.start >= from && e.start < to),
      create: async (e: { title: string; start: string; end: string }) => {
        const ev = { id: `e${++n}`, calendarId: 'main', title: e.title, start: e.start, end: e.end, allDay: false, ours: true }
        events.push(ev)
        return ev
      },
      move: async () => {},
      remove: async (_c: string, id: string) => {
        const i = events.findIndex((e) => e.id === id)
        if (i >= 0) events.splice(i, 1)
      }
    }
  }
}

async function setup() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
    const out = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) }
  })
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const cal = fakeCalendar()
  const rhythm = createRhythm({ mirror, services, todoist: null, calendar: cal.api, ai: null })
  return { mirror, services, cal, rhythm }
}

describe('goal plans in the calendar', () => {
  it('books 7 days of blocks, then replaces the future ones when re-planned (the deadline holds)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T07:00:00'))
    const { mirror, services, cal, rhythm } = await setup()
    await mirror.write((db) => services.services(db).focus.saveGoal({ title: 'Pass the algebra exam', subject: 'Algebra', deadline: '2026-11-12', hours: 14 }))
    const plans = await rhythm.goalPlans()
    expect(plans[0]).toMatchObject({ leftMin: 840, daysLeft: 10, perDayMin: 85 })
    const r = await rhythm.bookGoals()
    expect(r.ok).toBe(true)
    expect(r.lines[0]).toContain('Pass the algebra exam: 7 blocks')
    expect(cal.events).toHaveLength(7)
    expect(cal.events.every((e) => e.title === 'Algebra: Pass the algebra exam')).toBe(true)
    // A day later with nothing done: the old future blocks go, new bigger ones come.
    vi.setSystemTime(new Date('2026-11-03T07:00:00'))
    const lines = await rhythm.rebookGoals()
    expect(lines.some((l) => l.includes('Replaced'))).toBe(true)
    const after = await rhythm.goalPlans()
    expect(after[0].perDayMin).toBe(95) // 840 min over 9 days
    // 95 min a day would be needed: one session a deadline a day, at most 90 min (planDeadlines), for the 7 days from today.
    const perDayBooked = new Map<string, number>()
    for (const e of cal.events) {
      const d = new Date(e.start).toDateString()
      perDayBooked.set(d, (perDayBooked.get(d) ?? 0) + (Date.parse(e.end) - Date.parse(e.start)) / 60000)
    }
    expect([...perDayBooked.values()].slice(-7)).toEqual([90, 90, 90, 90, 90, 90, 90])
  })

  it('records the coach history: plan proposed, approved, the evening score, promises', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T08:00:00'))
    const { mirror, rhythm } = await setup()
    await rhythm.propose()
    await rhythm.approve()
    await rhythm.countPromise('2026-11-02', 'kept')
    vi.setSystemTime(new Date('2026-11-02T21:00:00'))
    const ev = await rhythm.evening()
    const h = await mirror.read((db) => JSON.parse(getSetting(db as any, 'coach_history') || '{}'))
    expect(h.days['2026-11-02']).toMatchObject({ plan: 'approved', kept: 1, score: ev.score })
  })
})

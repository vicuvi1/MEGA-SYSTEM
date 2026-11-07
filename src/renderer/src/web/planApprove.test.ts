// Approving a day plan writes exactly one calendar event per block, even when
// the approval runs twice or at the same moment as the plan editor's own sync
// (the bug: every block landed in Google Calendar twice). Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import type { CalEvent } from '@core/dayTime'
import { planJobs } from '@core/planSync'
import { planItems } from '@core/planEdit'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createRhythm } from './rhythmBot'
import { getSetting, setSetting } from '../../../main/settings'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Like Google: an id given by the app is made once; writing it again updates that event. */
function fakeGoogle() {
  let n = 0
  const events: (CalEvent & { colorId?: string | null; description?: string | null })[] = []
  let creates = 0
  return {
    events,
    get creates() {
      return creates
    },
    api: {
      events: async (from: string, to: string) => events.filter((e) => e.start >= from && e.start < to),
      create: async (e: { title: string; start: string; end: string; description?: string; colorId?: string; id?: string }) => {
        creates++
        // Slow, like the network: the other writer gets in between.
        await new Promise((r) => setTimeout(r, 5))
        const had = e.id ? events.find((x) => x.id === e.id) : undefined
        if (had) return Object.assign(had, { title: e.title, start: e.start, end: e.end })
        const ev = { id: e.id ?? `e${++n}`, calendarId: 'main', title: e.title, start: e.start, end: e.end, allDay: false, ours: true, colorId: e.colorId ?? null, description: e.description ?? null }
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
  const cal = fakeGoogle()
  const rhythm = createRhythm({ mirror, services, todoist: null, calendar: cal.api, ai: null })
  // Two goals that need time today, so the plan has real blocks.
  await mirror.write((db) => {
    services.services(db).focus.saveGoal({ title: 'Pass the algebra exam', subject: 'Algebra', deadline: '2026-11-06', hours: 6 })
    services.services(db).focus.saveGoal({ title: 'Finish the essay', subject: 'Writing', deadline: '2026-11-05', hours: 4 })
  })
  return { mirror, cal, rhythm }
}

const state = (mirror: Mirror) => mirror.read((db) => JSON.parse(getSetting(db as any, 'coach_rhythm') || '{}'))

describe('approving a day plan', () => {
  it('approve twice (or with the plan editor at the same moment): one event per block', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T08:00:00'))
    const { mirror, cal, rhythm } = await setup()
    await rhythm.propose()
    const before = await state(mirror)
    const blocks = planItems(before.briefing.plan)
    expect(blocks.length).toBeGreaterThan(0)
    // The plan editor sees "approved" before the approval saved its events, and sends the blocks too.
    const approving = rhythm.approve()
    await new Promise((r) => setTimeout(r, 1))
    const half = await state(mirror)
    const editor = planJobs(half.briefing.plan, { status: 'approved', taskId: () => undefined, nowMin: 8 * 60 })
    const editorWrites = Promise.all(editor.jobs.filter((j) => j.google?.kind === 'create').map((j) => cal.api.create(j.google as any)))
    await Promise.all([approving, editorWrites])
    // Both wrote, but every block is in the calendar once.
    expect(cal.creates).toBeGreaterThan(blocks.length)
    expect(cal.events).toHaveLength(blocks.length)
    // Approved again from scratch (an older device that lost the event ids): still once.
    await mirror.write((db) => {
      const s = JSON.parse(getSetting(db as any, 'coach_rhythm') || '{}')
      s.briefing.status = 'proposed'
      s.briefing.plan.blocks = s.briefing.plan.blocks.map(({ sync: _s, ...b }: any) => b)
      if (s.briefing.plan.training) delete s.briefing.plan.training.sync
      setSetting(db as any, 'coach_rhythm', JSON.stringify(s))
    })
    await rhythm.approve()
    expect(cal.events).toHaveLength(blocks.length)
    // Each block remembers its event, and the events look like their kind.
    const after = await state(mirror)
    const ids = planItems(after.briefing.plan).map((b) => b.sync?.eventId)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(blocks.length)
    expect(cal.events.every((e) => /^\p{Extended_Pictographic}/u.test(e.title) && !!e.colorId)).toBe(true)
  })
})

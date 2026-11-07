// LT6 + LT14: every Telegram button that changes your data, table-driven, on a
// fake Turso with made-up data. Each tap is delivered twice (Telegram retries)
// and must count once: points, water and undo stay honest.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { PLAN_ASK } from '@core/focusBot'
import { handlePipeline } from '../fakeTurso'
import { Mirror } from '../mirror'
import { TursoHttp } from '../tursoHttp'
import { createWebServices } from '../webServices'
import { createWebBots } from '../webBots'
import { CALLBACKS } from './callbacks'
import { setSetting } from '../../../../main/settings'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

const TOKEN = '1:fake'
const CHAT = 42

async function world() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-01T08:00:00Z', '2026-10-01', 'x', 'adjust', 100, 0, NULL, 'start')`)
  const sent: { method: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      sent.push({ method: String(url).split('/').pop() ?? '', body: init?.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '{"ok":true}' }
    }
    const out = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) }
  })
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const w = createWebServices(mirror)
  const bots = createWebBots({ mirror, services: w, defaults: { botToken: TOKEN, chatId: String(CHAT) } as any })
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  const setting = (key: string) => {
    const v = q(`SELECT value FROM settings WHERE key = '${key}'`)[0]?.[0]
    return v == null ? null : JSON.parse(String(v))
  }
  const points = () => Number(q('SELECT COALESCE(SUM(coins), 0) FROM ledger')[0][0])
  const water = () => Number(setting('sport_tracker_json')?.data?.water?.currentMl ?? 0)
  let n = 0
  const tap = (data: string, opts: { id?: string; chat?: number; text?: string } = {}) =>
    bots.handleUpdate(TOKEN, { update_id: ++n, callback_query: { id: opts.id ?? `cb${n}`, data, message: { chat: { id: opts.chat ?? CHAT }, message_id: 7, text: opts.text ?? 'card' } } })
  const say = (text: string, reply_to_message?: any) => bots.handleUpdate(TOKEN, { update_id: ++n, message: { chat: { id: CHAT }, text, reply_to_message } })
  const day = await w.read((s) => s.wallet.today())
  return { remote, mirror, w, bots, sent, q, setting, points, water, tap, say, day }
}
type World = Awaited<ReturnType<typeof world>>

interface Case {
  name: string
  /** Made before the tap. */
  setup?: (w: World) => Promise<unknown>
  data: (w: World) => string
  text?: string
  /** Answers with a toast only (no message text back). */
  quiet?: boolean
  check: (w: World, before: { points: number; water: number }) => void | Promise<void>
}

const CASES: Case[] = [
  {
    name: 'wa| adds water to the shared log',
    data: () => 'wa|250',
    check: (w, b) => expect(w.water()).toBe(b.water + 250)
  },
  {
    name: 'wa| with a minus takes water back (never below 0)',
    setup: (w) => w.tap('wa|500'),
    data: () => 'wa|-250',
    check: (w, b) => expect(w.water()).toBe(b.water - 250)
  },
  {
    name: 'wk| ticks reps on the workout card',
    setup: (w) => w.tap('wa|show'),
    data: () => 'wk|0|10',
    check: (w) => expect(w.setting('sport_tracker_json')?.data?.exercises?.some((e: any) => Number(e.doneToday) > 0)).toBe(true)
  },
  {
    name: 'pp| ticks a must-do and pays its points once',
    setup: (w) => w.say('1. Essay\n2. Gym', { text: `Good morning! ${PLAN_ASK}` }),
    data: (w) => `pp|${w.day}|0`,
    text: 'plan',
    check: (w, b) => expect(w.points()).toBeGreaterThan(b.points)
  },
  {
    name: 'fo| starts focus, fx| stops it',
    data: () => 'fo|25|Made-up study',
    check: async (w) => {
      expect((await w.w.focus.state()).running).toMatchObject({ subject: 'Made-up study', planned: 25 })
      await w.tap('fx|')
      expect((await w.w.focus.state()).running).toBeNull()
    }
  },
  {
    name: 'mz| "Nothing spent" closes the evening money ask and pays nothing',
    data: () => 'mz|0',
    check: (w, b) => {
      expect(w.points()).toBe(b.points)
      expect(w.sent.some((s) => String(s.body?.text ?? '').includes('nothing spent today'))).toBe(true)
      expect(w.setting('money_nothing_spent')).toEqual([w.day])
    }
  },
  {
    name: 'np| pauses nudges for today',
    data: () => 'np|',
    check: (w) => expect(w.setting('coach_nudges')).toMatchObject({ pausedDay: w.day })
  },
  {
    name: 'ns| snoozes nudges for 30 minutes',
    data: () => 'ns|',
    check: (w) => expect(Date.parse(w.setting('coach_nudges')?.snoozeUntil)).toBeGreaterThan(Date.now() + 25 * 60000)
  },
  {
    name: 'md| logs a mood on the desk',
    data: () => 'md|4',
    check: (w) => expect(w.setting('ben_desk')?.moods).toHaveLength(1)
  },
  {
    name: 'fq| saves how a focus session went',
    data: (w) => `fq|${w.day}|4|25`,
    check: (w) => expect(w.setting('focus_ratings')).toEqual([{ day: w.day, rating: 4, minutes: 25 }])
  },
  {
    name: 'rm| answers your reminder: Done (the island card goes too)',
    setup: (w) => w.mirror.write((db) => setSetting(db as any, 'coach_reminders', JSON.stringify([{ id: 'r1', at: '2026-10-02T15:00:00.000Z', text: 'call mom', kind: 'remind', done: true, sentAt: '2026-10-02T15:00:00.000Z', createdAt: '2026-10-02T14:00:00.000Z' }]))),
    data: () => 'rm|d|r1',
    check: (w) => expect(w.setting('coach_reminders')[0]).toMatchObject({ id: 'r1', done: true, handled: true })
  },
  {
    name: 'rm| snoozes your reminder: it comes back once on both',
    setup: (w) => w.mirror.write((db) => setSetting(db as any, 'coach_reminders', JSON.stringify([{ id: 'r2', at: '2026-10-02T15:00:00.000Z', text: 'stretch', kind: 'remind', done: true, sentAt: '2026-10-02T15:00:00.000Z', createdAt: '2026-10-02T14:00:00.000Z' }]))),
    data: () => 'rm|s|r2',
    check: (w) => {
      const r = w.setting('coach_reminders')[0]
      expect(r).toMatchObject({ id: 'r2', done: false, sentAt: null, handled: false })
      expect(Date.parse(r.at) - Date.now()).toBeGreaterThan(9 * 60_000)
    }
  },
  {
    name: 'bf| saves feedback on a reply',
    data: () => `bf|${Date.parse('2026-10-02T10:00:00Z')}|up`,
    quiet: true,
    check: (w) => expect(w.setting('coach_feedback')?.[0]).toMatchObject({ kind: 'up' })
  },
  {
    name: 'cr|g grades a flashcard once (the log grows by one), and shows the next card',
    setup: (w) =>
      w.mirror.write((db) =>
        setSetting(db as any, 'career_cards', JSON.stringify({ cards: [{ id: 'k1', front: 'Made-up port?', back: '1234', deck: 'Ports', created: w.day, due: w.day, ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: null }, { id: 'k2', front: 'Second?', back: 'yes', deck: 'Ports', created: w.day, due: w.day, ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: null }], log: [] }))
      ),
    data: () => 'cr|g|k1|g',
    check: (w) => {
      const v = w.setting('career_cards')
      expect(v.log).toHaveLength(1)
      expect(v.cards[0]).toMatchObject({ id: 'k1', reps: 1, ivl: 1, last: w.day })
      expect(w.sent.some((s) => String(s.body?.text ?? '').includes('Second?'))).toBe(true)
    }
  },
  {
    name: 'cr|f marks a job follow-up done; cr|p answers "pay yourself first"',
    setup: (w) => w.mirror.write((db) => setSetting(db as any, 'career_jobs', JSON.stringify({ quota: 3, jobs: [{ id: 'j1', company: 'Made-up Ltd', role: 'Intern', link: null, stage: 'applied', added: '2026-10-01', applied: '2026-10-01', followUp: '2026-10-08', chased: 0, notes: '', moves: [] }] }))),
    data: () => 'cr|f|j1',
    check: async (w) => {
      expect(w.setting('career_jobs').jobs[0]).toMatchObject({ chased: 1 })
      await w.tap('cr|p|demo-tx|600')
      expect(w.setting('career_money').answers).toEqual([expect.objectContaining({ txId: 'demo-tx', moved: 600 })])
    }
  },
  {
    name: 'cu| undoes what Ben did in a reply (water back)',
    setup: async (w) => {
      await w.tap('wa|500')
      const at = '2026-10-02T10:00:00.000Z'
      await w.mirror.write((db) => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
          'coach_log',
          JSON.stringify([{ role: 'coach', bot: 'mega', via: 'telegram', text: '💧 +250 ml', at, done: ['💧 +250 ml'], undo: [{ k: 'water', ml: -250, day: w.day }] }])
        )
      })
    },
    data: () => `cu|${Date.parse('2026-10-02T10:00:00.000Z')}`,
    check: (w, b) => {
      expect(w.water()).toBe(b.water - 250)
      expect(w.setting('coach_log')[0].undone).toEqual([true])
    }
  }
]

describe('Telegram buttons (LT6 table)', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const w = await world()
      if (c.setup) await c.setup(w)
      const before = { points: w.points(), water: w.water() }
      const data = c.data(w)
      const r = await w.tap(data, { id: 'same-tap', text: c.text })
      if (!c.quiet) expect(r).not.toBeNull()
      await c.check(w, before)
      // The same tap delivered again changes nothing (no double points or water).
      const mid = { points: w.points(), water: w.water() }
      await w.tap(data, { id: 'same-tap', text: c.text })
      expect({ points: w.points(), water: w.water() }).toEqual(mid)
    }, 30_000)
  }

  it('a tap from a stranger changes nothing', async () => {
    const w = await world()
    expect(await w.tap('wa|250', { chat: 999 })).toBeNull()
    expect(w.water()).toBe(0)
  })

  it('anything that is not a bot button is ignored', async () => {
    const w = await world()
    expect(await w.tap('zz|1')).toBeNull()
  })

  it('every handler names its prefixes, and only the last one takes the rest', () => {
    for (const h of CALLBACKS.slice(0, -1)) {
      expect(h.prefixes.length).toBeGreaterThan(0)
      for (const p of h.prefixes) expect(CALLBACKS.some((x) => x.prefixes.includes(p) && x.match(`${p}|x|y`)), p).toBe(true)
    }
    expect(CALLBACKS[CALLBACKS.length - 1].match('fa|1|2')).toBe(true)
  })
})

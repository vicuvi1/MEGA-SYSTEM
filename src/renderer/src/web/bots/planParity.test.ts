// Telegram parity and auto-rescue on a fake Turso, with a made-up plan and a
// fake Todoist: the plan message and buttons match the app card, Too much
// today / Move to tomorrow / Undo, the end-of-day check, a rescue's Accept and
// Undo, and a quick-add for today all write the same data the app reads.
// Strangers are ignored. Pinned clock: Tuesday 12 March 2030, 10:31.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { PLANNER_VERSION, RHYTHM } from '@core/rhythm'
import { dedupePlan } from '@core/planDedupe'
import { ensureIds } from '@core/planEdit'
import { rescueKey } from '@core/planRescue'
import { handlePipeline } from '../fakeTurso'
import { Mirror } from '../mirror'
import { TursoHttp } from '../tursoHttp'
import { createWebServices } from '../webServices'
import { createWebBots } from '../webBots'
import { setSetting } from '../../../../main/settings'
import { planMessageOf } from './planButtons'
import { rescueCheck } from '../planShared'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const TOKEN = '1:fake'
const CHAT = 42
const DAY = '2030-03-12'

const plan = (status: 'proposed' | 'approved' = 'proposed') => ({
  day: DAY,
  headline: 'Lab first',
  mustdos: ['Lab report'],
  blocks: [
    { id: 'lab', title: 'Lab report', start: '10:00', minutes: 60, kind: 'focus', tasks: ['Lab report'] },
    { id: 'read', title: 'Read chapter 3', start: '13:00', minutes: 60, kind: 'focus', tasks: ['Read chapter 3'] },
    { id: 'tidy', title: 'Tidy notes', start: '15:00', minutes: 45, kind: 'focus', tasks: ['Tidy notes'] }
  ],
  training: null,
  waterMl: 2500,
  also: [
    { id: 't1', title: 'Lab report', minutes: 60, priority: 4, at: '10:00' },
    { id: 't2', title: 'Read chapter 3', minutes: 60, priority: 2, at: '13:00' },
    { id: 't3', title: 'Tidy notes', minutes: 45, priority: 1, at: '15:00' },
    // The duplicate the owner saw: a task of a block, again without its block.
    { id: 't2', title: 'Read chapter 3', minutes: 60, priority: 2 },
    { id: 't4', title: 'Water the plants', minutes: 10, priority: 1, project: 'Home' }
  ],
  ...(status === 'approved' ? {} : {})
})

async function world(o: { status?: 'proposed' | 'approved'; hm?: string; limit?: number } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${DAY}T${o.hm ?? '10:31'}:00`))
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
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
  const services = createWebServices(mirror)
  const todoist = {
    today: async () => [
      { id: 't1', content: 'Lab report', priority: 4, due: DAY, dueTime: null, project: null, recurring: false },
      { id: 't2', content: 'Read chapter 3', priority: 2, due: DAY, dueTime: null, project: null, recurring: false },
      { id: 't3', content: 'Tidy notes', priority: 1, due: DAY, dueTime: null, project: null, recurring: false }
    ],
    close: vi.fn(async (_id: string) => {}),
    update: vi.fn(async (_id: string, _p: { due?: string }) => {}),
    quickAdd: vi.fn(async (text: string) => ({ id: 'n1', content: text, priority: 1, due: DAY, dueTime: null, project: null, recurring: false }))
  }
  const ai = vi.fn(async () => JSON.stringify({ reply: 'The model answered.', actions: [], remember: [] }))
  const bots = createWebBots({ mirror, services, defaults: { botToken: TOKEN, chatId: String(CHAT) } as any, todoist, ai })
  await mirror.write((db: any) => {
    setSetting(db, RHYTHM, JSON.stringify({ day: DAY, water: [], briefing: { status: o.status ?? 'proposed', sentAt: new Date().toISOString(), version: 1, planner: PLANNER_VERSION, plan: plan() } }))
    if (o.limit) setSetting(db, 'plan_limits', JSON.stringify({ maxFocusMin: o.limit, offAt: null, protect: [], caps: [] }))
  })
  const setting = (key: string) => {
    const v = remote.exec(`SELECT value FROM settings WHERE key = '${key}'`)[0]?.values?.[0]?.[0]
    return v == null ? null : JSON.parse(String(v))
  }
  let n = 0
  const tap = (data: string, chat = CHAT) => bots.handleUpdate(TOKEN, { update_id: ++n, callback_query: { id: `cb${n}`, data, message: { chat: { id: chat }, message_id: 7, text: 'Your day' } } })
  const say = (text: string, chat = CHAT) => bots.handleUpdate(TOKEN, { update_id: ++n, message: { message_id: 100 + n, chat: { id: chat }, from: { id: chat }, date: Math.floor(Date.now() / 1000), text } })
  const lastText = () => [...sent].reverse().find((s) => s.method === 'sendMessage' || s.method === 'editMessageText')?.body
  return { bots, sent, setting, tap, say, mirror, services, todoist, lastText }
}

describe('Telegram parity: the plan message', () => {
  it('shows the same blocks as the app plan, each thing once, with the app card buttons', async () => {
    const w = await world()
    const m = (await planMessageOf({ mirror: w.mirror, services: w.services }))!
    const app = dedupePlan(ensureIds(plan() as any)).blocks.map((b) => `${b.start}–`)
    for (const s of app) expect(m.text).toContain(s)
    expect(m.text.split('Read chapter 3').length - 1).toBe(1)
    expect(m.text).toMatch(/Also today \(1\)<\/b>\n· Water the plants · 10 min · no slot yet · Home/)
    const datas = m.keyboard.inline_keyboard.flat().map((b) => b.callback_data)
    for (const d of ['rb|a', 'rb|e', 'pb|r', 'pb|t', 'pb|w|0', 'pb|w|2']) expect(datas).toContain(d)
  })
})

describe('Telegram parity: Too much today, Move to tomorrow, Undo', () => {
  it('Too much today keeps the must-do, moves the rest past your limit to tomorrow, and Undo gives it back', async () => {
    const w = await world({ limit: 90 })
    await w.tap('pb|t')
    const st = w.setting(RHYTHM)
    expect(st.briefing.version).toBe(2)
    expect(st.briefing.plan.blocks.map((b: any) => b.id)).toContain('lab')
    expect(st.briefing.plan.deferred.map((d: any) => d.title)).toEqual(expect.arrayContaining(['Tidy notes']))
    expect(w.todoist.update).toHaveBeenCalledWith('t3', { due: '2030-03-13' })
    const receipt = w.sent.find((s) => s.method === 'sendMessage' && /Moved \d to tomorrow/.test(s.body.text))
    const undo = receipt!.body.reply_markup.inline_keyboard[0][0]
    expect(undo.text).toBe('↩ Undo')
    w.todoist.update.mockClear()
    await w.tap(undo.callback_data)
    const back = w.setting(RHYTHM).briefing.plan
    expect(back.blocks.map((b: any) => b.id)).toEqual(['lab', 'read', 'tidy'])
    expect(back.deferred ?? []).toEqual([])
    expect(w.todoist.update).toHaveBeenCalledWith('t3', { due: DAY })
  })

  it('Move <block> to tomorrow on a draft; an approved plan refuses', async () => {
    const w = await world()
    await w.tap('pb|w|2')
    expect(w.setting(RHYTHM).briefing.plan.blocks.map((b: any) => b.id)).toEqual(['lab', 'read'])
    expect(w.todoist.update).toHaveBeenCalledWith('t3', { due: '2030-03-13' })
    const a = await world({ status: 'approved' })
    await a.tap('pb|w|2')
    expect(a.setting(RHYTHM).briefing.plan.blocks).toHaveLength(3)
    expect(a.todoist.update).not.toHaveBeenCalled()
  })

  it('a stranger tapping does nothing', async () => {
    const w = await world({ limit: 90 })
    await w.tap('pb|t', 999)
    await w.tap('pc|d|lab', 999)
    await w.tap(`bp|a|${rescueKey('lab')}`, 999)
    expect(w.setting(RHYTHM).briefing.version).toBe(1)
    expect(w.setting('plan_review')).toBeNull()
  })
})

describe('Telegram parity: the end-of-day check', () => {
  it('one message with a row per block; Done closes the task once (paid once), Tomorrow gives it tomorrow', async () => {
    const w = await world({ hm: '16:00' })
    await w.tap('pb|c')
    const msg = w.sent.find((s) => s.method === 'sendMessage' && /Check the day/.test(s.body.text))!
    expect(msg.body.reply_markup.inline_keyboard).toHaveLength(3)
    expect(msg.body.reply_markup.inline_keyboard[0][0].callback_data).toBe('pc|d|lab')
    await w.tap('pc|d|lab')
    expect(w.setting('plan_review').days[DAY].items.lab).toMatchObject({ outcome: 'done', title: 'Lab report' })
    expect(w.todoist.close).toHaveBeenCalledWith('t1')
    const p = w.setting(RHYTHM).briefing.plan
    expect(p.blocks.find((b: any) => b.id === 'lab').done).toEqual(['Lab report'])
    expect(p.closed).toEqual(['t1'])
    const paid = () => w.services.read((s) => s.wallet.entries().filter((e: any) => e.ref === 'todoist:t1').length)
    expect(await paid()).toBe(1)
    // The same mark again changes nothing, and nothing is paid twice.
    await w.tap('pc|d|lab')
    expect(w.todoist.close).toHaveBeenCalledTimes(1)
    expect(await paid()).toBe(1)
    await w.tap('pc|t|read')
    expect(w.todoist.update).toHaveBeenCalledWith('t2', { due: '2030-03-13' })
    expect(w.setting(RHYTHM).briefing.plan.blocks.map((b: any) => b.id)).toContain('read')
    await w.tap('pc|x|tidy')
    expect(w.setting('plan_review').days[DAY].items.tidy.outcome).toBe('drop')
    const edit = w.sent.filter((s) => s.method === 'editMessageText').pop()!
    expect(edit.body.text).toMatch(/3 of 3 blocks checked: 1 done, 1 to tomorrow, 1 dropped/)
  })
})

describe('Auto-rescue on Telegram', () => {
  it('Accept applies the offered plan (drafts only) and Undo takes it back', async () => {
    const w = await world({ limit: 120 })
    const push = await w.mirror.write((db: any) => rescueCheck(db, w.services.services(db), { now: new Date(), events: [], on: true, running: false, meeting: false, quiet: false, here: false }))
    expect(push?.key).toBe(rescueKey('lab'))
    // Over the 2h limit: the last draft goes, and the list task with no room (as Too much today does).
    expect(push?.text).toBe("Rescue: start 'Lab report' now for 60 min, move 'Tidy notes' and 'Water the plants' to tomorrow.")
    await w.tap(`bp|a|${push!.key}`)
    let p = w.setting(RHYTHM).briefing.plan
    expect(p.blocks.find((b: any) => b.id === 'lab')).toMatchObject({ start: '10:35', minutes: 60 })
    expect(p.blocks.find((b: any) => b.id === 'read').start).toBe('13:00')
    expect(p.deferred.map((d: any) => d.title)).toEqual(['Tidy notes', 'Water the plants'])
    expect(w.todoist.update).toHaveBeenCalledWith('t3', { due: '2030-03-13' })
    expect(w.setting('ben_pushes').recs[push!.key].ans).toBe('accept')
    const undo = w.sent.find((s) => s.method === 'editMessageReplyMarkup' && s.body.reply_markup.inline_keyboard[0]?.[0]?.text === '↩ Undo')!
    expect(undo.body.reply_markup.inline_keyboard[0][0].callback_data).toBe(`bp|u|${push!.key}`)
    // Accept twice does nothing more.
    await w.tap(`bp|a|${push!.key}`)
    expect(w.setting(RHYTHM).briefing.version).toBe(2)
    await w.tap(`bp|u|${push!.key}`)
    p = w.setting(RHYTHM).briefing.plan
    expect(p.blocks.find((b: any) => b.id === 'lab').start).toBe('10:00')
    expect(p.deferred ?? []).toEqual([])
    expect(w.todoist.update).toHaveBeenCalledWith('t3', { due: DAY })
    expect(w.todoist.update).toHaveBeenCalledWith('t4', { due: DAY })
  })

  it('Not now snoozes 15 minutes once; no second offer for the same block after Skip', async () => {
    const w = await world()
    const check = () => w.mirror.write((db: any) => rescueCheck(db, w.services.services(db), { now: new Date(), events: [], on: true, running: false, meeting: false, quiet: false, here: false }))
    const p = await check()
    await w.mirror.write((db: any) => {
      const log = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ben_pushes'").get()?.value ?? 'null') ?? { day: DAY, recs: {}, outbox: [] }
      log.day = DAY
      log.recs[p!.key] = { at: Date.now(), via: 'telegram' }
      setSetting(db, 'ben_pushes', JSON.stringify(log))
    })
    await w.tap(`bp|l|${p!.key}`)
    expect(w.setting('ben_pushes').recs[p!.key]).toMatchObject({ ans: 'later' })
    expect(w.setting('ben_pushes').recs[p!.key].until - Date.now()).toBe(15 * 60_000)
    expect(await check()).toBeNull()
    vi.setSystemTime(new Date(`${DAY}T10:47:00`))
    const again = await check()
    expect(again?.key).toBe(rescueKey('lab', true))
  })
})

describe('Telegram parity: quick-add in words', () => {
  it('"+ lab notes 30m" adds the Todoist task and a draft block in today\'s plan', async () => {
    const w = await world()
    await w.say('+ lab notes 30m')
    expect(w.todoist.quickAdd).toHaveBeenCalledWith('Lab notes today for 30 min')
    const p = w.setting(RHYTHM).briefing.plan
    const b = p.blocks.find((x: any) => x.title === 'Lab notes')
    expect(b).toMatchObject({ minutes: 30, tasks: ['Lab notes'] })
    expect(b.start >= '10:35').toBe(true)
    expect(w.lastText()?.text).toMatch(/Added: Lab notes · today · 30 min\. It is in today's plan at \d\d:\d\d for 30 min/)
  })

  it('"task lab report tomorrow 2h" goes to Todoist for tomorrow, the plan stays', async () => {
    const w = await world()
    await w.say('task lab report tomorrow 2h')
    expect(w.todoist.quickAdd).toHaveBeenCalledWith('Lab report tomorrow for 120 min')
    expect(w.setting(RHYTHM).briefing.version).toBe(1)
  })
})

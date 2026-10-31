import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { focusCoins, goalProgress, parsePlan, sessionMinutes } from '@core/focus'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createWebBots } from './webBots'
import { PLAN_ASK } from '@core/focusBot'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

async function web() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-01T08:00:00Z', '2026-10-01', 'x', 'adjust', 100, 0, NULL, 'start')`)
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
    const out = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) }
  })
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  return { remote, mirror, w: createWebServices(mirror) }
}
const num = (db: any, sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0)

describe('focus, plans and goals (pure)', () => {
  it('coins: 1 per 5 minutes, +5 for a full 50', () => {
    expect([focusCoins(4), focusCoins(25), focusCoins(50), focusCoins(90)]).toEqual([0, 5, 15, 23])
  })
  it('a session counts up to 30 minutes over plan and never over 4 hours', () => {
    const t = Date.parse('2026-10-31T10:00:00Z')
    expect(sessionMinutes('2026-10-31T10:00:00Z', 50, new Date(t + 52 * 60000))).toBe(52)
    expect(sessionMinutes('2026-10-31T10:00:00Z', 50, new Date(t + 300 * 60000))).toBe(80)
  })
  it('reads a plan however you write it', () => {
    expect(parsePlan('1. Essay intro\n2) Gym\n- call Leo')).toEqual(['Essay intro', 'Gym', 'call Leo'])
    expect(parsePlan('essay; gym; read 20 pages')).toEqual(['essay', 'gym', 'read 20 pages'])
  })
  it('a goal says what each week needs and if you are ahead or behind', () => {
    const g = { id: 1, title: 'Math exam', subject: 'Math', deadline: '2026-12-31', hours: 40, createdDay: '2026-11-01' }
    const p = goalProgress(g, 10 * 60, '2026-12-01') // half the time gone, a quarter done
    expect(p.daysLeft).toBe(30)
    expect(p.aheadH).toBeLessThan(0)
    expect(p.perWeekH).toBeCloseTo(7, 0)
  })
})

describe('focus, plans and goals (saved in Turso)', () => {
  it('start, stop: minutes logged once, coins paid, timer cleared', async () => {
    const { remote, mirror, w } = await web()
    const t0 = new Date()
    await mirror.write((db) => w.services(db).focus.start('Math', 50, t0))
    await expect(mirror.write((db) => w.services(db).focus.start('Math', 50, t0))).rejects.toThrow(/already running/)
    const res = await mirror.write((db) => w.services(db).focus.stop(new Date(t0.getTime() + 50 * 60000)))
    expect(res).toMatchObject({ session: { subject: 'Math', minutes: 50 }, coins: 15 })
    expect(num(remote, "SELECT SUM(coins) FROM ledger WHERE module = 'focus'")).toBe(15)
    expect((await w.focus.state()).running).toBeNull()
    expect((await w.focus.state()).todayMin).toBe(50)
  })

  it('the plan: tick a must-do once for coins, review with reasons', async () => {
    const { remote, w } = await web()
    await w.focus.setPlan(['Essay', 'Gym', 'Call Leo'])
    expect((await w.focus.togglePlan(0)).coins).toBe(10)
    await w.focus.togglePlan(0) // untick
    expect((await w.focus.togglePlan(0)).coins).toBe(0) // re-tick: paid already
    const p = await w.focus.review('Good day', ['Tired', 'Tired', 'Phone / social media'])
    expect(p).toMatchObject({ review: 'Good day', reasons: ['Tired', 'Phone / social media'] })
    expect(num(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id = 'plan.item_done'")).toBe(1)
  })

  it('fun costs coins and can never go below zero', async () => {
    const { w } = await web()
    expect(await w.focus.fun(30, 'YouTube')).toMatchObject({ cost: 30, balance: 70 })
    await expect(w.focus.fun(200)).rejects.toThrow(/Not enough coins/)
    expect((await w.focus.state()).funToday).toBe(30)
  })

  it('goals count focus minutes of their subject', async () => {
    const { w } = await web()
    await w.focus.saveGoal({ title: 'Math exam', subject: 'Math', deadline: '2027-01-15', hours: 40 })
    await w.focus.add('math', 90)
    const st = await w.focus.state()
    expect(st.goals[0]).toMatchObject({ title: 'Math exam', doneMin: 90 })
    expect(st.week.totalMin).toBe(90)
  })

  it('the bot: /focus, /stop, a reply to the morning question, a must-do button, /fun, /week', async () => {
    const { w, mirror } = await web()
    const sent: any[] = []
    const real = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      if (String(url).startsWith('https://api.telegram.org/')) {
        sent.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) })
        return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '{"ok":true}' }
      }
      return (real as any)(url, init)
    })
    const bots = createWebBots({ mirror, services: w, defaults: { botToken: '1:x', chatId: '42' } as any })
    let id = 0
    const say = (text: string, reply_to_message?: any) => bots.handleUpdate('1:x', { update_id: ++id, message: { chat: { id: 42 }, text, reply_to_message } })
    expect(await say('/focus 25 math')).toMatch(/Focus started:<\/b> math · 25 min/)
    expect(await say('/focus')).toMatch(/Focusing on math/)
    expect(await say('/stop')).toMatch(/logged/)
    expect(await say('1. Essay\n2. Gym', { text: `Good morning! ${PLAN_ASK}` })).toMatch(/Plan saved[\s\S]*Essay[\s\S]*Gym/)
    const day = await w.read((s) => s.wallet.today())
    const tap = await bots.handleUpdate('1:x', { update_id: ++id, callback_query: { id: 'c1', data: `pp|${day}|0`, message: { chat: { id: 42 }, message_id: 3, text: 'plan' } } })
    expect(tap).toMatch(/✅ 1\. Essay/)
    expect(await say('/fun 10 youtube')).toMatch(/−10 coins/)
    expect(await say('/week')).toMatch(/Your week[\s\S]*Must-dos: <b>1\/2/)
    expect(sent.some((m) => m.method === 'answerCallbackQuery' && /\+10 coins/.test(m.body.text))).toBe(true)
    // ▶ under the coach starts a session on the must-do; ⏹ stops it and offers to tick it.
    const cb = (data: string) => bots.handleUpdate('1:x', { update_id: ++id, callback_query: { id: `c${id}`, data, message: { chat: { id: 42 }, message_id: 9, text: 'coach' } } })
    expect(await cb('fo|Gym')).toMatch(/Focus started:<\/b> Gym · 50 min/)
    expect((await w.focus.state()).running).toMatchObject({ subject: 'Gym', task: { kind: 'mustdo', ref: 'Gym' } })
    const stopped = await cb('fx|')
    expect(stopped).toMatch(/Finished “Gym”\?/)
    const kb = sent.filter((m) => m.method === 'editMessageText').pop()!.body.reply_markup
    expect(kb.inline_keyboard[0][0]).toMatchObject({ text: '✅ Yes, tick it', callback_data: `pp|${day}|1` })
    // The sleep coach asks how you slept under the wake-up; a tap saves it.
    expect(await say('/wake')).toMatch(/How did you sleep\?/)
    const wakeKb = sent.filter((m) => m.method === 'sendMessage').pop()!.body.reply_markup
    expect(wakeKb.inline_keyboard[0]).toHaveLength(5)
    const rated = await bots.handleUpdate('1:x', { update_id: ++id, callback_query: { id: 'sq1', data: `sq|${day}|2`, message: { chat: { id: 42 }, message_id: 11, text: 'Wake-up logged: 07:00\n\n😴 How did you sleep?' } } })
    expect(rated).toMatch(/Sleep: <b>2\/5<\/b>\. Rough night/)
    expect(await mirror.read((db) => (db as any).prepare('SELECT quality FROM sleep_logs WHERE day = ?').get(day))).toMatchObject({ quality: 2 })
  })

  it('a session for a Todoist task remembers it until it stops', async () => {
    const { mirror, w } = await web()
    await mirror.write((db) => w.services(db).focus.start('University', 50, new Date(), { kind: 'todoist', ref: '777', title: 'Finish etica' }))
    const r = await mirror.write((db) => w.services(db).focus.stop())
    expect(r.task).toEqual({ kind: 'todoist', ref: '777', title: 'Finish etica' })
    expect((await w.focus.state()).running).toBeNull()
  })
})

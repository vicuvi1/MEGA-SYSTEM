// The food counter on Telegram and in Ben's pushes, end to end on a fake Turso
// and a fake Telegram (made-up meals, pinned clocks): a pasted AI reply → a
// preview → −/+25 g or "chicken 175" → Save (the same rows as the app, no
// points) → Undo; /food sends the prompt; a stranger changes nothing; the
// dinner reminder and the evening protein nudge once a day, only while away;
// "Mute food nudges for 7 days"; "what should I eat now?" with no model call;
// the Sunday food report's numbers.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { addDays } from '../core/dates'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, runTick } from './telegramBot'
import { evalWorld } from './benEval'
import { addFoodMeal } from '../main/food'
import { setSetting } from '../main/settings'
import { foodSundayNow } from '../renderer/src/web/bots/foodBot'
import type { AskModel } from '../renderer/src/web/webBots'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const TOKEN = '777:test-token'
const CHAT = '42'
let n = 0
// The rhythm off: only the pushes speak. Protein goal 2.0 g/kg × 75 kg = 150 g.
// The coach's own nudges are off here (coachTalk.server.test.ts covers them and the shared cap).
const NO_COACH = { coachMorning: false, coachProtein: false, coachCheckin: false }
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '06:30', sleep_weekend_target: '06:30', sleep_bed_target: '23:30', life_fit: { push: 'firm', pushes: NO_COACH }, body_plus: { gPerKg: 2 } }

function world(settings: Record<string, unknown> = base) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  // These tests check the older senders, so the daily push budget (Simple mode) is off here.
  remote.exec(`INSERT INTO settings (key, value) VALUES ('simple_mode', '{"budget":false}')`)
  for (const [k, v] of Object.entries(settings)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  remote.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-01', 75, '2030-03-01T08:00:00Z')")
  const sent: { method: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org')) {
      sent.push({ method: u.split('/').pop() ?? '', body: init.body ? JSON.parse(init.body) : null })
      const json = { ok: true, result: { message_id: sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const env = { tursoUrl: `https://food${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { env, sent, setting, q, remote }
}
const msgs = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => s.body)
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
let uid = 5000
const msg = (text: string, chat = CHAT) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })
const tap = (data: string, chat = CHAT) => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat) } } } })

const REPLY = `Here's my estimate:
\`\`\`json
{"items":[{"name":"chicken breast","grams":150,"protein_g":46,"carbs_g":0,"fat_g":5,"kcal":230,"confidence":"roughly"},{"name":"rice","grams":200,"protein_g":5,"carbs_g":56,"fat_g":1,"kcal":260,"confidence":"sure"}],"question":"Was it cooked in oil?"}
\`\`\`
Hope that helps!`

describe('food on Telegram', () => {
  it('paste → preview → +25 g and "chicken 175" → Save (same rows as the app, no points) → Undo', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    const ledger0 = w.q('SELECT COUNT(*) FROM ledger')[0][0]
    await handleTelegramUpdate(w.env as any, TOKEN, msg(REPLY))
    const prev = msgs(w.sent).pop()
    expect(prev.text).toMatch(/1\. Chicken breast · 150 g · 46 g protein · 230 kcal/)
    expect(prev.text).toMatch(/Total: 51 g protein · 490 kcal/)
    expect(prev.text).toMatch(/Was it cooked in oil\?/)
    const id = w.setting('food_ben').draft.id
    expect(prev.reply_markup.inline_keyboard.pop().map((b: any) => b.callback_data)).toEqual([`fd|s|${id}`, `fd|e|${id}`, `fd|x|${id}`])
    // Nothing saved yet.
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'protein:food'")[0][0]).toBe(0)

    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|+|${id}|1`))
    expect(w.setting('food_ben').draft.items[1].grams).toBe(225)
    const edited = w.sent.filter((s) => s.method === 'editMessageText').pop()!.body
    expect(edited.text).toMatch(/2\. Rice · 225 g/)

    await handleTelegramUpdate(w.env as any, TOKEN, msg('chicken 175'))
    expect(msgs(w.sent).pop().text).toMatch(/1\. Chicken breast · 175 g · 54 g protein · 268 kcal/)
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind LIKE 'protein:%'")[0][0]).toBe(0) // an edit, not a protein log

    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    const saved = w.sent.filter((s) => s.method === 'editMessageText').pop()!.body
    expect(saved.text).toMatch(/Saved:.*Chicken breast, Rice · 59 g protein · 561 kcal/)
    expect(saved.text).toMatch(/Protein 59 \/ 150 g/)
    expect(w.q("SELECT amount, source FROM body_log WHERE kind = 'protein:food'")).toEqual([[59, 'telegram']])
    expect(w.q("SELECT amount FROM body_log WHERE kind = 'kcal:food'")).toEqual([[561]])
    expect(w.setting('food_log').meals[0].items.map((i: any) => i.grams)).toEqual([175, 225])
    expect(w.setting('food_ben').draft).toBeNull()
    expect(w.q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(ledger0) // no points for food
    // A second Save on the closed preview does nothing.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'protein:food'")[0][0]).toBe(1)

    const undo = saved.reply_markup.inline_keyboard[0][0].callback_data
    expect(undo).toMatch(/^fd\|u\|fd-/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(undo))
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'protein:food' AND undoes IS NOT NULL")[0][0]).toBe(1)
  }, 30_000)

  it('/food sends the prompt; an unreadable reply says so; Cancel saves nothing', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/food'))
    expect(msgs(w.sent).pop().text).toMatch(/<pre>Look at the meal in my photo/)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/food label'))
    expect(msgs(w.sent).pop().text).toMatch(/label/i)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('```json\n{"items": "protein maybe kcal 12"}\n```'))
    expect(msgs(w.sent).pop().text).toMatch(/I couldn't read that reply/)
    await handleTelegramUpdate(w.env as any, TOKEN, msg(REPLY))
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|x|${id}`))
    expect(w.sent.filter((s) => s.method === 'editMessageText').pop()!.body.text).toMatch(/Cancelled\. Nothing saved/)
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'protein:food'")[0][0]).toBe(0)
  }, 30_000)

  it('a stranger pasting a reply or tapping Save changes nothing', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg(REPLY, '999999'))
    expect(w.setting('food_ben')).toBeNull()
    expect(msgs(w.sent).some((m) => /Check the meal/.test(m.text ?? ''))).toBe(false)
    await handleTelegramUpdate(w.env as any, TOKEN, msg(REPLY))
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`, '999999'))
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'protein:food'")[0][0]).toBe(0)
  }, 30_000)
})

describe('food pushes on the tick', () => {
  it('dinner reminder at ~21:00 when nothing was logged since 17:00, once, not while at the PC; Same as yesterday opens a preview', async () => {
    // Meal reminders off here (they would ask about dinner first: see foodTelegram.server.test.ts).
    const w = world({ ...base, life_fit: { push: 'firm', pushes: { ...NO_COACH, meals: false } } })
    // Yesterday's dinner, to repeat.
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/start'))
    w.remote.run("INSERT INTO body_log (id, at, day, kind, amount, source) VALUES ('fd-y1-p', '2030-03-11T19:00:00.000Z', '2030-03-11', 'protein:food', 45, 'app'), ('fd-y1-k', '2030-03-11T19:00:00.000Z', '2030-03-11', 'kcal:food', 600, 'app')")
    w.remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['food_log', JSON.stringify({ meals: [{ id: 'fd-y1', at: '2030-03-11T19:00:00.000Z', day: '2030-03-11', name: 'Salmon, potatoes', type: 'dinner', items: [{ name: 'salmon', grams: 150, protein: 33, carbs: 0, fat: 18, kcal: 300, confidence: 'roughly' }, { name: 'potatoes', grams: 250, protein: 12, carbs: 50, fat: 1, kcal: 300, confidence: 'roughly' }] }], favs: [] })])
    await runTick(w.env as any, at('2030-03-12T20:40:00'))
    expect(msgs(w.sent).filter((m) => /Log dinner/.test(m.text ?? ''))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T21:05:00'))
    const d = msgs(w.sent).filter((m) => /Log dinner/.test(m.text ?? ''))
    expect(d).toHaveLength(1)
    expect(d[0].text).toMatch(/Log dinner\? Copy the prompt or Same as yesterday\./)
    expect(d[0].reply_markup.inline_keyboard.map((r: any) => r[0].callback_data)).toEqual(['fd|p|food:dinner:2030-03-12', 'fd|y|food:dinner:2030-03-12', 'fd|m|food:dinner:2030-03-12'])
    await runTick(w.env as any, at('2030-03-12T21:20:00'))
    expect(msgs(w.sent).filter((m) => /Log dinner/.test(m.text ?? ''))).toHaveLength(1)
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|y|food:dinner:2030-03-12'))
    expect(msgs(w.sent).pop().text).toMatch(/1\. Salmon · 150 g · 33 g protein/)
    expect(w.setting('ben_pushes').recs['food:dinner:2030-03-12'].ans).toBe('yesterday')
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|p|food:dinner:2030-03-12'))
    expect(msgs(w.sent).pop().text).toMatch(/<pre>Look at the meal/)
    // At the PC: the island shows it, Telegram stays quiet.
    const pc = world({ ...base, ben_pc_seen: { at: new Date('2030-03-12T21:04:00').getTime(), active: true } })
    await runTick(pc.env as any, at('2030-03-12T21:05:00'))
    expect(msgs(pc.sent).filter((m) => /Log dinner/.test(m.text ?? ''))).toHaveLength(0)
  }, 60_000)

  it('evening nudge when short on protein after dinner; never in quiet hours; "Mute food nudges for 7 days" holds the next days', async () => {
    const w = world()
    at('2030-03-12T18:30:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg(REPLY))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${w.setting('food_ben').draft.id}`)) // 51 g of 150
    await runTick(w.env as any, at('2030-03-12T20:35:00'))
    const e = msgs(w.sent).filter((m) => /protein short today/.test(m.text ?? ''))
    expect(e).toHaveLength(1)
    expect(e[0].text).toMatch(/99 g protein short today: .+ fixes it\./)
    expect(w.setting('ben_pushes').recs['food:evening:2030-03-12'].via).toBe('telegram')
    await runTick(w.env as any, at('2030-03-12T21:10:00'))
    expect(msgs(w.sent).filter((m) => /protein short today|Log dinner/.test(m.text ?? ''))).toHaveLength(1) // one a day
    const mute = e[0].reply_markup.inline_keyboard.flat().find((b: any) => /Mute/.test(b.text)).callback_data
    expect(mute).toBe('fd|m|food:evening:2030-03-12')
    await handleTelegramUpdate(w.env as any, TOKEN, tap(mute))
    expect(w.setting('food_ben').muteUntil).toBe(new Date('2030-03-19T21:10:00').getTime())
    await runTick(w.env as any, at('2030-03-13T21:05:00'))
    expect(msgs(w.sent).filter((m) => /Log dinner/.test(m.text ?? ''))).toHaveLength(0)
    // Quiet hours from 21:00: no dinner reminder.
    const q = world({ ...base, notif_settings: { quiet: { from: '21:00', to: '07:00' } } })
    await runTick(q.env as any, at('2030-03-12T21:05:00'))
    expect(msgs(q.sent).filter((m) => /Log dinner/.test(m.text ?? ''))).toHaveLength(0)
  }, 60_000)
})

describe('Ask Ben and the Sunday report', () => {
  it('"what should I eat now?" is answered from the food log with no model call, fast', async () => {
    const calls: string[] = []
    const model: AskModel = async (_p, opts = {}) => {
      calls.push(opts.kind ?? 'chat')
      return JSON.stringify({ reply: 'model answer', actions: [], remember: [] })
    }
    const world = await evalWorld(SQL, model)
    await world.mirror.write((db: any) => {
      setSetting(db, 'body_plus', JSON.stringify({ gPerKg: 2 }))
      db.prepare("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2020-01-01', 75, '2020-01-01T08:00:00Z')").run()
      addFoodMeal(db, { items: [{ name: 'eggs', grams: 120, protein: 15, carbs: 1, fat: 12, kcal: 170 }] }, 'app')
    })
    for (const q of ['what should I eat now?', 'ce sa mananc']) {
      // "No model call" is what the `calls` check below proves; the wall clock only guards a hang
      // (500 ms failed when 400 test files ran at once and this file's workers were starved).
      const t0 = Date.now()
      const r = await world.bots.think(q, `food:${q}`, () => {})
      expect(Date.now() - t0).toBeLessThan(10_000)
      expect(r.reply).toMatch(/135 g protein left today/)
      expect(r.reply).toMatch(/So far: Protein 15 \/ 150 g · 170 \/ [\d,]+ kcal today\./)
    }
    expect(calls.filter((k) => k.startsWith('chat'))).toEqual([])
  }, 30_000)

  it('the Sunday food report: averages vs goal, weight over the week, days on goal, one tip', () => {
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.exec(m)
    const wrap = { prepare: (sql: string) => { const st = db.prepare(sql); return { all: (...a: any[]) => { st.bind(a); const out: any[] = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out }, get: (...a: any[]) => { st.bind(a); const r = st.step() ? st.getAsObject() : undefined; st.free(); return r }, run: (...a: any[]) => { st.run(a); st.free() } } } }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-03-17T20:00:00')) // a Sunday
    db.run("INSERT INTO settings (key, value) VALUES ('body_plus', '{\"gPerKg\":2}')")
    db.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-11', 75.2, 'x'), ('2030-03-17', 75.5, 'x')")
    const protein = [150, 120, 160, 0, 110, 155, 130]
    protein.forEach((g, i) => {
      const day = addDays('2030-03-17', i - 6)
      if (g) db.run('INSERT INTO body_log (id, at, day, kind, amount, source) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)', [`fd-w${i}-p`, `${day}T12:00:00.000Z`, day, 'protein:food', g, 'app', `fd-w${i}-k`, `${day}T12:00:00.000Z`, day, 'kcal:food', 2500, 'app'])
    })
    const r = foodSundayNow(wrap as any)!
    expect(r.lines[0]).toBe('Protein: 138 g a day on average (goal 150 g), on the 6 days you logged it')
    expect(r.lines[1]).toMatch(/^Calories: 2,500 kcal a day on the 6 days you logged meals \(goal [\d,]+\)$/)
    expect(r.lines[2]).toBe('Weight: 75.2 → 75.5 kg (+0.3 kg this week)')
    expect(r.lines[3]).toBe('Days on the protein goal: 3 of 7')
    expect(r.tip).toMatch(/Protein is 12 g a day short/)
  })
})

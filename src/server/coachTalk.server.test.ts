// The coach talks, end to end on a fake Turso, a fake Telegram and a fake
// model (made-up data, pinned clocks): the evening check-in push → 3 taps →
// saved with the coach's reply (the rule text when the AI fails); the nudges'
// one daily cap with the meal reminders; Ask the coach with the red-flag
// reply (no model), the missed-session fast path (no model), the reply guard,
// and a proposal → Apply → the standard day changes → Undo.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, runTick } from './telegramBot'
import { seedSaved } from '../core/foodSaved'
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

const TOKEN = '778:test-token'
const CHAT = '42'
let n = 0
const DAY = '2030-03-12' // a Tuesday
// Made-up week: Tuesday is Upper, nothing logged today yet.
const sport = { data: { lastDate: DAY, exercises: [], days: {}, sets: {}, history: [], sportySettings: {}, trainWeek: { v: 1, days: ['rest', 'upper', 'legs', 'rest', 'upper', 'legs', 'rest'], updatedAt: 1 }, trainLog: [{ id: 's1', type: 'legs', date: '2030-03-09', startedAt: 1, durationSec: 1200, done: true, exercises: [{ ladder: 'legs', move: 'squat', exId: 'ex1', sets: [{ reps: 12 }] }] }] } }
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '07:00', sleep_weekend_target: '07:00', sleep_bed_target: '23:59', life_fit: { push: 'firm' }, body_plus: { gPerKg: 2 }, sport_tracker_json: sport, food_saved: seedSaved() }

function world(settings: Record<string, unknown> = base, model?: AskModel) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  // These tests check the older senders, so the daily push budget (Simple mode) is off here.
  remote.exec(`INSERT INTO settings (key, value) VALUES ('simple_mode', '{"budget":false}')`)
  for (const [k, v] of Object.entries(settings)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  remote.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-01', 62, '2030-03-01T08:00:00Z')")
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
  const env = { tursoUrl: `https://coach${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN }, ...(model ? { model } : {}) }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { env, sent, setting, q, remote }
}
const msgs = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => s.body)
const edits = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'editMessageText').map((s) => s.body)
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
let uid = 9000
const msg = (text: string, chat = CHAT) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })
const tap = (data: string, chat = CHAT) => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat) } } } })
const coachPushes = (sent: { method: string; body: any }[]) => msgs(sent).filter((m) => /Evening check-in|Protein|Good morning/.test(m.text))

describe('the evening check-in on Telegram', () => {
  it('~21:00 push with the logs → energy → soreness → sleep → saved with a reply; the AI failing gives the rule text', async () => {
    const failing: AskModel = async (_p, opts = {}) => {
      if (opts.kind === 'nudge') throw new Error('model down')
      return JSON.stringify({ reply: 'ok', actions: [], remember: [] })
    }
    const w = world(base, failing)
    w.remote.run(`INSERT INTO body_log (id, at, day, kind, amount, source, undoes) VALUES ('m1-p', '${DAY}T13:00:00.000Z', '${DAY}', 'protein:food', 60, 'app', NULL), ('m1-k', '${DAY}T13:00:00.000Z', '${DAY}', 'kcal:food', 1500, 'app', NULL)`)
    // Last night: in bed 23:30, up 07:00 → 7.5 h (prefilled).
    w.remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES ('2030-03-11', '07:00', '07:00', 1, '23:30', '23:59', 1, 4, '2030-03-11T07:00:00Z'), ('2030-03-12', '07:00', '07:00', 1, NULL, '23:59', 0, 4, '2030-03-12T07:00:00Z')")
    await runTick(w.env as any, at(`${DAY}T20:40:00`))
    expect(coachPushes(w.sent).filter((m) => /check-in/.test(m.text)).map((m) => m.text)).toEqual([]) // not yet
    await runTick(w.env as any, at(`${DAY}T21:05:00`))
    const push = coachPushes(w.sent).find((m) => /Evening check-in/.test(m.text))!
    expect(push.text).toMatch(/Food: 1,500 \/ [\d,]+ kcal · 60 \/ \d+ g protein/)
    expect(push.text).toMatch(/Workout: Upper body not done/)
    expect(push.text).toMatch(/Weigh-in: not today/)
    expect(push.text).toMatch(/Sleep last night: 7.5 h \(from your log\)/)
    expect(push.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['ck|e|1', 'ck|e|2', 'ck|e|3', 'ck|e|4', 'ck|e|5'])
    expect(w.setting('ben_pushes').recs[`coach:checkin:${DAY}`]).toBeTruthy()
    // Once: the next tick sends nothing new.
    await runTick(w.env as any, at(`${DAY}T21:20:00`))
    expect(coachPushes(w.sent).filter((m) => /Evening check-in/.test(m.text))).toHaveLength(1)

    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|e|4'))
    expect(edits(w.sent).pop().text).toMatch(/Energy 4\/5\nSoreness\?/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|s|42'))
    const sleepStep = edits(w.sent).pop()
    expect(sleepStep.text).toMatch(/Sleep last night\?/)
    expect(sleepStep.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toContain('✓ 7.5 h')
    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|h|42|15'))
    const done = edits(w.sent).pop()
    expect(done.text).toMatch(/Energy 4\/5 · Soreness 2\/5 · Sleep 7.5 h/)
    // The rule text (the model failed): kcal short → an add-on toward the goal.
    expect(done.text).toMatch(/💬 Good sleep last night: 7.5 h\. Tomorrow, add .+ to reach [\d,]+ kcal\./)
    const c = w.setting('coach_days').days[DAY].checkin
    expect(c).toMatchObject({ energy: 4, soreness: 2, sleep: 7.5 })
    expect(c.reply).toMatch(/^Good sleep last night/)
    // A second tap later: already done, nothing changes.
    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|e|1'))
    expect(w.setting('coach_days').days[DAY].checkin.energy).toBe(4)
    expect(w.q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(0) // no points
  }, 30_000)

  it('the AI phrases the reply when it keeps the numbers; a stranger’s taps change nothing', async () => {
    const phrasing: AskModel = async (p, opts = {}) => (opts.kind === 'nudge' ? JSON.stringify({ reply: `Nice rest of the day. ${/reach ([\d,]+) kcal/.exec(p)?.[1] ? `Tomorrow add a glass of milk to reach ${/reach ([\d,]+) kcal/.exec(p)![1]} kcal.` : 'Tomorrow keep going.'}` }) : JSON.stringify({ reply: 'ok', actions: [], remember: [] }))
    const w = world(base, phrasing)
    at(`${DAY}T21:30:00`)
    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|h|33|14', '999'))
    expect(w.setting('coach_days')?.days?.[DAY]?.checkin).toBeFalsy()
    await handleTelegramUpdate(w.env as any, TOKEN, tap('ck|h|33|14'))
    expect(w.setting('coach_days').days[DAY].checkin.reply).toMatch(/^Nice rest of the day\./)
  }, 30_000)
})

describe('the nudges’ one cap', () => {
  it('two meal reminders went out: no morning nudge (the check-in keeps its place); the switch turns a type off', async () => {
    const log = { day: DAY, recs: { [`meal:${DAY}:morning`]: { at: 1, via: 'telegram' }, [`meal:${DAY}:lunch`]: { at: 2, via: 'telegram' } }, outbox: [] }
    const w = world({ ...base, ben_pushes: log })
    await runTick(w.env as any, at(`${DAY}T07:10:00`))
    expect(coachPushes(w.sent)).toHaveLength(0)
    const free = world(base)
    await runTick(free.env as any, at(`${DAY}T07:10:00`))
    const m = coachPushes(free.sent).find((x) => /Good morning/.test(x.text))
    expect(m?.text).toMatch(/Upper body today 💪 Banana \+ a glass of milk first, then wait 20–30 min\./)
    const off = world({ ...base, life_fit: { push: 'firm', pushes: { coachMorning: false } } })
    await runTick(off.env as any, at(`${DAY}T07:10:00`))
    expect(coachPushes(off.sent)).toHaveLength(0)
    // At the PC: the island shows it, Telegram stays quiet.
    const pc = world({ ...base, ben_pc_seen: { at: new Date(`${DAY}T07:09:00`).getTime(), active: true } })
    await runTick(pc.env as any, at(`${DAY}T07:10:00`))
    expect(coachPushes(pc.sent)).toHaveLength(0)
  }, 30_000)
})

describe('Ask the coach', () => {
  const calls: string[] = []
  const model =
    (reply: object): AskModel =>
    async (_p, opts = {}) => {
      calls.push(opts.kind ?? 'chat')
      return JSON.stringify({ actions: [], remember: [], ...reply })
    }

  it('red-flag words: only the doctor line, no model call (EN and RO)', async () => {
    calls.length = 0
    const w = world(base, model({ reply: 'Do 3 sets of 10 slow push-ups.' }))
    at(`${DAY}T18:00:00`)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('I felt dizzy and my chest hurts after push-ups, how many reps tomorrow?'))
    const en = msgs(w.sent).pop().text
    expect(en).toMatch(/Stop training for today and see a doctor/)
    expect(en).not.toMatch(/\b(sets?|reps?|push-?ups?)\b/i)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('am leșinat la antrenament azi'))
    expect(msgs(w.sent).pop().text).toMatch(/Oprește antrenamentul azi și mergi la medic/)
    expect(calls.filter((k) => k.startsWith('chat'))).toEqual([])
  }, 30_000)

  it('"I missed Tuesday, what now?" in code, no model call', async () => {
    calls.length = 0
    const w = world(base, model({ reply: 'model answer' }))
    at('2030-03-14T18:00:00') // Thursday: a rest day
    await handleTelegramUpdate(w.env as any, TOKEN, msg('I missed Tuesday, what now?'))
    // Wednesday's Legs was missed too and is the one that fits today (48 hours since the last legs).
    expect(msgs(w.sent).pop().text).toMatch(/^The missed Legs \+ core fits today: those muscles have had 48 hours/)
    expect(calls.filter((k) => k.startsWith('chat'))).toEqual([])
  }, 30_000)

  it('the guard takes out an under-2,200 or cut sentence from the model’s reply', async () => {
    const w = world(base, model({ reply: 'Eat 1,800 kcal a day for a while. Have 3 eggs with breakfast tomorrow.' }))
    at(`${DAY}T18:00:00`)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('how many calories should I eat for my bulk?'))
    const text = msgs(w.sent).pop().text
    expect(text).toMatch(/3 eggs with breakfast/)
    expect(text).not.toMatch(/1,800/)
  }, 30_000)

  it('a proposal shows Apply / Not now; Apply changes the standard day; Undo puts it back; a made-up food is never offered', async () => {
    const w = world(base, model({ reply: 'Swap the bread in your morning meal for a banana: same effort, more food.', propose: { kind: 'swap', slot: 'Morning', from: 'Rye bread', to: 'Banana' } }))
    at(`${DAY}T18:00:00`)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('can you change my morning meal so I eat more?'))
    const m = msgs(w.sent).pop()
    expect(m.text).toMatch(/💡 Morning: Banana instead of Rye bread/)
    const rows = m.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)
    const apply = rows.find((d: string) => d.startsWith('cp|a|'))
    expect(apply).toBeTruthy()
    expect(rows.find((d: string) => d.startsWith('cp|n|'))).toBeTruthy()
    // Nothing changed yet.
    expect(w.setting('food_saved').day.slots[0].items[1].foodId).toBe('sf-bread')
    await handleTelegramUpdate(w.env as any, TOKEN, tap(apply))
    expect(w.setting('food_saved').day.slots[0].items[1].foodId).toBe('sf-banana')
    const after = edits(w.sent).pop()
    expect(after.text).toMatch(/Applied: Morning: Banana instead of Rye bread/)
    const undo = after.reply_markup.inline_keyboard[0][0].callback_data
    expect(undo).toBe(apply.replace('cp|a|', 'cp|u|'))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(undo))
    expect(w.setting('food_saved').day.slots[0].items[1].foodId).toBe('sf-bread')
    // A second Apply on an undone proposal does nothing.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(apply))
    expect(w.setting('food_saved').day.slots[0].items[1].foodId).toBe('sf-bread')

    const bad = world(base, model({ reply: 'Try pizza.', propose: { kind: 'swap', slot: 'Morning', from: 'Rye bread', to: 'Pizza' } }))
    await handleTelegramUpdate(bad.env as any, TOKEN, msg('what should I change in my lunch meal?'))
    const b = msgs(bad.sent).pop()
    expect(JSON.stringify(b.reply_markup ?? {})).not.toMatch(/cp\|a\|/)
    expect(bad.setting('coach_props')?.list ?? []).toHaveLength(0)
  }, 30_000)

  it('moving a session: Apply changes the week (48-hour rule), Undo puts it back', async () => {
    const w = world(base, model({ reply: 'Move Tuesday to Thursday this week.', propose: { kind: 'move', from: 'Tuesday', to: 'Thursday' } }))
    at(`${DAY}T08:00:00`)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('can I move my Tuesday training session to Thursday?'))
    const m = msgs(w.sent).pop()
    expect(m.text).toMatch(/Move Tuesday's training to Thursday/)
    const apply = m.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data).find((d: string) => d.startsWith('cp|a|'))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(apply))
    // Tuesday's Upper on Thursday; Friday's Upper would follow it, so the 48-hour rule rests Friday.
    expect(w.setting('sport_tracker_json').data.trainWeek.days).toEqual(['rest', 'rest', 'legs', 'upper', 'rest', 'legs', 'rest'])
    await handleTelegramUpdate(w.env as any, TOKEN, tap(apply.replace('cp|a|', 'cp|u|')))
    expect(w.setting('sport_tracker_json').data.trainWeek.days).toEqual(['rest', 'upper', 'legs', 'rest', 'upper', 'legs', 'rest'])
  }, 30_000)
})

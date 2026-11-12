// The new photo features on Telegram, end to end on a fake Turso, a fake
// Telegram and a fake vision read (made-up meals, pinned clocks):
// - an "after" photo within 90 minutes logs only what was eaten (the meal is changed, not doubled);
// - the meal type button; a barcode that couldn't be looked up; a label food saved as a food;
// - the food summary at night (once, never in quiet hours);
// - "Lunch? Send a photo" at his usual time learned from his logs.
import { ALL_ON, writeModules } from '@core/modules'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, runTick } from './telegramBot'

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
const NO_COACH = { coachMorning: false, coachProtein: false, coachCheckin: false }
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '07:00', sleep_weekend_target: '07:00', sleep_bed_target: '23:30', life_fit: { push: 'firm', pushes: NO_COACH }, body_plus: { gPerKg: 2 } }
const PHOTO = new TextEncoder().encode('made-up-jpeg-bytes')
const it0 = (name: string, grams: number, kcal: number, protein: number, extra: Record<string, unknown> = {}) => ({ name, matchedSavedFoodId: null, qty: 1, unit: 'serving', grams, kcal, protein, carbs: 20, fat: 5, confidence: 'medium', ...extra })

function world(settings: Record<string, unknown> = base, vision: (body: any) => Promise<any> = async () => ({ ok: true, result: { items: [it0('rice', 250, 325, 6), it0('chicken breast', 200, 330, 62)], message: 'Rice and chicken.' } })) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  // These tests use parts that are off by default (core/modules.ts): every module on, as before the switch.
  remote.run("INSERT INTO settings (key, value) VALUES ('modules_on', ?)", [writeModules(ALL_ON)])
  // These tests check the older senders, so the daily push budget (Simple mode) is off here.
  remote.exec(`INSERT INTO settings (key, value) VALUES ('simple_mode', '{"budget":false}')`)
  for (const [k, v] of Object.entries(settings)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  remote.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-01', 75, '2030-03-01T08:00:00Z')")
  const sent: { method: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org/file/')) return { ok: true, status: 200, arrayBuffer: async () => PHOTO.buffer.slice(PHOTO.byteOffset, PHOTO.byteOffset + PHOTO.byteLength) }
    if (u.includes('api.telegram.org')) {
      const method = (u.split('/').pop() ?? '').split('?')[0]
      sent.push({ method, body: init.body ? JSON.parse(init.body) : null })
      const json = method === 'getFile' ? { ok: true, result: { file_id: 'x', file_path: 'photos/file_7.jpg', file_size: PHOTO.length } } : { ok: true, result: { message_id: 900 + sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  let next = vision
  const foodPhoto = vi.fn(async (body: any) => next(body))
  const env = { tursoUrl: `https://extras${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN }, foodPhoto }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { env, sent, setting, q, setVision: (v: typeof vision) => (next = v) }
}
const texts = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage' || s.method === 'editMessageText').map((s) => s.body)
const last = (sent: { method: string; body: any }[]) => texts(sent).pop()
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
let uid = 7000
const SIZES = [{ file_id: 'mid-id', file_unique_id: 'm', width: 1280, height: 960, file_size: 150000 }]
const photo = (caption = '') => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT) }, photo: SIZES, ...(caption ? { caption } : {}) } })
const tap = (data: string) => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data, from: { id: Number(CHAT) }, message: { message_id: 1, chat: { id: Number(CHAT) }, text: '' } } })
const kcalRows = (w: ReturnType<typeof world>) => w.q("SELECT id, amount FROM body_log WHERE kind = 'kcal:food'")
const liveKcal = (w: ReturnType<typeof world>) => {
  const rows = w.q("SELECT id, amount, undoes FROM body_log WHERE kind = 'kcal:food'")
  const undone = new Set(rows.filter((r) => r[2]).map((r) => r[2]))
  return rows.filter((r) => !r[2] && !undone.has(r[0])).reduce((a, r) => a + Number(r[1]), 0)
}

describe('before and after photos on Telegram', () => {
  it('an after photo within 90 minutes changes the meal to what was eaten; its photo joins the meal', async () => {
    const w = world()
    at('2030-03-12T12:30:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const d1 = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${d1}`))
    expect(liveKcal(w)).toBe(655)
    // 40 minutes later: what is left (the AI marks leftovers).
    at('2030-03-12T13:10:00')
    w.setVision(async () => ({ ok: true, result: { items: [it0('rice', 100, 130, 2.4)], message: 'Some rice left.', leftovers: true } }))
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const prev = last(w.sent)
    expect(prev.text).toMatch(/^🍽 <b>After photo<\/b> · leftovers of Lunch \(Tue 12 Mar, 12:30\)\nLeft: 100 g rice\./)
    expect(prev.text).toMatch(/1\. <b>Rice<\/b> · 150 g\n {4}195 kcal · P 4/)
    expect(prev.text).toMatch(/Counts ~525 kcal · 66 g protein<\/b> \(the full plate was 655 kcal\)/)
    const d2 = w.setting('food_ben').draft.id
    expect(prev.reply_markup.inline_keyboard[0][0]).toEqual({ text: '✅ Update lunch: only what I ate', callback_data: `fd|s|${d2}` })
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${d2}`))
    expect(liveKcal(w)).toBe(525)
    const meals = w.setting('food_log').meals
    expect(meals).toHaveLength(1)
    expect(meals[0].items.map((i: any) => [i.name, i.grams])).toEqual([['rice', 150], ['chicken breast', 200]])
    expect(meals[0].photos).toEqual([`fp${d1}n1`, `fp${d2}n1`])
    expect(meals[0].at).toBe(new Date('2030-03-12T12:30:00').toISOString())
    expect(last(w.sent).text).toMatch(/^✅ <b>Lunch updated<\/b> · only what you ate/)
    expect(last(w.sent).text).toMatch(/🥩 \d+ g protein left today/)
  }, 60_000)

  it('the note "after" works too; "It’s a new meal" turns it back into a meal; no meal in 90 min = a new meal', async () => {
    const w = world()
    at('2030-03-12T12:30:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${w.setting('food_ben').draft.id}`))
    at('2030-03-12T13:00:00')
    w.setVision(async () => ({ ok: true, result: { items: [it0('apple', 180, 95, 0.5)], message: 'An apple.' } }))
    await handleTelegramUpdate(w.env as any, TOKEN, photo('after'))
    expect(last(w.sent).text).toMatch(/After photo/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|A|${w.setting('food_ben').draft.id}`))
    expect(last(w.sent).text).toMatch(/^📸 <b>Lunch<\/b>/)
    expect(last(w.sent).text).toMatch(/1\. <b>Apple<\/b>/)
    // Three hours later an "after" has nothing to belong to: read as a new meal, said plainly.
    at('2030-03-12T16:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('leftovers'))
    expect(last(w.sent).text).toMatch(/No photo meal in the last 90 minutes to take leftovers from/)
  }, 60_000)
})

describe('the meal type, barcodes and labels on Telegram', () => {
  it('🍽 changes the meal type in one tap; Save uses it', async () => {
    const w = world()
    at('2030-03-12T16:20:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const id = w.setting('food_ben').draft.id
    const kb = last(w.sent).reply_markup.inline_keyboard
    expect(kb[kb.length - 1][0]).toEqual({ text: '🍽 Snack · change', callback_data: `fd|t|${id}` })
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|t|${id}`))
    expect(last(w.sent).text).toMatch(/^📸 <b>Breakfast<\/b>/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|t|${id}`))
    expect(last(w.sent).text).toMatch(/^📸 <b>Lunch<\/b>/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    expect(w.setting('food_log').meals[0].type).toBe('lunch')
    expect(last(w.sent).text).toMatch(/^✅ <b>Lunch saved<\/b>/)
  }, 60_000)

  it('a barcode Open Food Facts could not answer says so; a label food becomes a saved food once', async () => {
    const w = world(base, async () => ({
      ok: true,
      result: { items: [it0('Protein yoghurt', 200, 140, 20, { fromLabel: true }), it0('granola', 40, 180, 4, { fromBarcode: true })], message: 'Yoghurt and granola.', barcode: '4006381333931', productMiss: 'offline' }
    }))
    at('2030-03-12T08:20:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const prev = last(w.sent)
    expect(prev.text).toMatch(/🔖 Barcode 4006381333931 seen, but Open Food Facts couldn't be reached: the numbers are the AI's estimate\./)
    expect(prev.text).toMatch(/<b>Protein yoghurt<\/b> · 200 g[^\n]* 🏷 label/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${w.setting('food_ben').draft.id}`))
    expect(last(w.sent).text).toMatch(/🏷 Saved as a food: Protein yoghurt \(one tap next time in Body → Food → My meals\)\./)
    const foods = w.setting('food_saved').foods.filter((f: any) => f.name === 'Protein yoghurt')
    expect(foods).toEqual([expect.objectContaining({ portionLabel: '1 portion (200 g)', grams: 200, kcal: 140, protein: 20 })])
    // The same label again: not saved twice.
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${w.setting('food_ben').draft.id}`))
    expect(w.setting('food_saved').foods.filter((f: any) => f.name === 'Protein yoghurt')).toHaveLength(1)
    expect(kcalRows(w)).toHaveLength(2)
  }, 60_000)
})

describe('the food summary at night', () => {
  it('once in its window before bed, with totals, the best meal and one change; never in quiet hours', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${w.setting('food_ben').draft.id}`))
    await runTick(w.env as any, at('2030-03-12T20:00:00'))
    expect(texts(w.sent).filter((m) => /Food today/.test(m.text ?? ''))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T22:00:00'))
    const s = texts(w.sent).filter((m) => /Food today/.test(m.text ?? ''))
    expect(s).toHaveLength(1)
    expect(s[0].text).toMatch(/^🌙 <b>Food today<\/b>\n655 \/ [\d,]+ kcal · 68 \/ 150 g protein · 1 meal\nBest meal: Lunch at 13:00, /)
    expect(s[0].text).toMatch(/\nTomorrow: Protein was 82 g short: add one protein snack in the afternoon/)
    await runTick(w.env as any, at('2030-03-12T22:30:00'))
    expect(texts(w.sent).filter((m) => /Food today/.test(m.text ?? ''))).toHaveLength(1)

    const quiet = world({ ...base, notif_settings: { quiet: { from: '21:00', to: '07:00' } } })
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(quiet.env as any, TOKEN, photo())
    await handleTelegramUpdate(quiet.env as any, TOKEN, tap(`fd|s|${quiet.setting('food_ben').draft.id}`))
    await runTick(quiet.env as any, at('2030-03-12T22:00:00'))
    expect(texts(quiet.sent).filter((m) => /Food today/.test(m.text ?? ''))).toHaveLength(0)
    // The switch turns it off.
    const off = world({ ...base, life_fit: { push: 'firm', pushes: { ...NO_COACH, foodSummary: false } } })
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(off.env as any, TOKEN, photo())
    await handleTelegramUpdate(off.env as any, TOKEN, tap(`fd|s|${off.setting('food_ben').draft.id}`))
    await runTick(off.env as any, at('2030-03-12T22:00:00'))
    expect(texts(off.sent).filter((m) => /Food today/.test(m.text ?? ''))).toHaveLength(0)
  }, 90_000)
})

describe('meal reminders at his usual time', () => {
  it('"Lunch? Send a photo" 20 minutes after his usual lunch (learned from his logs), with no standard day', async () => {
    const day = (k: number) => `2030-03-${String(12 - k).padStart(2, '0')}`
    const meals = [1, 2, 3, 4].map((k) => ({ id: `fd-u${k}`, at: new Date(`${day(k)}T14:30:00`).toISOString(), day: day(k), name: 'Pasta', type: 'lunch', items: [{ name: 'Pasta', grams: 300, protein: 15, carbs: 90, fat: 5, kcal: 465, confidence: 'roughly' }] }))
    const saved = { v: 2, foods: [{ id: 'sf-egg', name: 'Egg', portionLabel: '1 large', grams: 50, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 }], meals: [], day: { slots: [] } }
    const w = world({ ...base, food_log: { meals, favs: [] }, food_saved: saved })
    await runTick(w.env as any, at('2030-03-12T13:05:00'))
    expect(texts(w.sent).filter((m) => /Lunch\?/.test(m.text ?? ''))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T14:52:00'))
    const r = texts(w.sent).filter((m) => /Lunch\? Send a photo/.test(m.text ?? ''))
    expect(r).toHaveLength(1)
    expect(r[0].text).toMatch(/🍽 <b>Lunch<\/b>\nLunch\? Send a photo 📸$/)
    expect(r[0].reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['fd|z|meal:2030-03-12:lunch', 'fd|k|meal:2030-03-12:lunch'])
  }, 60_000)
})

describe('a LIFE-FOOD block on Telegram', () => {
  const msg = (text: string, chat = CHAT) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })
  const BLOCK = ['```', 'LIFE-FOOD v1', 'MEAL | Breakfast | 2030-03-12 08:10 | Eggs and toast', '- Eggs | 150 g | P 19 | C 1 | F 15 | FIB 0 | KCAL 215 | CONF high | 3 eggs', '- Rye bread | 60 g | P 5 | C 28 | F 1.5 | FIB 3.5 | KCAL 150 | CONF medium | -', 'MEAL | Lunch | now | Rice and chicken', '- Rice | 200 g | P 5 | C 56 | F 0.6 | KCAL 250', '- Sauce | P 0 | C 4 | F 6 | KCAL 70', 'END', '```'].join('\n')
  it('logs every meal at its own time, lists every food, warns about what it could not log, once; strangers change nothing', async () => {
    const w = world()
    at('2030-03-12T13:20:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg(BLOCK))
    const meals = [...w.setting('food_log').meals].sort((a: any, b: any) => (a.at < b.at ? -1 : 1))
    expect(meals.map((m: any) => [m.type, m.source, m.items.length, m.at])).toEqual([
      ['breakfast', 'paste', 2, new Date('2030-03-12T08:10:00').toISOString()],
      ['lunch', 'paste', 1, new Date('2030-03-12T13:20:00').toISOString()]
    ])
    expect(liveKcal(w)).toBe(615)
    const r = last(w.sent)
    expect(r.text).toMatch(/^✅ <b>Logged 2 meals<\/b> · 615 kcal · 29 g protein/)
    expect(r.text).toMatch(/<b>Breakfast<\/b> · Tue 12 Mar, 08:10 · Eggs and toast\n• Eggs 150 g: 215 kcal · P 19 · C 1 · F 15/)
    expect(r.text).toMatch(/⚠️ Line 8: Sauce has no grams/)
    expect(r.text).toMatch(/🥩 \d+ g protein left today/)
    const kb = r.reply_markup.inline_keyboard
    expect(kb[0][1].callback_data).toMatch(/^fd\|R\|fd-t/)
    expect(kb[kb.length - 1][0].text).toBe('↩ Undo all')
    // The same block again (a retry): nothing logged twice.
    await handleTelegramUpdate(w.env as any, TOKEN, msg(BLOCK))
    expect(w.setting('food_log').meals).toHaveLength(2)
    expect(liveKcal(w)).toBe(615)
    // Undo all takes both back.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(kb[kb.length - 1][0].callback_data))
    expect(liveKcal(w)).toBe(0)
    // A stranger's block: nothing logged, nothing sent.
    const before = w.sent.length
    await handleTelegramUpdate(w.env as any, TOKEN, msg(BLOCK.replace('Eggs and toast', 'Other'), '999999'))
    expect(w.setting('food_log').meals).toHaveLength(2)
    expect(w.sent.length).toBe(before)
    expect(w.q("SELECT COUNT(*) FROM ledger")[0][0]).toBe(0)
  }, 60_000)
})

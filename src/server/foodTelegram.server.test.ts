// Meal photos, saved meals and meal reminders on Telegram, end to end on a fake
// Turso, a fake Telegram (getFile + the file download) and a fake vision read
// (made-up meals, pinned clocks): photo → preview → −/+ → swap → Save once (a
// double tap logs nothing twice) → the summary line from real numbers; Cancel;
// the daily limit; a stranger's photo is never downloaded or read; the photo is
// stored nowhere; /meals and "breakfast" log a saved meal in one tap (with Undo);
// meal reminders at the standard day's slots: Log it, 30 min, Skip, the caps,
// quiet hours, the mute, the switch, the island's own check.
import { ALL_ON, writeModules } from '@core/modules'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { foodInbox, handleTelegramUpdate, runTick } from './telegramBot'
import { foodPushNow } from '../renderer/src/web/bots/foodBot'

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
// The coach's own nudges are off here (coachTalk.server.test.ts covers them and the shared cap).
const NO_COACH = { coachMorning: false, coachProtein: false, coachCheckin: false }
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '07:00', sleep_weekend_target: '07:00', sleep_bed_target: '23:30', life_fit: { push: 'firm', pushes: NO_COACH }, body_plus: { gPerKg: 2 } }
/** The photo's bytes (made up), and how they look in base64: they must never be stored or sent anywhere but the vision read. */
const PHOTO = new TextEncoder().encode('made-up-jpeg-bytes-for-a-meal-photo')
const PHOTO_B64 = Buffer.from(PHOTO).toString('base64')

const AI_OK = {
  items: [
    { name: 'eggs', matchedSavedFoodId: 'sf-egg', qty: 3, unit: 'eggs', grams: 150, kcal: 999, protein: 99, confidence: 'high' },
    { name: 'bread', matchedSavedFoodId: 'sf-bread', qty: 2, unit: 'slices', grams: 66, kcal: 1, protein: 1, confidence: 'medium' },
    { name: 'sauce', matchedSavedFoodId: null, qty: 1, unit: 'serving', grams: 30, kcal: 90, protein: 0, carbs: 3, fat: 9, confidence: 'low' }
  ],
  totals: { kcal: 0, protein: 0 },
  message: 'Eggs and bread.'
}

function world(settings: Record<string, unknown> = base, vision: (body: any) => Promise<any> = async () => ({ ok: true, result: AI_OK })) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  // These tests use parts that are off by default (core/modules.ts): every module on, as before the switch.
  remote.run("INSERT INTO settings (key, value) VALUES ('modules_on', ?)", [writeModules(ALL_ON)])
  // These tests check the older senders, so the daily push budget (Simple mode) is off here.
  remote.exec(`INSERT INTO settings (key, value) VALUES ('simple_mode', '{"budget":false}')`)
  for (const [k, v] of Object.entries(settings)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  remote.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-01', 75, '2030-03-01T08:00:00Z')")
  const sent: { method: string; body: any }[] = []
  const files: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org/file/')) {
      files.push(u)
      return { ok: true, status: 200, arrayBuffer: async () => PHOTO.buffer.slice(PHOTO.byteOffset, PHOTO.byteOffset + PHOTO.byteLength) }
    }
    if (u.includes('api.telegram.org')) {
      const method = (u.split('/').pop() ?? '').split('?')[0]
      sent.push({ method, body: init.body ? JSON.parse(init.body) : null })
      const json = method === 'getFile' ? { ok: true, result: { file_id: u.split('file_id=')[1], file_path: 'photos/file_7.jpg', file_size: PHOTO.length } } : { ok: true, result: { message_id: 900 + sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const reads: any[] = []
  const foodPhoto = vi.fn(async (body: any) => {
    reads.push(body)
    return vision(body)
  })
  const env = { tursoUrl: `https://photo${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN }, foodPhoto }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  /** Every row of every table, as text (to prove the photo is stored nowhere). */
  const everything = () =>
    q("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map(([t]) => JSON.stringify(remote.exec(`SELECT * FROM "${t}"`)))
      .join('\n')
  return { env, sent, files, reads, foodPhoto, setting, q, remote, everything }
}
const texts = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage' || s.method === 'editMessageText').map((s) => s.body)
const last = (sent: { method: string; body: any }[]) => texts(sent).pop()
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
let uid = 9000
const SIZES = [
  { file_id: 'small-id', file_unique_id: 's', width: 320, height: 240, file_size: 20000 },
  { file_id: 'mid-id', file_unique_id: 'm', width: 1280, height: 960, file_size: 150000 },
  { file_id: 'huge-id', file_unique_id: 'h', width: 2560, height: 1920, file_size: 1900000 }
]
const photo = (caption = '', chat = CHAT) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, photo: SIZES, ...(caption ? { caption } : {}) } })
const msg = (text: string, chat = CHAT) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })
const tap = (data: string, chat = CHAT, messageId = 1, text = '') => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data, from: { id: Number(chat) }, message: { message_id: messageId, chat: { id: Number(chat) }, text } } })
const foodRows = (w: ReturnType<typeof world>) => w.q("SELECT amount, source FROM body_log WHERE kind = 'kcal:food' AND undoes IS NULL")

describe('a meal photo on Telegram', () => {
  it('photo → preview → −/+ → swap → Save once → the summary line from real numbers; the photo is stored nowhere', async () => {
    const w = world()
    at('2030-03-12T08:10:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('3 eggs, 2 slices of bread'))
    // One size up to 1280 px is downloaded; the same vision read as the website gets the note and the saved foods.
    expect(w.sent.find((s) => s.method === 'getFile')).toBeTruthy()
    expect(w.files).toHaveLength(1)
    expect(w.reads).toHaveLength(1)
    expect(w.reads[0].images).toEqual([{ mime: 'image/jpeg', data: PHOTO_B64 }])
    expect(w.reads[0].note).toBe('3 eggs, 2 slices of bread')
    expect(w.reads[0].saved.map((s: any) => s.id)).toContain('sf-egg')
    expect(w.reads[0].targets.protein).toBe(150)
    expect(texts(w.sent)[0].text).toBe('📸 Reading the photo…')
    const prev = last(w.sent)
    expect(prev.message_id).toBe(901) // the "Reading…" message becomes the preview
    expect(prev.text).toMatch(/^📸 <b>Breakfast<\/b> · Tue 12 Mar, 08:10/)
    expect(prev.text).toMatch(/1\. <b>Egg<\/b> · 3 eggs · 150 g[^\n]*\n {4}216 kcal · P 19/)
    expect(prev.text).toMatch(/3\. <b>Sauce<\/b> · 30 g[^\n]*\n {4}90 kcal · P 0 · C \d+ · F \d+ · ⚠️ check it/)
    expect(prev.text).toMatch(/Total ~466 kcal · 24 g protein/)
    // The sauce was hard to see: one short question instead of a guess.
    expect(prev.text).toMatch(/About how many grams of sauce\?/)
    const id = w.setting('food_ben').draft.id
    expect(prev.reply_markup.inline_keyboard.pop().map((b: any) => b.callback_data)).toEqual([`fd|t|${id}`, `fd|N|${id}`])
    expect(foodRows(w)).toEqual([])

    // + on the eggs (4), then "eggs 3" back; swap the sauce for a saved food, then − it away to half.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|+|${id}|0`))
    expect(w.setting('food_ben').draft.photo.now[0]).toMatchObject({ qty: 4, kcal: 288 })
    await handleTelegramUpdate(w.env as any, TOKEN, msg('eggs 3'))
    expect(last(w.sent).text).toMatch(/1\. <b>Egg<\/b> · 3 eggs · 150 g[^\n]*\n {4}216 kcal/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|w|${id}|2`))
    const swapList = w.sent.filter((s) => s.method === 'editMessageReplyMarkup').pop()!.body.reply_markup.inline_keyboard
    expect(swapList.length).toBeLessThanOrEqual(7)
    const banana = swapList.find((r: any) => /^Banana/.test(r[0].text))[0].callback_data
    expect(banana).toMatch(new RegExp(`^fd\\|W\\|${id}\\|2\\|\\d+$`))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(banana))
    expect(last(w.sent).text).toMatch(/3\. <b>Banana<\/b> · 118 g[^\n]*\n {4}105 kcal · P 1/)

    // Save twice (a double tap): one meal, source 'photo', no points, and the line from the real day.
    const ledger0 = w.q('SELECT COUNT(*) FROM ledger')[0][0]
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    expect(foodRows(w)).toEqual([[481, 'telegram']])
    expect(w.setting('food_log').meals.map((m: any) => m.source)).toEqual(['photo'])
    expect(w.q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(ledger0)
    const saved = w.sent.filter((s) => s.method === 'editMessageText').pop()!.body
    expect(saved.text).toMatch(/^✅ <b>Breakfast saved<\/b> · Tue 12 Mar, 08:10\n• Egg 150 g: 216 kcal · P 19/)
    expect(saved.text).toMatch(/\n3 Egg \+ 2 Rye bread \+ Banana: ~481 kcal, 26 g protein\. Today: 481 \/ [\d,]+ kcal, 26 \/ 150 g\. ~[\d,]+ kcal left, 124 g protein; next: your lunch, afternoon, evening and anytime meals cover it \(~[\d,]+ kcal\)\.\n/)
    // Every food reply ends with the protein left today and real foods to close it; the score has its line.
    expect(saved.text).toMatch(/\n🥩 124 g protein left today: [^\n]+\.$/)
    expect(saved.text).toMatch(/\n🏅 Score <b>[A-D]<\/b>: /)
    expect(saved.reply_markup.inline_keyboard[0][0].callback_data).toMatch(/^fd\|u\|fd-p/)

    // The photo is in no table and in no message.
    expect(w.everything()).not.toContain(PHOTO_B64)
    expect(JSON.stringify(w.sent)).not.toContain(PHOTO_B64)
  }, 60_000)

  it('Cancel saves nothing; a photo the AI cannot read or over the daily limit says so plainly', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|x|${id}`))
    expect(last(w.sent).text).toMatch(/Cancelled\. Nothing saved/)
    expect(foodRows(w)).toEqual([])

    const lim = world(base, async () => ({ ok: false, error: "You've read 50 photos today, the daily limit. It starts again tomorrow.", limit: 'day' }))
    await handleTelegramUpdate(lim.env as any, TOKEN, photo())
    expect(last(lim.sent).text).toMatch(/50 photos today, the daily limit\. It starts again tomorrow\.\nOr send \/food for the copy prompt\./)
    expect(lim.setting('food_ben')).toBeNull()

    const empty = world(base, async () => ({ ok: true, result: { items: [], totals: {}, message: '' } }))
    await handleTelegramUpdate(empty.env as any, TOKEN, photo())
    expect(last(empty.sent).text).toMatch(/No food was found in the photo/)
  }, 60_000)

  it("a stranger's photo is never downloaded or read; a photo asking the coach something is not a meal", async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('', '999999'))
    expect(w.foodPhoto).not.toHaveBeenCalled()
    expect(w.files).toHaveLength(0)
    expect(w.sent).toHaveLength(0)
    expect(w.setting('food_ben')).toBeNull()
    // A stranger can't tap Save on the owner's preview either.
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`, '999999'))
    expect(foodRows(w)).toEqual([])
    // "Is this healthy?" goes to the coach, not the vision read.
    const calls = w.foodPhoto.mock.calls.length
    await handleTelegramUpdate(w.env as any, TOKEN, photo('is this healthy?'))
    expect(w.foodPhoto.mock.calls.length).toBe(calls)
  }, 60_000)
})

describe('saved meals in one tap', () => {
  it('/meals lists them as buttons; a tap logs once (a double tap too) with Undo; "breakfast" asks first', async () => {
    const w = world()
    at('2030-03-12T08:30:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/meals'))
    const menu = last(w.sent)
    expect(menu.text).toMatch(/Your saved meals/)
    const rows = menu.reply_markup.inline_keyboard
    expect(rows[0][0].callback_data).toBe('fd|g|day')
    expect(rows.map((r: any) => r[0].callback_data)).toContain('fd|g|sm-breakfast')
    for (const r of rows) expect(r[0].callback_data.length).toBeLessThanOrEqual(64)
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|g|sm-breakfast', CHAT, 50, '🍽 Your saved meals\nTap one'))
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|g|sm-breakfast', CHAT, 50, '🍽 Your saved meals\nTap one'))
    expect(foodRows(w)).toEqual([[486, 'telegram']])
    const done = last(w.sent)
    expect(done.text).toMatch(/Logged:<\/b> Breakfast: 3 eggs \+ 2 bread \+ banana · 486 kcal · 26 g protein/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(done.reply_markup.inline_keyboard[0][0].callback_data))
    expect(foodRows(w)).toEqual([[486, 'telegram']]) // the row stays; a cancel row is added
    expect(w.q("SELECT COUNT(*) FROM body_log WHERE kind = 'kcal:food' AND undoes IS NOT NULL")[0][0]).toBe(1)

    await handleTelegramUpdate(w.env as any, TOKEN, msg('breakfast'))
    const offer = last(w.sent)
    expect(offer.text).toMatch(/Breakfast: 3 eggs \+ 2 bread \+ banana<\/b> · 486 kcal · 26 g protein\nLog it now\?/)
    expect(offer.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['fd|g|sm-breakfast', 'fd|n|x'])
    await handleTelegramUpdate(w.env as any, TOKEN, msg('standard day'))
    expect(last(w.sent).reply_markup.inline_keyboard[0][0].callback_data).toBe('fd|g|day')
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|g|day', CHAT, 77))
    expect(w.setting('food_log').meals.filter((m: any) => m.slot).length).toBe(5)
    // A stranger's /meals changes nothing.
    const before = w.sent.length
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/meals', '999999'))
    expect(w.sent.length).toBe(before)
  }, 60_000)
})

describe('meal reminders on the tick', () => {
  it('at lunch when nothing was logged since breakfast: one nudge with Log it / 30 min / Skip; Log it logs the slot once', async () => {
    const w = world()
    at('2030-03-12T07:55:00')
    // Breakfast logged at 07:55 (before its 07:45 reminder could fire on this tick? it did not: logged first).
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|g|sm-breakfast', CHAT, 5))
    await runTick(w.env as any, at('2030-03-12T08:00:00'))
    expect(texts(w.sent).filter((m) => /\? Send a photo/.test(m.text ?? ''))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T12:50:00'))
    expect(texts(w.sent).filter((m) => /\? Send a photo/.test(m.text ?? ''))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T13:05:00'))
    const r = texts(w.sent).filter((m) => /Lunch\? Send a photo/.test(m.text ?? ''))
    expect(r).toHaveLength(1)
    expect(r[0].text).toMatch(/Lunch\? Send a photo, or log your usual bulgur salad with vegetables \+ Rye bread\./)
    expect(r[0].reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['fd|l|meal:2030-03-12:lunch|0', 'fd|z|meal:2030-03-12:lunch', 'fd|k|meal:2030-03-12:lunch'])
    expect(w.setting('ben_pushes').recs['meal:2030-03-12:lunch'].via).toBe('telegram')
    await runTick(w.env as any, at('2030-03-12T13:20:00'))
    expect(texts(w.sent).filter((m) => /Lunch\? Send/.test(m.text ?? ''))).toHaveLength(1) // one key per slot a day
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|l|meal:2030-03-12:lunch|0'))
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|l|meal:2030-03-12:lunch|0'))
    const lunch = w.setting('food_log').meals.filter((m: any) => m.slot === 'ds-lunch')
    expect(lunch).toHaveLength(1)
    expect(lunch[0].source).toBe('saved')
    expect(w.setting('ben_pushes').recs['meal:2030-03-12:lunch'].ans).toBe('log')
    expect(last(w.sent).text).toMatch(/Logged:<\/b> Lunch: .* · 480 kcal · 13 g protein/)
  }, 60_000)

  it('30 min later asks once more; Skip stops it; at most 3 a day; quiet hours, the mute, the switch and the PC hold it', async () => {
    const w = world()
    await runTick(w.env as any, at('2030-03-12T13:05:00'))
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|z|meal:2030-03-12:lunch'))
    expect(last(w.sent).text).toMatch(/ask again in 30 min/)
    await runTick(w.env as any, at('2030-03-12T13:20:00'))
    expect(texts(w.sent).filter((m) => /log (your|lunch)/i.test(m.text ?? ''))).toHaveLength(1)
    await runTick(w.env as any, at('2030-03-12T13:36:00'))
    const again = texts(w.sent).filter((m) => /Still no lunch logged/.test(m.text ?? ''))
    expect(again).toHaveLength(1)
    await handleTelegramUpdate(w.env as any, TOKEN, tap('fd|k|meal:2030-03-12:lunch:again'))
    expect(last(w.sent).text).toMatch(/Skipped/)
    // Afternoon is the third today; dinner would be the fourth → none.
    await runTick(w.env as any, at('2030-03-12T16:35:00'))
    expect(texts(w.sent).filter((m) => /Afternoon snack\? Send/.test(m.text ?? ''))).toHaveLength(1)
    await runTick(w.env as any, at('2030-03-12T19:35:00'))
    expect(texts(w.sent).filter((m) => /Dinner\? Send/.test(m.text ?? ''))).toHaveLength(0)
    expect(Object.keys(w.setting('ben_pushes').recs).filter((k) => k.startsWith('meal:'))).toHaveLength(3)

    const quiet = world({ ...base, notif_settings: { quiet: { from: '12:00', to: '14:00' } } })
    await runTick(quiet.env as any, at('2030-03-12T13:05:00'))
    expect(texts(quiet.sent).filter((m) => /Lunch\? Send/.test(m.text ?? ''))).toHaveLength(0)
    const muted = world({ ...base, food_ben: { draft: null, muteUntil: new Date('2030-03-15T00:00:00').getTime() } })
    await runTick(muted.env as any, at('2030-03-12T13:05:00'))
    expect(texts(muted.sent).filter((m) => /Lunch\? Send/.test(m.text ?? ''))).toHaveLength(0)
    const off = world({ ...base, life_fit: { push: 'firm', pushes: { ...NO_COACH, meals: false } } })
    await runTick(off.env as any, at('2030-03-12T13:05:00'))
    expect(texts(off.sent).filter((m) => /Lunch\? Send/.test(m.text ?? ''))).toHaveLength(0)
    // At the PC: Telegram stays quiet and the island decides the same reminder (one key).
    const pc = world({ ...base, ben_pc_seen: { at: new Date('2030-03-12T13:04:00').getTime(), active: true } })
    await runTick(pc.env as any, at('2030-03-12T13:05:00'))
    expect(texts(pc.sent).filter((m) => /Lunch\? Send/.test(m.text ?? ''))).toHaveLength(0)
  }, 90_000)

  it("the island's check: a meal reminder first, never in a meeting", () => {
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.exec(m)
    const wrap = {
      prepare: (sql: string) => {
        const st = db.prepare(sql)
        return {
          all: (...a: any[]) => {
            st.bind(a)
            const out: any[] = []
            while (st.step()) out.push(st.getAsObject())
            st.free()
            return out
          },
          get: (...a: any[]) => {
            st.bind(a)
            const r = st.step() ? st.getAsObject() : undefined
            st.free()
            return r
          },
          run: (...a: any[]) => {
            st.run(a)
            st.free()
          }
        }
      }
    }
    const now = at('2030-03-12T13:05:00')
    const svc = { wallet: { today: () => '2030-03-12' }, sleep: { bedtimeTarget: () => '23:30', weekdayTarget: () => '07:00', weekendTarget: () => '07:00' } }
    const p = foodPushNow(wrap as any, svc, { now, meeting: false, quiet: false })
    expect(p?.key).toBe('meal:2030-03-12:lunch')
    expect(p?.channel).toBe('island')
    expect(foodPushNow(wrap as any, svc, { now, meeting: true, quiet: false })).toBeNull()
  })
})

describe('a Telegram meal photo goes to Photo Locker, and his fixes are remembered', () => {
  const RICE = { items: [{ name: 'white rice', matchedSavedFoodId: null, qty: 1, unit: 'serving', grams: 150, gramsLow: 120, gramsHigh: 190, kcal: 195, protein: 4, carbs: 42, fat: 0.5, confidence: 'medium' }], message: 'Rice.' }
  const held = (w: ReturnType<typeof world>) => w.q("SELECT key, value FROM sys_kv WHERE key LIKE 'lkh:%'").map(([k, v]) => [k, JSON.parse(String(v))])

  it('½× / 2× / change grams, Save links the photo to the meal; the app fetches it once and erases it; the next photo uses his portion', async () => {
    const w = world(base, async () => ({ ok: true, result: RICE }))
    at('2030-03-12T13:05:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('lunch'))
    const id = w.setting('food_ben').draft.id
    // Held for the Locker: Telegram's file id only (the size up to 1280 px), never the picture.
    expect(held(w)).toEqual([[`lkh:${id}:1`, { f: 'mid-id', d: id, n: 1, at: Date.parse('2030-03-12T13:05:00'), st: 'open' }]])
    // The preview: the meal and when, the range, the totals; tap the food → ½× 1.5× 2× / Change grams / Remove.
    expect(last(w.sent).text).toMatch(/^📸 <b>Lunch<\/b> · Tue 12 Mar, 13:05/)
    expect(last(w.sent).text).toMatch(/White rice<\/b> · 150 g <i>\(120–190\)<\/i>/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|i|${id}|0`))
    const menu = w.sent.filter((s) => s.method === 'editMessageReplyMarkup').pop()!.body.reply_markup.inline_keyboard
    expect(menu.map((r: any) => r.map((b: any) => b.text))).toEqual([['½×', '1.5×', '2×'], ['✏️ Change grams', '🗑 Remove'], ['🔁 Swap for saved', '← Back']])
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|h|${id}|0|2`))
    expect(w.setting('food_ben').draft.photo.now[0]).toMatchObject({ grams: 300, kcal: 390, lo: 240, hi: 380 })
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|G|${id}|0`))
    expect(last(w.sent).text).toMatch(/How many grams of white rice\?/)
    await handleTelegramUpdate(w.env as any, TOKEN, msg('220'))
    expect(w.setting('food_ben').draft.photo.now[0]).toMatchObject({ grams: 220, kcal: 286 })
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    // The meal carries its Locker photo id; the held row now names the meal; his portion is learned.
    const meal = w.setting('food_log').meals[0]
    expect(meal).toMatchObject({ id: `fd-p${id}`, type: 'lunch', source: 'photo', photos: [`fp${id}n1`] })
    expect(meal.items[0]).toMatchObject({ name: 'white rice', grams: 220 })
    expect(held(w)[0][1]).toMatchObject({ st: 'meal', meal: `fd-p${id}`, type: 'lunch' })
    expect(w.setting('food_ben').portions).toEqual({ 'rice white': { g: 220, n: 1, at: Date.parse('2030-03-12T13:05:00') } })
    const savedMsg = w.sent.filter((s) => s.method === 'editMessageText').pop()!.body.text
    expect(savedMsg).toMatch(/^✅ <b>Lunch saved<\/b> · Tue 12 Mar, 13:05\n• White rice 220 g: 286 kcal · P \d/)

    // The app: lists it, fetches it once (through the server: no bot token leaves it), erases it once it is in Drive.
    const env = { tursoUrl: w.env.tursoUrl, tursoToken: 'k' }
    const list = await foodInbox(env, { op: 'foodInbox' }, [TOKEN])
    expect(list).toEqual({ items: [{ id: `fp${id}n1`, at: Date.parse('2030-03-12T13:05:00'), meal: `fd-p${id}`, name: 'White rice', type: 'lunch' }] })
    const got = await foodInbox(env, { op: 'foodInboxGet', id: `fp${id}n1` }, ['1:wrong', TOKEN])
    expect(got).toEqual({ mime: 'image/jpeg', data: PHOTO_B64 })
    expect(JSON.stringify(got)).not.toContain(TOKEN)
    expect(await foodInbox(env, { op: 'foodInboxGet', id: 'fpnope1n1' }, [TOKEN])).toEqual({ error: 'That photo is not held any more' })
    await foodInbox(env, { op: 'foodInboxDone', ids: [`fp${id}n1`] }, [TOKEN])
    expect(held(w)).toEqual([])
    // Still no picture in any table.
    expect(w.everything()).not.toContain(PHOTO_B64)

    // Next lunch: the AI guesses 150 g again; his usual 220 g wins, and the AI is told about it.
    at('2030-03-13T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('rice again'))
    expect(w.reads[1].portions).toEqual([{ name: 'rice white', g: 220 }])
    expect(w.setting('food_ben').draft.photo.now[0]).toMatchObject({ grams: 220, src: 'memory' })
    expect(last(w.sent).text).toMatch(/👤 your usual/)
  }, 60_000)

  it('"Not this meal" saves nothing and keeps no photo; a held photo is erased after 3 days', async () => {
    const w = world(base, async () => ({ ok: true, result: RICE }))
    at('2030-03-12T13:05:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|N|${id}`))
    expect(last(w.sent).text).toMatch(/Not a meal\. Nothing saved, and the photo is not kept/)
    expect(held(w)).toEqual([])
    expect(w.setting('food_log')).toBeNull()

    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const env = { tursoUrl: w.env.tursoUrl, tursoToken: 'k' }
    // Not saved yet: not listed while the preview is open (2 h), listed after, erased unread after 3 days.
    expect(await foodInbox(env, { op: 'foodInbox' }, [TOKEN], Date.parse('2030-03-12T13:30:00'))).toEqual({ items: [] })
    expect(((await foodInbox(env, { op: 'foodInbox' }, [TOKEN], Date.parse('2030-03-12T16:00:00'))) as any).items).toHaveLength(1)
    expect(await foodInbox(env, { op: 'foodInbox' }, [TOKEN], Date.parse('2030-03-15T13:06:00'))).toEqual({ items: [] })
    expect(held(w)).toEqual([])
  }, 60_000)
})

describe('repeat meals from a photo', () => {
  it('Keep as repeat meal makes a saved meal with the photo; /meals logs it again with no AI call, with the same picture', async () => {
    const RICE = { items: [{ name: 'white rice', matchedSavedFoodId: null, qty: 1, unit: 'serving', grams: 200, kcal: 260, protein: 5, carbs: 57, fat: 1, confidence: 'medium' }], message: '' }
    const w = world(base, async () => ({ ok: true, result: RICE }))
    at('2030-03-12T13:05:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo())
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    const saved = w.sent.filter((s) => s.method === 'editMessageText').pop()!.body
    expect(saved.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual([`fd|u|fd-p${id}`, `fd|R|fd-p${id}`])
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|R|fd-p${id}`))
    expect(last(w.sent).text).toMatch(/is a repeat meal now/)
    const meal = w.setting('food_saved').meals.find((m: any) => m.photo === `fp${id}n1`)
    expect(meal).toBeTruthy()
    // /meals lists it first with 📷; one tap logs the same numbers, with the same picture, and no AI call.
    at('2030-03-13T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/meals'))
    const menu = last(w.sent).reply_markup.inline_keyboard
    expect(menu.find((r: any) => r[0].text.startsWith('📷 '))[0].callback_data).toBe(`fd|g|${meal.id}`)
    const reads = w.reads.length
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|g|${meal.id}`, CHAT, 77))
    expect(w.reads.length).toBe(reads)
    const logged = w.setting('food_log').meals.find((m: any) => m.day === '2030-03-13')
    expect(logged).toMatchObject({ source: 'saved', photos: [`fp${id}n1`] })
    expect(logged.items[0]).toMatchObject({ grams: 200, kcal: 260 })
  }, 60_000)
})

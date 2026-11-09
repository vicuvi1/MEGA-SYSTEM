// Several meal photos for ONE meal on Telegram, end to end on a fake Turso, a
// fake Telegram (getFile + the file download, a different made-up picture per
// file id) and a fake vision read: an album of 3 updates → one vision call
// with the 3 photos → one preview; "Add another photo" → a photo → "Done, read
// them" → one call with both photos (the old one not counted twice); the parts
// are deleted after the read and on Save; no picture is in any table; a
// stranger's album is never downloaded or kept.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate } from './telegramBot'
import { ADD_WINDOW_MS, SET_TTL_MS, albumWait, collectAlbum, joinAlbum } from '../renderer/src/web/bots/foodAlbum'
import { TursoHttp } from '../renderer/src/web/tursoHttp'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
const wait0 = { ...albumWait }
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.assign(albumWait, wait0)
})

const TOKEN = '777:test-token'
const CHAT = '42'
let n = 0
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '07:00', sleep_weekend_target: '07:00', sleep_bed_target: '23:30', life_fit: { push: 'firm' }, body_plus: { gPerKg: 2 } }
/** A made-up picture per file id, and how it looks in base64 (it must never be stored). */
const bytesOf = (id: string) => new TextEncoder().encode(`made-up-jpeg-bytes-of-${id}`)
const b64Of = (id: string) => Buffer.from(bytesOf(id)).toString('base64')

const AI_OK = {
  items: [
    { name: 'eggs', matchedSavedFoodId: 'sf-egg', qty: 3, unit: 'eggs', grams: 150, kcal: 999, protein: 99, confidence: 'high', photo: 1 },
    { name: 'protein bar', matchedSavedFoodId: null, qty: 1, unit: 'bar', grams: 60, kcal: 220, protein: 20, carbs: 20, fat: 7, confidence: 'high', photo: 2 },
    { name: 'milk', matchedSavedFoodId: null, qty: 1, unit: 'glass', grams: 250, kcal: 160, protein: 8, carbs: 12, fat: 8, confidence: 'medium', photo: 3 }
  ],
  totals: { kcal: 0, protein: 0 },
  message: 'Eggs, a bar and milk.'
}

function world(vision: (body: any) => Promise<any> = async () => ({ ok: true, result: AI_OK })) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  for (const [k, v] of Object.entries(base)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  remote.run("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2030-03-01', 75, '2030-03-01T08:00:00Z')")
  const sent: { method: string; body: any }[] = []
  const files: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org/file/')) {
      files.push(u)
      const id = (u.split('/photos/')[1] ?? '').replace(/\.jpg$/, '')
      const b = bytesOf(id)
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
    }
    if (u.includes('api.telegram.org')) {
      const method = (u.split('/').pop() ?? '').split('?')[0]
      sent.push({ method, body: init.body ? JSON.parse(init.body) : null })
      const fileId = decodeURIComponent(u.split('file_id=')[1] ?? '')
      const json = method === 'getFile' ? { ok: true, result: { file_id: fileId, file_path: `photos/${fileId}.jpg`, file_size: 100 } } : { ok: true, result: { message_id: 900 + sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const reads: { body: any; opts: any }[] = []
  const foodPhoto = vi.fn(async (body: any, opts?: any) => {
    reads.push({ body, opts })
    return vision(body)
  })
  const env = { tursoUrl: `https://album${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN }, foodPhoto }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  const photoRows = () => (q("SELECT name FROM sqlite_master WHERE name = 'sys_kv'").length ? q("SELECT key FROM sys_kv WHERE key LIKE 'fd%'").map((r) => String(r[0])) : [])
  const everything = () =>
    q("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map(([t]) => JSON.stringify(remote.exec(`SELECT * FROM "${t}"`)))
      .join('\n')
  return { env, sent, files, reads, foodPhoto, setting, q, photoRows, everything }
}
const texts = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage' || s.method === 'editMessageText').map((s) => s.body)
const last = (sent: { method: string; body: any }[]) => texts(sent).pop()
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
let uid = 5000
const sizes = (id: string) => [
  { file_id: `${id}-small`, file_unique_id: `${id}s`, width: 320, height: 240, file_size: 20000 },
  { file_id: id, file_unique_id: id, width: 1280, height: 960, file_size: 150000 }
]
const photo = (id: string, o: { caption?: string; group?: string; chat?: string } = {}) => ({
  update_id: ++uid,
  message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(o.chat ?? CHAT), type: 'private' }, from: { id: Number(o.chat ?? CHAT) }, photo: sizes(id), ...(o.caption ? { caption: o.caption } : {}), ...(o.group ? { media_group_id: o.group } : {}) }
})
const msg = (text: string) => ({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT) }, text } })
const tap = (data: string, messageId = 1, chat = CHAT) => ({ update_id: ++uid, callback_query: { id: `cb${uid}`, data, from: { id: Number(chat) }, message: { message_id: messageId, chat: { id: Number(chat) }, text: '' } } })
const foodRows = (w: ReturnType<typeof world>) => w.q("SELECT amount, source FROM body_log WHERE kind = 'kcal:food' AND undoes IS NULL")

describe('an album of meal photos on Telegram', () => {
  it('3 updates with one media_group_id → ONE vision call with the 3 photos → ONE preview; the parts are deleted', async () => {
    Object.assign(albumWait, { pollMs: 15 })
    const w = world()
    at('2030-03-12T08:10:00')
    await handleTelegramUpdate(w.env as any, TOKEN, msg('/meals')) // the bots are warm before the album lands
    const before = w.sent.length
    // The 3 parts arrive at the same time, as Telegram sends them (separate updates, maybe separate function calls).
    const album = [photo('plate', { group: 'g77', caption: 'breakfast, the bar was a Barebells' }), photo('bar', { group: 'g77' }), photo('milk', { group: 'g77' })]
    const replies = await Promise.all(album.map((u) => handleTelegramUpdate(w.env as any, TOKEN, u)))
    expect(w.foodPhoto).toHaveBeenCalledTimes(1)
    expect(w.reads[0].body.images.map((x: any) => x.data)).toEqual([b64Of('plate'), b64Of('bar'), b64Of('milk')])
    expect(w.reads[0].body.note).toBe('breakfast, the bar was a Barebells')
    expect(w.reads[0].opts).toBeUndefined() // every photo counts toward the 50 a day
    // One "Reading the photos…" that becomes the one preview; the other parts said nothing.
    const out = texts(w.sent.slice(before))
    expect(out.filter((m) => /Reading the photo/.test(m.text))).toHaveLength(1)
    expect(out.filter((m) => /Total: ~/.test(m.text))).toHaveLength(1)
    expect(replies.filter((r) => r && /Total: ~/.test(r))).toHaveLength(1)
    const prev = last(w.sent)
    expect(prev.text).toMatch(/3 photos read together\. Eggs, a bar and milk\./)
    expect(prev.text).toMatch(/Total: ~596 kcal · 47 g protein/)
    const id = w.setting('food_ben').draft.id
    const kb = prev.reply_markup.inline_keyboard
    expect(kb[kb.length - 1].map((b: any) => b.callback_data)).toEqual([`fd|s|${id}`, `fd|x|${id}`])
    expect(kb[kb.length - 2][0]).toEqual({ text: '➕ Add another photo', callback_data: `fd|a|${id}` })
    // The parts are gone; only the preview's file ids are kept (for "Add another photo"), never a picture.
    expect(w.photoRows().filter((k) => k.startsWith('fdp:'))).toEqual([])
    expect(w.photoRows().filter((k) => k.startsWith('fdd:'))).toEqual([`fdd:${CHAT}:${id}`])
    for (const x of ['plate', 'bar', 'milk']) expect(w.everything()).not.toContain(b64Of(x))
    // Save logs ONE meal and drops the kept file ids.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${id}`))
    expect(foodRows(w)).toEqual([[596, 'telegram']])
    expect(w.photoRows().filter((k) => !k.startsWith('fdl:'))).toEqual([])
  }, 60_000)

  it("a stranger's album is never downloaded, read or kept", async () => {
    Object.assign(albumWait, { pollMs: 15 })
    const w = world()
    at('2030-03-12T08:10:00')
    await Promise.all([photo('a', { group: 'g9', chat: '999999' }), photo('b', { group: 'g9', chat: '999999' })].map((u) => handleTelegramUpdate(w.env as any, TOKEN, u)))
    expect(w.foodPhoto).not.toHaveBeenCalled()
    expect(w.files).toHaveLength(0)
    expect(w.sent).toHaveLength(0)
    expect(w.photoRows()).toEqual([])
  }, 60_000)
})

describe('"Add another photo" on a photo preview', () => {
  it('photo → preview → Add another photo → a photo → Done, read them → ONE call with both photos (the first not counted again)', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('plate', { caption: 'lunch' }))
    expect(w.foodPhoto).toHaveBeenCalledTimes(1)
    const first = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|a|${first}`, 901))
    const ask = last(w.sent)
    expect(ask.text).toMatch(/Send the next photo of this meal now/)
    expect(ask.reply_markup.inline_keyboard.map((r: any) => r[0].callback_data)).toEqual([`fd|r|${first}`, `fd|q|${first}`])
    // Done before a new photo: nothing is read.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|r|${first}`, 950))
    expect(w.foodPhoto).toHaveBeenCalledTimes(1)
    // A photo within the minute joins the meal: no vision call yet, the message counts it.
    at('2030-03-12T13:00:40')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('drink', { caption: 'and a cola zero' }))
    expect(w.foodPhoto).toHaveBeenCalledTimes(1)
    expect(last(w.sent).text).toMatch(/Got one more photo \(2 for this meal\)/)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|r|${first}`, 950))
    expect(w.foodPhoto).toHaveBeenCalledTimes(2)
    expect(w.reads[1].body.images.map((x: any) => x.data)).toEqual([b64Of('plate'), b64Of('drink')])
    expect(w.reads[1].body.note).toBe('lunch · and a cola zero')
    expect(w.reads[1].opts).toEqual({ counted: 1 })
    const prev = last(w.sent)
    expect(prev.message_id).toBe(950) // the "send the next photo" message becomes the new preview
    expect(prev.text).toMatch(/2 photos read together/)
    const second = w.setting('food_ben').draft.id
    expect(second).not.toBe(first)
    // The old preview's buttons are closed; the add rows are gone.
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|s|${first}`))
    expect(foodRows(w)).toEqual([])
    expect(w.photoRows().filter((k) => k.startsWith('fdp:') || k.startsWith('fda:'))).toEqual([])
    for (const x of ['plate', 'drink']) expect(w.everything()).not.toContain(b64Of(x))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|x|${second}`))
    expect(w.photoRows()).toEqual([])
  }, 60_000)

  it('a photo after the minute is a new meal of its own; Stop adding keeps the preview', async () => {
    const w = world()
    at('2030-03-12T13:00:00')
    await handleTelegramUpdate(w.env as any, TOKEN, photo('plate'))
    const id = w.setting('food_ben').draft.id
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|a|${id}`))
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|q|${id}`, 960))
    expect(last(w.sent).text).toMatch(/Stopped adding photos/)
    expect(w.setting('food_ben').draft.id).toBe(id)
    await handleTelegramUpdate(w.env as any, TOKEN, tap(`fd|a|${id}`))
    at(new Date(new Date('2030-03-12T13:00:00').getTime() + ADD_WINDOW_MS + 5000).toISOString())
    await handleTelegramUpdate(w.env as any, TOKEN, photo('dessert'))
    expect(w.foodPhoto).toHaveBeenCalledTimes(2)
    expect(w.reads[1].body.images.map((x: any) => x.data)).toEqual([b64Of('dessert')])
  }, 60_000)
})

describe('the album rows (foodAlbum.ts on sql.js)', () => {
  const kvOn = (db: SqlJsDatabase) => new TursoHttp('https://kv.fake.turso.io', 'k', undefined, (async (_u: string, init: any) => new Response(JSON.stringify(handlePipeline(db, JSON.parse(init.body))), { status: 200 })) as any)
  it('one lead, the rest wait; a part after the lead took them is read on its own; rows older than 10 minutes go', async () => {
    Object.assign(albumWait, { pollMs: 1 })
    const db = new SQL.Database()
    const t = kvOn(db)
    const kv = (s: any) => t.writeAtomic(s)
    const now = Date.parse('2030-03-12T08:00:00Z')
    const part = (m: number) => ({ f: `file-${m}`, c: m === 1 ? 'note' : '', m, at: now })
    expect(await joinAlbum(kv, CHAT, 'g1', part(1), now)).toBe('lead')
    expect(await joinAlbum(kv, CHAT, 'g1', part(3), now)).toBe('wait')
    expect(await joinAlbum(kv, CHAT, 'g1', part(2), now)).toBe('wait')
    const got = await collectAlbum(kv, CHAT, 'g1', () => now, async () => {})
    expect(got.map((p) => p.f)).toEqual(['file-1', 'file-2', 'file-3']) // in the order they were sent
    expect(await joinAlbum(kv, CHAT, 'g1', part(4), now)).toBe('late')
    expect(db.exec("SELECT COUNT(*) FROM sys_kv WHERE key LIKE 'fdp:%'")[0].values[0][0]).toBe(0)
    // Ten minutes later the next photo sweeps the old lead row away.
    await joinAlbum(kv, CHAT, 'g2', part(9), now + SET_TTL_MS + 1000)
    expect(db.exec("SELECT key FROM sys_kv WHERE key LIKE 'fdl:%'")[0].values.map((r) => r[0])).toEqual([`fdl:${CHAT}:gg2`])
  })
})

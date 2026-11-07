// TV1: today's plan buttons on Telegram, on a fake Turso with a made-up plan.
// A move goes through Ben's own move action (with Undo), Done/Skip are the
// Today timeline's marks, each tap counts once, and strangers are ignored.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { PLANNER_VERSION, RHYTHM } from '@core/rhythm'
import { handlePipeline } from '../fakeTurso'
import { Mirror } from '../mirror'
import { TursoHttp } from '../tursoHttp'
import { createWebServices } from '../webServices'
import { createWebBots } from '../webBots'
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
  const day = await w.read((s) => s.wallet.today())
  await mirror.write((db: any) =>
    setSetting(db, RHYTHM, JSON.stringify({ day, water: [], briefing: { status: 'proposed', sentAt: new Date().toISOString(), version: 1, planner: PLANNER_VERSION, plan: { day, headline: 'Essay first', mustdos: ['Essay intro'], blocks: [{ title: 'Essay intro', start: '10:00', minutes: 60 }, { title: 'Lab report', start: '15:00', minutes: 50 }], training: null, waterMl: 2500 } } }))
  )
  const setting = (key: string) => {
    const v = remote.exec(`SELECT value FROM settings WHERE key = '${key}'`)[0]?.values?.[0]?.[0]
    return v == null ? null : JSON.parse(String(v))
  }
  let n = 0
  const tap = (data: string, chat = CHAT, id?: number) => bots.handleUpdate(TOKEN, { update_id: id ?? ++n, callback_query: { id: `cb${n}`, data, message: { chat: { id: chat }, message_id: 7, text: 'Your day' } } })
  return { bots, sent, setting, tap, day, mirror }
}

describe('TV1 plan buttons on Telegram', () => {
  it('+30 moves a waiting plan block through Ben, with a receipt and Undo', async () => {
    const w = await world()
    await w.tap('pb|m|0|30')
    expect(w.setting(RHYTHM).briefing.plan.blocks[0]).toMatchObject({ title: 'Essay intro', start: '10:30' })
    const receipt = w.sent.find((s) => s.method === 'sendMessage' && /Moved Essay intro/.test(s.body.text))
    expect(receipt?.body.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: '↩ Undo' })
    const edit = w.sent.find((s) => s.method === 'editMessageText')
    expect(edit?.body.text).toMatch(/10:30–11:30 Essay intro/)
    expect(edit?.body.text).toMatch(/↪️ Moved Essay intro \(10:00\) by \+30 min/)
    expect(edit?.body.reply_markup.inline_keyboard[0][0].text).toBe('10:30 −30')
    // The same tap delivered twice (Telegram retries) counts once.
    await w.tap('pb|m|0|30', CHAT, 1)
    expect(w.setting(RHYTHM).briefing.plan.blocks[0].start).toBe('10:30')
    // Undo through the same path as Ben's replies.
    const at = receipt!.body.reply_markup.inline_keyboard[0][0].callback_data
    await w.tap(at)
    expect(w.setting(RHYTHM).briefing.plan.blocks[0].start).toBe('10:00')
  })

  it('Done and Skip are the timeline marks; a second tap undoes', async () => {
    const w = await world()
    await w.tap('pb|d|1')
    expect(w.setting('block_marks')[w.day]['plan:15:00 Lab report']).toBe('done')
    const edit = w.sent.filter((s) => s.method === 'editMessageText').pop()
    expect(edit?.body.reply_markup.inline_keyboard[1].map((b: any) => b.text)).toEqual(['✅ 15:00 Lab report', '↩ Undo'])
    await w.tap('pb|u|1')
    expect(w.setting('block_marks')[w.day]['plan:15:00 Lab report']).toBeUndefined()
    await w.tap('pb|s|0')
    expect(w.setting('block_marks')[w.day]['plan:10:00 Essay intro']).toBe('skip')
  })

  it('a stranger tapping does nothing', async () => {
    const w = await world()
    await w.tap('pb|d|0', 999)
    expect(w.setting('block_marks')).toBeNull()
  })
})

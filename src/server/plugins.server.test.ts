// Plugins on the server, end to end on a fake Turso, a fake Telegram and a
// fake Open-Meteo (made-up data): phone numbers, a plugin command, a bank CSV
// sent on Telegram, and the weather job in the tick.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, healthPush, runTick } from './telegramBot'

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
const CSV = 'Date;Description;Amount\n01.11.2026;Test Market;-245,50\n02.11.2026;Cafe Example;-60,00\n'

function forecast() {
  const time = Array.from({ length: 48 }, (_, h) => `2026-11-0${5 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`)
  return {
    hourly: { time, precipitation_probability: time.map((t) => (t === '2026-11-05T17:00' ? 90 : 0)), precipitation: time.map((t) => (t === '2026-11-05T17:00' ? 2 : 0)) },
    daily: { time: ['2026-11-05', '2026-11-06'], sunrise: ['2026-11-05T06:58', '2026-11-06T07:00'], sunset: ['2026-11-05T16:40', '2026-11-06T16:39'], temperature_2m_min: [4, 3], temperature_2m_max: [11, 10] }
  }
}

function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const sent: { method: string; body: any }[] = []
  const hosts: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json), arrayBuffer: async () => new TextEncoder().encode(String(json)).buffer })
    if (u.includes('api.telegram.org/file/')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop()?.split('?')[0] ?? ''
      sent.push({ method, body: init.body ? JSON.parse(init.body) : null })
      return ok({ ok: true, result: method === 'getFile' ? { file_path: 'docs/statement.csv', file_size: CSV.length } : { message_id: sent.length, chat: { id: Number(CHAT) } } })
    }
    if (u.includes('geocoding-api.open-meteo.com')) return (hosts.push('geo'), ok({ results: [{ name: 'Testville', latitude: 47, longitude: 28.8 }] }))
    if (u.includes('api.open-meteo.com')) return (hosts.push('forecast'), ok(forecast()))
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return ok(json)
  })
  const env = { tursoUrl: `https://p${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  const set = (key: string, value: unknown) => remote.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
  const get = (key: string) => JSON.parse(String(q(`SELECT value FROM settings WHERE key = '${key}'`)[0]?.[0] ?? 'null'))
  return { remote, sent, hosts, env, q, set, get }
}

describe('plugins on the server', () => {
  it('phone numbers: weight to Body, steps and sleep to the daily record, no points', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'))
    const { env, q, get } = world()
    expect(await healthPush(env, { weight: 72.5, steps: 8123, sleepHours: 7.5 })).toMatchObject({ ok: true, day: '2026-11-05', saved: ['weight 72.5 kg', '8123 steps', '7.5 h sleep'] })
    expect(q("SELECT weight FROM body_metrics WHERE day = '2026-11-05'")[0][0]).toBe(72.5)
    expect(get('plugin_health_data').days['2026-11-05']).toMatchObject({ steps: 8123, sleepHours: 7.5 })
    expect(q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(0)
    expect(await healthPush(env, { weight: 'heavy' })).toMatchObject({ ok: false })
  }, 30_000)

  it('a plugin command answers only while the plugin is on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'))
    const { env, sent, set } = world()
    set('plugins_on', { health: true })
    set('plugin_health_data', { days: { '2026-11-05': { steps: 4321, at: 'x' } } })
    const reply = await handleTelegramUpdate(env, TOKEN, { update_id: 5001, message: { message_id: 1, date: 0, chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT) }, text: '/steps' } })
    expect(reply).toContain('4321 steps')
    expect(sent.some((s) => s.method === 'sendMessage' && String(s.body.text).includes('4321'))).toBe(true)
  }, 30_000)

  it('a bank CSV sent on Telegram goes to the Finance Helper inbox, never stored as a file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'))
    const { env, set, get, q } = world()
    set('plugins_on', { bank: true })
    const reply = await handleTelegramUpdate(env, TOKEN, { update_id: 5002, message: { message_id: 2, date: 0, chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT) }, document: { file_id: 'f1', file_name: 'statement.csv', mime_type: 'text/csv', file_size: CSV.length } } })
    expect(reply).toContain('2 new payments')
    expect(get('finance_inbox_json').map((e: any) => e.amount)).toEqual([24550, 6000])
    expect(JSON.stringify(q('SELECT key, value FROM settings'))).not.toContain('Date;Description;Amount')
  }, 30_000)

  it('the tick fetches the weather once and Ben sees it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T07:30:00Z'))
    const { env, hosts, set, get } = world()
    set('plugins_on', { weather: true })
    set('plugin_weather', { city: 'Testville' })
    await runTick({ ...env, botToken: TOKEN, chatId: CHAT })
    expect(hosts).toEqual(['geo', 'forecast'])
    const w = get('plugin_weather_data')
    expect(w.place).toBe('Testville')
    expect(w.days[0]).toMatchObject({ day: '2026-11-05', sunset: '16:40', rain: [{ from: '17:00', to: '18:00', prob: 90 }] })
    expect(get('plugins_status').weather).toMatchObject({ ok: true })
  }, 30_000)
})

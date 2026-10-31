// The web server (api/*.mjs): PIN login, wrong-PIN waits, sessions.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
// @ts-expect-error plain JS module without types
import { config, login, makeSession, sessionOk, pinMatches, botDefaults } from '../../../../api/_lib.mjs'
import { handlePipeline } from './fakeTurso'
import { hashPin } from './webAuth'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'secret-token' })

function fake(pinHash: string | null): { db: SqlJsDatabase; fetchImpl: typeof fetch } {
  const db = new SQL.Database()
  db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  if (pinHash) db.run("INSERT INTO settings VALUES ('pin_hash', ?)", [pinHash])
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    expect(url).toBe('https://fake.turso.io/v2/pipeline')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    const json = handlePipeline(db, JSON.parse(init.body))
    return { status: 200, text: async () => JSON.stringify(json) }
  }) as unknown as typeof fetch
  return { db, fetchImpl }
}

describe('web server', () => {
  it('logs in with the PIN the app saved, and refuses a wrong one', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    const ok = await login(cfg, '4821', Date.now(), fetchImpl)
    expect(ok.status).toBe(200)
    expect(sessionOk(cfg, ok.body.session)).toBe(true)
    expect((await login(cfg, '2007', Date.now(), fetchImpl)).status).toBe(401)
  })

  it('makes you wait after 5 wrong PINs, longer each time, even with the right one', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    const t = 1_800_000_000_000
    for (let i = 0; i < 4; i++) expect((await login(cfg, '0000', t, fetchImpl)).status).toBe(401)
    const fifth = await login(cfg, '0000', t, fetchImpl)
    expect(fifth.body.error).toMatch(/Wait 60 s/)
    expect((await login(cfg, '4821', t + 1000, fetchImpl)).status).toBe(429)
    expect((await login(cfg, '0000', t + 61_000, fetchImpl)).body.error).toMatch(/Wait 120 s/)
    expect((await login(cfg, '4821', t + 61_000 + 121_000, fetchImpl)).status).toBe(200)
  })

  it('accepts 2007 only while no PIN is set, and an old plain PIN', async () => {
    expect((await login(cfg, '2007', Date.now(), fake(null).fetchImpl)).status).toBe(200)
    expect(await pinMatches('1234', '1234')).toBe(true)
    expect(await pinMatches('1234', '2007')).toBe(false)
  })

  it('sessions expire and cannot be forged', () => {
    const s = makeSession(cfg, Date.now())
    expect(sessionOk(cfg, s)).toBe(true)
    expect(sessionOk(cfg, s, Date.now() + 31 * 86400_000)).toBe(false)
    expect(sessionOk(config({ TURSO_URL: 'x', TURSO_TOKEN: 'other' }), s)).toBe(false)
    const [data] = s.split('.')
    expect(sessionOk(cfg, `${data}.forged`)).toBe(false)
    expect(sessionOk(cfg, '')).toBe(false)
  })

  it('gives the bot tokens from its own settings', () => {
    const bots = botDefaults({ TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_CHAT_ID: '42', FINANCE_BOT_TOKEN: '2:b' })
    expect(bots).toMatchObject({ botToken: '1:a', sportBotToken: '1:a', financeBotToken: '2:b', chatId: '42' })
  })
})

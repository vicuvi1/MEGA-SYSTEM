// The web server (api/*.mjs): PIN login, wrong-PIN waits, sessions.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
// @ts-expect-error plain JS module without types
import { config, login, makeSession, sessionOk, sessionSigned, signOutAll, forgetEpoch, pinMatches, botDefaults, serverBots, changePin, requireSession, sidOf } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { pipelineProblem, codeWords } from '../../../../api/_sqlguard.mjs'
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
    expect(await sessionOk(cfg, ok.body.session, Date.now(), fetchImpl)).toBe(true)
    expect((await login(cfg, '2007', Date.now(), fetchImpl)).status).toBe(401)
  })

  it('makes you wait after 5 wrong PINs, longer each time, even with the right one', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    const t = 1_800_000_000_000
    for (let i = 0; i < 4; i++) expect((await login(cfg, '0000', t, fetchImpl)).status).toBe(401)
    const fifth = await login(cfg, '0000', t, fetchImpl)
    expect(fifth.status).toBe(429)
    expect(fifth.body.error).toMatch(/Wait 60 s/)
    expect((await login(cfg, '4821', t + 1000, fetchImpl)).status).toBe(429)
    expect((await login(cfg, '0000', t + 61_000, fetchImpl)).body.error).toMatch(/Wait 120 s/)
    expect((await login(cfg, '4821', t + 61_000 + 121_000, fetchImpl)).status).toBe(200)
  })

  it('a burst of parallel guesses is cut off at the limit', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    const t = 1_900_000_000_000
    const all = await Promise.all(Array.from({ length: 12 }, (_, k) => login(cfg, String(1000 + k), t, fetchImpl, '9.9.9.9')))
    expect(all.filter((r: any) => r.status === 401).length).toBeLessThanOrEqual(4)
    // Another device is not locked out by this one (only by the shared limit of 20).
    expect((await login(cfg, '4821', t, fetchImpl, '1.1.1.1')).status).toBe(200)
  })

  it('accepts 2007 only while no PIN is set, and an old plain PIN', async () => {
    expect((await login(cfg, '2007', Date.now(), fake(null).fetchImpl)).status).toBe(200)
    expect(await pinMatches('1234', '1234')).toBe(true)
    expect(await pinMatches('1234', '2007')).toBe(false)
  })

  it('sessions expire and cannot be forged', () => {
    const s = makeSession(cfg, Date.now())
    expect(sessionSigned(cfg, s)).toBeTruthy()
    expect(sessionSigned(cfg, s, Date.now() + 31 * 86400_000)).toBeNull()
    expect(sessionSigned(config({ TURSO_URL: 'x', TURSO_TOKEN: 'other' }), s)).toBeNull()
    const [data] = s.split('.')
    expect(sessionSigned(cfg, `${data}.forged`)).toBeNull()
    expect(sessionSigned(cfg, '')).toBeNull()
  })

  it('a PIN change or "sign out all devices" ends every older session', async () => {
    const { db, fetchImpl } = fake(await hashPin('4821'))
    forgetEpoch()
    const a = (await login(cfg, '4821', Date.now(), fetchImpl)).body.session
    expect(await sessionOk(cfg, a, Date.now(), fetchImpl)).toBe(true)
    const b = await signOutAll(cfg, Date.now(), fetchImpl)
    expect(await sessionOk(cfg, a, Date.now(), fetchImpl)).toBe(false)
    expect(await sessionOk(cfg, b, Date.now(), fetchImpl)).toBe(true)
    const c = await changePin(cfg, '4821', '999999', sessionSigned(cfg, b).sid, Date.now(), fetchImpl)
    expect(c.status).toBe(200)
    expect(await sessionOk(cfg, b, Date.now(), fetchImpl)).toBe(false)
    expect(await sessionOk(cfg, c.body.session, Date.now(), fetchImpl)).toBe(true)
    expect(sessionSigned(cfg, c.body.session).sid).toBe(sessionSigned(cfg, b).sid)
    // An old session made before epochs existed is refused too.
    expect(await sessionOk(cfg, makeSession(cfg, Date.now()), Date.now(), fetchImpl)).toBe(false)
  })

  it('leaves bots run by their own program alone', () => {
    const env = { MEGA_BOT_TOKEN: '3:c', TELEGRAM_BOT_TOKEN: '1:a', FINANCE_BOT_TOKEN: '2:b', BOTS_NOT_ON_SERVER: 'TELEGRAM_BOT_TOKEN' }
    expect(serverBots(env).map((b: any) => b.id)).toEqual(['3', '2'])
    expect(botDefaults(env).skipBotIds).toEqual(['1'])
  })

  it('knows the Waky bot (sleep messages come from it, not a fallback)', () => {
    const env = { MEGA_BOT_TOKEN: '3:c', WAKY_BOT_TOKEN: '7:w' }
    expect(serverBots(env).find((b: any) => b.name === 'WAKY_BOT_TOKEN')?.id).toBe('7')
    expect(botDefaults(env).wakyBotToken).toBe('7:w')
  })

  it('gives the bot tokens from its own settings', () => {
    const bots = botDefaults({ TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_CHAT_ID: '42', FINANCE_BOT_TOKEN: '2:b', MEGA_BOT_TOKEN: '3:c' })
    expect(bots).toMatchObject({ botToken: '1:a', sportBotToken: '1:a', financeBotToken: '2:b', chatId: '42', megaBotToken: '3:c' })
  })

  it('the PIN lives in a server-only table: writing settings.pin_hash changes nothing (A2)', async () => {
    const { db, fetchImpl } = fake(await hashPin('4821'))
    forgetEpoch()
    const a = (await login(cfg, '4821', Date.now(), fetchImpl)).body.session
    db.run("UPDATE settings SET value = ? WHERE key = 'pin_hash'", [await hashPin('1111')])
    db.run("INSERT OR REPLACE INTO settings VALUES ('session_epoch', '99')")
    forgetEpoch()
    expect(await sessionOk(cfg, a, Date.now(), fetchImpl)).toBe(true)
    expect((await login(cfg, '1111', Date.now(), fetchImpl, '5.5.5.5')).status).toBe(401)
    expect((await login(cfg, '4821', Date.now(), fetchImpl, '5.5.5.6')).status).toBe(200)
  })

  it('a PIN change needs the current PIN, checked on the server (A2)', async () => {
    const { db, fetchImpl } = fake(await hashPin('4821'))
    forgetEpoch()
    expect((await changePin(cfg, '0000', '123456', null, Date.now(), fetchImpl, '7.7.7.7')).status).toBe(403)
    expect((await changePin(cfg, '4821', '12', null, Date.now(), fetchImpl)).status).toBe(400)
    expect((await changePin(cfg, '4821', '123456', null, Date.now(), fetchImpl, '7.7.7.8')).status).toBe(200)
    expect((await login(cfg, '123456', Date.now(), fetchImpl, '7.7.7.9')).status).toBe(200)
    // The devices' offline copy follows.
    expect(await pinMatches(String(db.exec("SELECT value FROM settings WHERE key = 'pin_hash'")[0].values[0][0]), '123456')).toBe(true)
  })

  it('a database hiccup is "try again", never "signed out" (A4)', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    forgetEpoch()
    const a = (await login(cfg, '4821', Date.now(), fetchImpl)).body.session
    forgetEpoch()
    const down = (async () => ({ status: 503, text: async () => 'down' })) as unknown as typeof fetch
    await expect(sessionOk(cfg, a, Date.now(), down)).rejects.toThrow()
    // Forged or expired sessions are still a plain "no", without the database.
    expect(await sessionOk(cfg, 'x.y', Date.now(), down)).toBe(false)
    const sent: any = {}
    const res = { setHeader() {}, end(b: string) { sent.body = JSON.parse(b) }, set statusCode(v: number) { sent.status = v } }
    const real = globalThis.fetch
    globalThis.fetch = down
    try {
      expect(await requireSession(res, cfg, a)).toBe(false)
    } finally {
      globalThis.fetch = real
    }
    expect(sent.status).toBe(503)
  })

  it('a device keeps its id when it logs in with the PIN again', async () => {
    const { fetchImpl } = fake(await hashPin('4821'))
    forgetEpoch()
    const a = (await login(cfg, '4821', Date.now(), fetchImpl)).body.session
    const b = (await login(cfg, '4821', Date.now(), fetchImpl, 'x', sidOf(cfg, a))).body.session
    expect(sessionSigned(cfg, b).sid).toBe(sessionSigned(cfg, a).sid)
    expect(sidOf(cfg, a.split('.')[0] + '.forged')).toBeNull()
  })
})

describe('/api/db guard (A1)', () => {
  const ex = (sql: string) => ({ requests: [{ type: 'execute', stmt: { sql, args: [] } }, { type: 'close' }] })
  it('lets the app read and write its own data', () => {
    expect(pipelineProblem(ex('SELECT * FROM tasks'))).toBeNull()
    expect(pipelineProblem(ex("INSERT INTO settings (key, value) VALUES ('theme', 'pragma attach')"))).toBeNull()
    expect(pipelineProblem(ex('INSERT INTO sys_error_log (at, msg) VALUES (?, ?)'))).toBeNull()
    expect(pipelineProblem({ requests: [{ type: 'batch', batch: { steps: [{ stmt: { sql: 'BEGIN' } }, { condition: { type: 'ok', step: 0 }, stmt: { sql: 'UPDATE tasks SET done = 1' } }] } }] })).toBeNull()
  })
  it("refuses the server's tables, ATTACH/PRAGMA and odd requests", () => {
    for (const sql of ['SELECT * FROM sys_auth', 'DELETE FROM "sys_login_guard"', 'UPDATE [sys_devices] SET revoked = 0', 'INSERT INTO sys_passkeys VALUES (1)', 'DROP TABLE Sys_Gate'])
      expect(pipelineProblem(ex(sql))).toMatch(/belongs to the server/)
    expect(pipelineProblem(ex("ATTACH DATABASE 'x' AS y"))).toMatch(/ATTACH/)
    expect(pipelineProblem(ex('pragma writable_schema = 1'))).toMatch(/PRAGMA/)
    expect(pipelineProblem(ex(`SELECT "a'" ; VACUUM`))).toMatch(/VACUUM/)
    expect(pipelineProblem(ex("SELECT 'open"))).toMatch(/Unclosed/)
    expect(pipelineProblem({ requests: [{ type: 'sequence', sql: 'DELETE FROM tasks' }] })).toMatch(/not allowed/)
    expect(pipelineProblem({ requests: [{ type: 'execute', stmt: { sql_id: 1 } }] })).toMatch(/plain SQL/)
    expect(pipelineProblem({})).toMatch(/Expected/)
    expect(codeWords("a /* pragma */ b -- attach\n c 'vacuum'")).toEqual(['a', 'b', 'c'])
  })
})

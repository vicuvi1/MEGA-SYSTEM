// The Nov 2026 security hunt, as tests: the PIN hash never sits in settings,
// /api/db refuses what reaches past the data, web push keeps to the daily
// budget, a database hiccup is a 503, the tick needs a session or the secret,
// the URL guard sees IPv4 hidden in IPv6, and the Google state check.
import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
// @ts-expect-error plain JS module without types
import { config, login, changePin, forgetEpoch, makeSession, sessionSigned } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { pipelineProblem } from '../../../../api/_sqlguard.mjs'
// @ts-expect-error plain JS module without types
import { pushNew, peek } from '../../../../api/_push.mjs'
// @ts-expect-error plain JS module without types
import { botHealth } from '../../../../api/bot-setup.mjs'
// @ts-expect-error plain JS module without types
import cronHandler from '../../../../api/cron.mjs'
// @ts-expect-error plain JS module without types
import { makeState, stateOk } from '../../../../api/google.mjs'
import { privateIp, urlProblem } from '@core/netGuard'
import { handlePipeline } from './fakeTurso'
import { createWebAuth, hashPin, OFFLINE_NO_COPY, type PinStore } from './webAuth'
import type { Mirror } from './mirror'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'secret-token' })

function fake(setup: (db: SqlJsDatabase) => void = () => {}): { db: SqlJsDatabase; fetchImpl: typeof fetch; pushes: () => number } {
  const db = new SQL.Database()
  db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  setup(db)
  let pushes = 0
  const fetchImpl = (async (url: string, init: { body: string }) => {
    if (String(url).endsWith('/v2/pipeline')) return { status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) }
    pushes++
    return { status: 201 }
  }) as unknown as typeof fetch
  return { db, fetchImpl, pushes: () => pushes }
}
const one = (db: SqlJsDatabase, sql: string) => db.exec(sql)[0]?.values[0]?.[0] ?? null
const ex = (sql: string, args: unknown[] = []) => ({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] })

describe('F1: the PIN hash is never in settings', () => {
  it('the first sign-in moves an old copy into sys_auth, deletes it from settings and makes devices reload once', async () => {
    const { db, fetchImpl } = fake((d) => {
      d.run("INSERT INTO settings VALUES ('pin_hash', ?)", ['x'])
      d.run("INSERT INTO settings VALUES ('data_version', 'v1')")
    })
    db.run("UPDATE settings SET value = ? WHERE key = 'pin_hash'", [await hashPin('4821')])
    forgetEpoch()
    expect((await login(cfg, '4821', Date.now(), fetchImpl, '1.0.0.1')).status).toBe(200)
    expect(one(db, "SELECT COUNT(*) FROM settings WHERE key = 'pin_hash'")).toBe(0)
    expect(String(one(db, "SELECT value FROM settings WHERE key = 'data_version'"))).toMatch(/^pin-clean-/)
    // Idempotent: nothing left to clean, the marker stays.
    const v = one(db, "SELECT value FROM settings WHERE key = 'data_version'")
    forgetEpoch()
    expect((await login(cfg, '4821', Date.now(), fetchImpl, '1.0.0.2')).status).toBe(200)
    expect(one(db, "SELECT value FROM settings WHERE key = 'data_version'")).toBe(v)
  })

  it('a PIN change writes the hash to sys_auth only', async () => {
    const { db, fetchImpl } = fake((d) => d.run("INSERT INTO settings VALUES ('pin_hash', '4821')"))
    forgetEpoch()
    expect((await changePin(cfg, '4821', '730519', null, Date.now(), fetchImpl, '2.0.0.1')).status).toBe(200)
    expect(one(db, "SELECT COUNT(*) FROM settings WHERE key = 'pin_hash' OR value LIKE '%:%'")).toBe(0)
    expect(String(one(db, "SELECT value FROM sys_auth WHERE key = 'pin_hash'"))).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    expect((await login(cfg, '730519', Date.now(), fetchImpl, '2.0.0.2')).status).toBe(200)
  })

  it('/api/db refuses reading or writing the pin_hash setting, in the SQL or in its arguments', () => {
    for (const [sql, args] of [
      ["SELECT value FROM settings WHERE key='pin_hash'", []],
      ['SELECT value FROM settings WHERE key = ?', [{ type: 'text', value: 'pin_hash' }]],
      ['INSERT INTO settings (key, value) VALUES (?, ?)', [{ type: 'text', value: 'PIN_HASH' }, { type: 'text', value: 'x' }]],
      ["UPDATE settings SET value = 'x' WHERE key = \"pin_hash\""]
    ] as [string, unknown[]][])
      expect(pipelineProblem(ex(sql, args ?? [])), sql).toMatch(/belongs to the server/)
    expect(pipelineProblem({ requests: [{ type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = :k', named_args: [{ name: 'k', value: { type: 'text', value: 'pin_hash' } }] } }] })).toMatch(/belongs to the server/)
    // Other settings still pass.
    expect(pipelineProblem(ex('SELECT value FROM settings WHERE key = ?', [{ type: 'text', value: 'theme' }]))).toBeNull()
  })
})

describe('offline unlock: each device has its own copy, never synced', () => {
  const memory = (): PinStore & { value: string | null } => {
    const s = { value: null as string | null, read: async () => s.value, write: async (v: string) => void (s.value = v) }
    return s
  }
  const noMirror = new Proxy({}, { get: () => () => { throw new Error('the mirror must not be used for the PIN') } }) as unknown as Mirror

  it('offline with no copy: refused (never the 2007 default)', async () => {
    const auth = createWebAuth(noMirror, memory())
    await expect(auth.unlock('2007')).rejects.toThrow(OFFLINE_NO_COPY)
  })
  it('a server-checked unlock saves the copy; offline then checks against it', async () => {
    const store = memory()
    const auth = createWebAuth(noMirror, store)
    await auth.unlock('4821', true)
    expect(store.value).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    await auth.lock()
    expect((await auth.unlock('4821')).locked).toBe(false)
    await auth.lock()
    await expect(auth.unlock('0000')).rejects.toThrow(/Wrong PIN/)
    // A new PIN accepted by the server replaces the copy.
    await auth.unlock('730519', true)
    await auth.lock()
    await expect(auth.unlock('4821')).rejects.toThrow(/Wrong PIN/)
  })
})

describe('/api/db guard: reaching past the data', () => {
  it('refuses every server sys_* table by pattern, also new ones', () => {
    for (const sql of ['SELECT * FROM sys_health_keys', 'INSERT INTO sys_health_keys VALUES (1)', 'SELECT * FROM "SYS_SOMETHING_NEW"', 'select * from main.sys_auth'])
      expect(pipelineProblem(ex(sql)), sql).toMatch(/belongs to the server/)
  })
  it('refuses pragma table functions, raw pages and page stats', () => {
    for (const sql of ['select * from pragma_database_list', "SELECT * FROM pragma_table_info('settings')", 'select * from "pragma_function_list"', 'select * from sqlite_dbpage', 'select * from [dbstat]'])
      expect(pipelineProblem(ex(sql)), sql).toMatch(/not allowed/)
  })
  it("still lets the app's own sync and health tables and the schema read through", () => {
    for (const sql of ['INSERT INTO sys_error_log (at, msg) VALUES (?, ?)', 'SELECT * FROM sys_health', 'SELECT * FROM sys_ben_log', 'INSERT INTO sys_cas (ok) VALUES (1)', 'SELECT MAX(id) FROM sys_writes', 'SELECT * FROM sys_table_versions', "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL"])
      expect(pipelineProblem(ex(sql)), sql).toBeNull()
  })
})

describe('F2: web push keeps to the daily budget', () => {
  const env = (() => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pub = publicKey.export({ format: 'jwk' }) as any
    return { VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'), VAPID_PRIVATE_KEY: (privateKey.export({ format: 'jwk' }) as any).d }
  })()
  const setup = (db: SqlJsDatabase) => {
    db.run('CREATE TABLE notifications (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, action TEXT, read_at TEXT, dismissed_at TEXT)')
    db.run('CREATE TABLE sys_push (endpoint TEXT PRIMARY KEY, created INTEGER NOT NULL, last_at TEXT, sid TEXT)')
    db.run("INSERT INTO sys_push (endpoint, created) VALUES ('https://push.example/a', 1)")
  }
  const t0 = Date.parse('2026-11-12T08:00:00Z')
  const add = (db: SqlJsDatabase, id: string, at: number) => db.run("INSERT INTO notifications (id, at, kind, title) VALUES (?, ?, 'ben', 'Life System')", [id, new Date(at).toISOString()])

  it('10 bell-only notifications wake the phone 0 times', async () => {
    const f = fake(setup)
    for (let i = 1; i <= 10; i++) {
      add(f.db, `n${i}`, t0 + i * 60_000)
      await pushNew(cfg, env, t0 + i * 60_000 + 1, f.fetchImpl)
    }
    expect(f.pushes()).toBe(0)
    expect(await peek(cfg, 'https://push.example/a', t0 + 11 * 60_000, f.fetchImpl)).toEqual([])
  })
  it('only the budgeted ones push: at most 4 a day among 10 bell-only', async () => {
    const f = fake(setup)
    const slots = ['morning', 'afternoon', 'plan', 'winddown']
    for (let i = 1; i <= 14; i++) {
      add(f.db, i % 3 === 0 && slots.length ? `budget:${slots.shift()}:2026-11-12` : `n${i}`, t0 + i * 60_000)
      await pushNew(cfg, env, t0 + i * 60_000 + 1, f.fetchImpl)
    }
    expect(f.pushes()).toBe(4)
    const shown = await peek(cfg, 'https://push.example/a', t0 + 15 * 60_000, f.fetchImpl)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((n: { id: string }) => n.id.startsWith('budget:'))).toBe(true)
  })
  it('with the budget switched off, unread ones push as before', async () => {
    const f = fake((db) => {
      setup(db)
      db.run(`INSERT INTO settings VALUES ('simple_mode', '{"on":true,"budget":false}')`)
    })
    add(f.db, 'n1', t0)
    await pushNew(cfg, env, t0 + 1, f.fetchImpl)
    expect(f.pushes()).toBe(1)
  })
})

function call(handler: (req: any, res: any) => Promise<void>, req: { method?: string; headers?: Record<string, string>; url?: string; body?: unknown }) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      setHeader() {},
      end(b?: string) {
        resolve({ status: this.statusCode, body: b ? JSON.parse(String(b)) : null })
      }
    }
    void handler({ method: 'GET', headers: {}, url: '/', on: () => {}, ...req }, res)
  })
}

describe('F3: a database hiccup is a 503, never a 401', () => {
  const down = async () => {
    throw new Error('network down')
  }
  const signedIn = () => {
    vi.stubEnv('TURSO_URL', 'https://t.example')
    vi.stubEnv('TURSO_TOKEN', 'tok')
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-tests')
    forgetEpoch()
    vi.stubGlobal('fetch', down)
    return makeSession(config(), Date.now(), 'whatever')
  }
  it('bot health', async () => {
    const s = signedIn()
    expect((await call(botHealth, { headers: { authorization: `Bearer ${s}` } })).status).toBe(503)
  })
  it('cron plugins and health', async () => {
    const s = signedIn()
    expect((await call(cronHandler, { url: '/api/cron?job=plugins', headers: { authorization: `Bearer ${s}` } })).status).toBe(503)
    expect((await call(cronHandler, { method: 'POST', url: '/api/cron?job=health', body: { op: 'list' }, headers: { authorization: `Bearer ${s}` } })).status).toBe(503)
  })
  it('the tick: no session or secret is a 401 (the timer header alone proves nothing); a session during a hiccup is a 503', async () => {
    const s = signedIn()
    vi.stubEnv('MEGA_BOT_TOKEN', '1:fake')
    vi.stubEnv('TELEGRAM_CHAT_ID', '42')
    expect((await call(cronHandler, { url: '/api/cron?job=tick', headers: {} })).status).toBe(401)
    expect((await call(cronHandler, { url: '/api/cron?job=tick', headers: { 'x-life-timer': 'github' } })).status).toBe(401)
    expect((await call(cronHandler, { url: '/api/cron?job=tick', headers: { authorization: 'Bearer forged.token', 'x-life-timer': 'pinger' } })).status).toBe(401)
    expect((await call(cronHandler, { url: '/api/cron?job=tick', headers: { authorization: `Bearer ${s}` } })).status).toBe(503)
    // The secret gets past the door (then the database is down: 503, not 401).
    expect((await call(cronHandler, { url: '/api/cron?job=tick', headers: { authorization: 'Bearer cron-secret-for-tests', 'x-life-timer': 'github' } })).status).toBe(503)
    expect(sessionSigned(config(), s)).toBeTruthy()
  })
})

describe('the URL guard sees IPv4 hidden in IPv6', () => {
  it('refuses embedded, mapped, 6to4 and NAT64 private addresses', () => {
    for (const u of ['https://[::7f00:1]/', 'https://[::ffff:7f00:1]/', 'https://[::169.254.169.254]/', 'https://[::ffff:169.254.169.254]/', 'https://[0:0:0:0:0:0:0:1]/', 'https://[::a00:1]/', 'https://[64:ff9b::a00:1]/', 'https://[2002:7f00:1::]/', 'https://[2002:a9fe:a9fe::1]/', 'https://[2001:0:4136:e378::1]/', 'https://[fd00::1]/', 'https://[fe80::1]/'])
      expect(urlProblem(u), u).toMatch(/private or local/)
    expect(privateIp('not:an:ip:at:all')).toBe(true)
  })
  it('still allows public addresses', () => {
    for (const u of ['https://[2606:4700:4700::1111]/', 'https://[2002:808:808::1]/', 'https://1.1.1.1/', 'https://example.com/hook']) expect(urlProblem(u), u).toBeNull()
  })
})

describe('Google sign-in state', () => {
  it('accepts its own, refuses a changed one (constant-time compare)', () => {
    const s = makeState(cfg)
    expect(stateOk(cfg, s)).toBe(true)
    const [ts, nonce, sig] = s.split('.')
    expect(stateOk(cfg, `${ts}.${nonce}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`)).toBe(false)
    expect(stateOk(cfg, `${ts}.${nonce}.short`)).toBe(false)
    expect(stateOk(cfg, `${ts}.ffff.${sig}`)).toBe(false)
  })
})

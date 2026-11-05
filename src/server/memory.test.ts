// BR1, BR2, BR4 on the server, end to end on a fake Turso (sql.js: it has no
// vector functions, so this also checks the last fallback, the distance
// computed here), a fake embedder and a fake model.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { Mirror } from '../renderer/src/web/mirror'
import { memoryDocs } from '../core/benMemory'
import { EMBED_DIM, MemoryVectors, fromBlob, toBlob, type Embedder } from './memoryVectors'
import { tidyMemory } from './memoryJobs'
import { coachChat } from './telegramBot'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A fake embedder: words hashed into 768 slots, so shared words mean "close". */
function fakeEmbedder() {
  const calls: string[][] = []
  const embed: Embedder = async (texts) => {
    calls.push(texts)
    return texts.map((t) => {
      const v = new Array(EMBED_DIM).fill(0)
      for (const w of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
        let h = 7
        for (const c of w.slice(0, 5)) h = (h * 31 + c.charCodeAt(0)) % EMBED_DIM
        v[h] += 1
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return v.map((x) => x / n)
    })
  }
  return { embed, calls }
}

let n = 0
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const fakeFetch = (async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org')) return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '{}' }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  }) as any
  vi.stubGlobal('fetch', fakeFetch)
  const url = `https://mem${++n}.fake.turso.io`
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  const set = (key: string, value: unknown) => q(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${JSON.stringify(value).replace(/'/g, "''")}')`)
  return { remote, url, q, set, http: () => new TursoHttp(url, 'k', undefined, fakeFetch) }
}

describe('memory by meaning (BR1)', () => {
  it('vectors round-trip as F32 blobs', () => {
    const v = [0.5, -0.25, 1]
    expect([...fromBlob(toBlob(v))!]).toEqual(v)
  })

  it('embeds only what changed and finds the closest piece without vector functions', async () => {
    const w = world()
    const { embed, calls } = fakeEmbedder()
    const vec = new MemoryVectors(w.http(), embed)
    const docs = memoryDocs({ facts: [{ t: 'Networks exam on 25 November', at: '2026-11-01' }, { t: 'Best friend Daniel plays chess', at: '2026-10-01' }, { t: 'Hates running in the rain', at: '2026-10-02' }] })
    expect(await vec.sync(docs)).toEqual({ embedded: 3, dropped: 0 })
    expect(await vec.sync(docs)).toEqual({ embedded: 0, dropped: 0 })
    expect(calls.length).toBe(1)
    const hits = await vec.search('when is the networks exam', 1)
    expect(hits[0].text).toContain('Networks exam')
    expect(await vec.mode()).toBe('js')
    // A fact gone from memory is gone from the vectors.
    expect(await vec.sync(docs.slice(1))).toEqual({ embedded: 0, dropped: 1 })
    // Server-only: the devices' copy never gets the table.
    expect(w.q("SELECT COUNT(*) FROM sys_mem_vec")[0][0]).toBe(2)
  })

  it("Ben's prompt gets his notes and what he remembers by meaning; his block actions are saved", async () => {
    const w = world()
    w.set('coach_memory', { facts: [{ t: 'Networks exam on 25 November', at: '2026-11-01' }, { t: 'Hates running in the rain', at: '2026-10-02' }], chat: [] })
    w.set('coach_blocks', [{ name: 'About you', text: 'Second-year student, likes CTFs', pinned: true }])
    const { embed } = fakeEmbedder()
    // Embed first (what the tick does), then chat.
    await new MemoryVectors(w.http(), embed).sync(memoryDocs({ facts: [{ t: 'Networks exam on 25 November', at: '2026-11-01' }], log: [{ role: 'me', text: 'the networks exam stresses me, I want to prepare early', at: '2026-10-20T10:00:00Z' }, { role: 'me', text: 'hi', at: '2026-10-21T10:00:00Z' }] }))
    const prompts: string[] = []
    const model = async (p: string) => {
      prompts.push(p)
      return JSON.stringify({ reply: 'You got this.', actions: ['blockadd: Goals now | Pass the networks exam on 25 Nov', 'blockset: About you | trying to change a pinned note'], remember: [] })
    }
    const r = await coachChat({ tursoUrl: w.url, tursoToken: 'k', timeZone: 'UTC', defaults: {}, model, embed } as any, 'how should I prepare for the networks exam?')
    expect(r.ok).toBe(true)
    const p = prompts[0]
    expect(p).toContain('== Your notes about him (blocks you keep) ==')
    expect(p).toContain('Second-year student, likes CTFs')
    expect(p).toContain('== Found in your memory for this message (by meaning) ==\n- [chat] Chat on 2026-10-20: Victor: the networks exam stresses me')
    // A fact already in the list isn't repeated.
    expect(p).not.toContain('- [fact] Networks exam on 25 November')
    expect(r.done.join('\n')).toMatch(/Updated my notes: Goals now/)
    expect(r.done.join('\n')).toMatch(/pinned/)
    const blocks = JSON.parse(String(w.q("SELECT value FROM settings WHERE key = 'coach_blocks'")[0][0]))
    expect(blocks[1]).toMatchObject({ name: 'Goals now', text: 'Pass the networks exam on 25 Nov' })
    expect(blocks[0].text).toBe('Second-year student, likes CTFs')
    const log = JSON.parse(String(w.q("SELECT value FROM settings WHERE key = 'coach_memory_changes'")[0][0]))
    expect(log.map((c: any) => [c.by, c.name])).toEqual([['ben', 'Goals now']])
  }, 30_000)

  it('without embeddings Ben still answers (keyword memory), and "recall" is a lookup', async () => {
    const w = world()
    w.set('coach_memory', { facts: [{ t: 'Daniel is his lab partner', at: '2026-10-01' }], chat: [] })
    const prompts: string[] = []
    const model = async (p: string) => {
      prompts.push(p)
      return prompts.length === 1 ? JSON.stringify({ reply: '', actions: [], need: ['recall lab partner'], remember: [] }) : JSON.stringify({ reply: 'Daniel, your lab partner.', actions: [], remember: [] })
    }
    const r = await coachChat({ tursoUrl: w.url, tursoToken: 'k', timeZone: 'UTC', defaults: {}, model, embed: null } as any, 'who works with me in the lab?')
    expect(r.reply).toContain('Daniel')
    expect(prompts[1]).toContain('Memory for "lab partner":\n- [fact] Daniel is his lab partner')
  }, 30_000)
})

describe('the nightly tidy-up (BR2)', () => {
  it('asks once, applies the decisions, keeps pinned facts and logs every change', async () => {
    const w = world()
    w.set('coach_memory', {
      facts: [
        { t: 'Networks exam on 20 November', at: '2026-10-01' },
        { t: 'Best friend is Daniel', at: '2026-09-01', pin: true },
        { t: 'Networks exam moved to 25 November', at: '2026-11-04' }
      ],
      chat: []
    })
    const mirror = new Mirror(SQL, w.http(), null)
    await mirror.ready
    const asked: string[] = []
    const model = async (p: string) => {
      asked.push(p)
      const id = (t: string) => /(F\d+)(?: \(pinned: keep\))?: (.*) \(noted/g
      const ids = new Map([...p.matchAll(id(''))].map((m) => [m[2], m[1]]))
      return JSON.stringify({
        decisions: [
          { op: 'UPDATE', id: ids.get('Networks exam on 20 November'), text: 'Networks exam on 25 November (moved)' },
          { op: 'DELETE', id: ids.get('Networks exam moved to 25 November') },
          { op: 'DELETE', id: ids.get('Best friend is Daniel') }
        ]
      })
    }
    const now = new Date('2026-11-05T03:10:00Z')
    expect(await tidyMemory({ mirror, vectors: null, model, now })).toBe('2')
    expect(asked.length).toBe(1)
    const mem = JSON.parse(String(w.q("SELECT value FROM settings WHERE key = 'coach_memory'")[0][0]))
    expect(mem.facts.map((f: any) => f.t)).toEqual(['Networks exam on 25 November (moved)', 'Best friend is Daniel'])
    const log = JSON.parse(String(w.q("SELECT value FROM settings WHERE key = 'coach_memory_changes'")[0][0]))
    expect(log.map((c: any) => c.by)).toEqual(['tidy', 'tidy'])
    // Nothing new the next night: no call at all.
    expect(await tidyMemory({ mirror, vectors: null, model, now: new Date('2026-11-08T03:10:00Z') })).toBe('skip')
    expect(asked.length).toBe(1)
  }, 30_000)
})

describe('a warm server uses each request’s own model', () => {
  it('the second message does not inherit the first one’s used-up time limit', async () => {
    const w = world()
    const reply = (text: string) => JSON.stringify({ reply: text, actions: [], remember: [] })
    // The first request's model: its time is up after the first answer (as modelUntil(deadline) would be).
    let firstUp = false
    const first = async () => {
      if (firstUp) throw new Error('Ben took too long to answer. Try again in a moment.')
      firstUp = true
      return reply('first answer')
    }
    const second = async () => reply('second answer')
    const env = { tursoUrl: w.url, tursoToken: 'k', timeZone: 'UTC', defaults: {}, embed: null } as any
    expect((await coachChat({ ...env, model: first }, 'hi')).reply).toContain('first answer')
    expect((await coachChat({ ...env, model: second }, 'hi again')).reply).toContain('second answer')
  }, 30_000)
})

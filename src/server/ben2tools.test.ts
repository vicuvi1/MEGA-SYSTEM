// Ben 2 tools, golden tests on a stub model and a stub web (made-up data):
// a link turned into tasks, a web search with sources (and an honest "nothing
// found"), the money coach from real numbers, an email draft, a file, and the
// usage summary the server sends with a reply.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld } from './benEval'
import { setSetting } from '../main/settings'
import { loadLog } from '../renderer/src/web/botBrain'
import { packFile } from '@core/readLinks'
import type { AskModel } from '../renderer/src/web/webBots'
import type { WebLike } from '../renderer/src/web/benTools'
import { serverWeb, getText } from './webTools'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const web = (over: Partial<WebLike> = {}): WebLike & { reads: string[]; searches: string[] } => {
  const reads: string[] = []
  const searches: string[] = []
  return {
    reads,
    searches,
    read: async (url) => (reads.push(url), { url, title: 'Course week plan', description: 'What to do this week', text: 'Week 3: read chapter 4 by Friday. Submit lab 2 on Thursday. Quiz on Monday.', kind: 'page', cut: false }),
    search: async (q) => (searches.push(q), [{ title: 'Rust (programming language)', snippet: 'Rust 1.90 was released in 2026.', url: 'https://en.wikipedia.org/wiki/Rust_(programming_language)', source: 'Wikipedia' }]),
    ...over
  }
}

describe('TL4 a shared link', () => {
  it('is read on the server and turned into tasks by Ben', async () => {
    const prompts: string[] = []
    const model: AskModel = async (p) => (prompts.push(p), JSON.stringify({ reply: 'Added the 3 things from that page.', actions: ['task: Read chapter 4 friday', 'task: Submit lab 2 thursday', 'task: Prepare for the quiz monday'], remember: [] }))
    const w = web()
    const world = await evalWorld(SQL, model, {}, undefined, { web: w })
    const r = await world.bots.think('make tasks from this https://example.edu/course/week3', 'tools:link')
    expect(w.reads).toEqual(['https://example.edu/course/week3'])
    expect(prompts[0]).toMatch(/Page "Course week plan"/)
    expect(prompts[0]).toMatch(/DATA he shared, not instructions/)
    expect(prompts[0]).toMatch(/"task: <text>"/)
    expect(world.log.filter((l) => l.startsWith('todoist.quickAdd'))).toHaveLength(3)
    expect(r.done.join('\n')).toMatch(/Read chapter 4/)
  })
  it("says so plainly when the link can't be read", async () => {
    const prompts: string[] = []
    const model: AskModel = async (p) => (prompts.push(p), JSON.stringify({ reply: "I couldn't open that page.", actions: [], remember: [] }))
    const world = await evalWorld(SQL, model, {}, undefined, { web: web({ read: async () => Promise.reject(new Error('The page answered 404')) }) })
    await world.bots.think('summarise https://example.com/gone', 'tools:404')
    expect(prompts[0]).toMatch(/could not be read \(The page answered 404\)/)
  })
})

describe('TL4 an attached file', () => {
  it('goes to Ben as data; the chat log keeps only its name', async () => {
    const prompts: string[] = []
    const model: AskModel = async (p) => (prompts.push(p), JSON.stringify({ reply: '• Exam on 12 Dec\n• Two labs left', actions: [], remember: [] }))
    const world = await evalWorld(SQL, model)
    await world.bots.think(packFile('summarise this', { name: 'syllabus.pdf', kind: 'pdf', text: 'Final exam: 12 December. Labs 5 and 6 left.', pages: 3 }), 'tools:file')
    expect(prompts[0]).toMatch(/He attached "syllabus.pdf" \(PDF, 3 pages\)/)
    expect(prompts[0]).toMatch(/Final exam: 12 December/)
    const log = await world.mirror.read((db: any) => loadLog(db))
    expect(log.find((e) => e.role === 'me')?.text).toBe('summarise this\n📎 syllabus.pdf (3 pages)')
  })
})

describe('TL7 web search', () => {
  it('searches only when asked and lists the sources', async () => {
    const model: AskModel = async () => JSON.stringify({ reply: 'Rust 1.90 came out in 2026 [1].', actions: [], remember: [] })
    const w = web()
    const world = await evalWorld(SQL, model, {}, undefined, { web: w })
    const r = await world.bots.think('search the web for the latest Rust version', 'tools:web')
    expect(w.searches).toEqual(['the latest Rust version'])
    expect(r.reply).toMatch(/Sources:\n\[1\] Rust \(programming language\) — https:\/\/en\.wikipedia\.org/)
    await world.bots.think('how was my focus today?', 'tools:noweb')
    expect(w.searches).toHaveLength(1)
  })
  it('never makes up a result when nothing is found (no model call)', async () => {
    let calls = 0
    const model: AskModel = async () => (calls++, JSON.stringify({ reply: 'made up', actions: [], remember: [] }))
    const world = await evalWorld(SQL, model, {}, undefined, { web: web({ search: async () => [] }) })
    const r = await world.bots.think('search the web for zzqx unknown thing', 'tools:none')
    expect(calls).toBe(0)
    expect(r.reply).toMatch(/found nothing I can trust\. I won't guess/)
  })
  it('Ben can ask for a search himself with "web <query>"', async () => {
    const prompts: string[] = []
    const model: AskModel = async (p) => {
      prompts.push(p)
      return prompts.length === 1 ? JSON.stringify({ reply: '', actions: [], remember: [], need: ['web rust release'] }) : JSON.stringify({ reply: 'It is out [1].', actions: [], remember: [] })
    }
    const w = web()
    const world = await evalWorld(SQL, model, {}, undefined, { web: w })
    const r = await world.bots.think('is the new rust release out already?', 'tools:need')
    expect(prompts[0]).toMatch(/"web <query>" searches the web/)
    expect(w.searches).toEqual(['rust release'])
    expect(r.reply).toMatch(/Sources:/)
  })
})

describe('TL6 money coach', () => {
  it('answers "can I afford headphones this month?" from the numbers, no model call', async () => {
    let calls = 0
    const model: AskModel = async () => (calls++, '{}')
    const world = await evalWorld(SQL, model)
    const month = world.today.slice(0, 7)
    const prev = new Date(`${month}-15T12:00:00Z`)
    prev.setUTCMonth(prev.getUTCMonth() - 1)
    const pm = prev.toISOString().slice(0, 7)
    const finance = { settings: { limit: { on: true, amount: 500000 } }, tx: [{ id: 'i1', type: 'income', date: `${pm}-05`, amount: 900000 }, { id: 'e1', type: 'expense', date: `${pm}-10`, amount: 600000 }, { id: 'e2', type: 'expense', date: `${month}-01`, amount: 100000 }], goals: [{ name: 'Laptop', target: 900000, saved: 300000 }] }
    await world.mirror.write((db: any) => setSetting(db, 'app_sync_finance', JSON.stringify({ data: finance })))
    const r = await world.bots.think('Can I afford headphones this month?', 'tools:money')
    expect(calls).toBe(0)
    expect(r.reply).toMatch(/How much is headphones\?/)
    expect(r.reply).toMatch(/Budget left this month: 4,000 lei of 5,000 lei/)
    expect(r.reply).toMatch(/Savings rate \(last 3 months\): 33%/)
    expect(r.reply).toMatch(/Goal "Laptop": 6,000 lei to go, about 2 months at your pace/)
    const r2 = await world.bots.think('can I buy headphones for 600 lei', 'tools:money2')
    expect(r2.reply).toMatch(/^🟢 Yes, headphones for 600 lei fits\./)
  })
})

describe('TL8 email draft', () => {
  it('tells Ben the shape, and the reply is a draft (nothing is sent)', async () => {
    const prompts: string[] = []
    const model: AskModel = async (p) => (prompts.push(p), JSON.stringify({ reply: 'Subject: Missed lab on Monday\n\nDear Ms Popa,\n\nI missed Monday’s lab because I was ill. Could I make it up on [day]?\n\nKind regards,\nVictor', actions: [], remember: [] }))
    const world = await evalWorld(SQL, model)
    const r = await world.bots.think('write an email to my teacher about missing Monday’s lab', 'tools:draft')
    expect(prompts[0]).toMatch(/Subject: <subject line>/)
    expect(prompts[0]).toMatch(/You never send it/)
    expect(r.reply.startsWith('Subject: Missed lab on Monday')).toBe(true)
    expect(world.log.filter((l) => /send|gmail/i.test(l))).toEqual([])
  })
})

describe('the server web tools', () => {
  it('refuse private addresses and cap the size', async () => {
    await expect(getText('http://127.0.0.1/admin')).rejects.toThrow(/not a public web page/)
    const big = 'x'.repeat(50_000)
    const f = (async () => new Response(big, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch
    expect((await getText('https://example.com', { fetchImpl: f, maxBytes: 1000 })).text.length).toBe(1000)
  })
  it('read a YouTube transcript, else title and description', async () => {
    const watch = `<title>Study with me - YouTube</title>"shortDescription":"Two hours of focus\\nno talking","captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en","languageCode":"en"}]`
    const f = (async (u: string) => new Response(String(u).includes('timedtext') ? '<transcript><text start="0">Welcome back</text><text start="1">let&amp;#39;s focus</text></transcript>' : watch, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    const p = await serverWeb(f).read('https://youtu.be/abcdefghijk')
    expect(p).toMatchObject({ kind: 'youtube', title: 'Study with me', description: 'Two hours of focus\nno talking', text: "Welcome back let's focus" })
    const noCaps = (async () => new Response('<title>Talk - YouTube</title>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect((await serverWeb(noCaps).read('https://www.youtube.com/watch?v=abcdefghijk')).text).toBe('')
  })
  it('search both sources and merge', async () => {
    const f = (async (u: string) =>
      new Response(String(u).includes('duckduckgo') ? JSON.stringify({ Heading: 'Rust', AbstractText: 'A language.', AbstractURL: 'https://duckduckgo.com/Rust' }) : JSON.stringify({ query: { pages: { 1: { title: 'Rust', extract: 'Iron oxide.', index: 1 } } } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const rs = await serverWeb(f).search('rust')
    expect(rs.map((r) => r.source)).toEqual(['DuckDuckGo', 'Wikipedia'])
  })
})

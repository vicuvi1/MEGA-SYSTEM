// Coach fix + power: "Review yesterday" must answer in time. A realistic
// (made-up) day goes into Ben's prompt; the strong model is a slow stub. The
// review must still answer (quick model, then numbers alone), never show a raw
// error, and the prompt for a review must be much smaller than a full one.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { addDays } from '@core/dates'
import { evalWorld } from './benEval'
import { readSetting, setSetting } from '../main/settings'
import { PLANNER_VERSION, RHYTHM } from '@core/rhythm'
import type { AskModel } from '../renderer/src/web/webBots'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const REVIEW = 'Review yesterday for me: what went well, what slipped, and one change for today.'

/** A full, busy (made-up) life: 80 remembered facts, a long chat, notes, yesterday's numbers. */
async function busyDay(world: Awaited<ReturnType<typeof evalWorld>>) {
  const { mirror, today } = world
  const y = addDays(today, -1)
  await mirror.write((db: any) => {
    const facts = Array.from({ length: 80 }, (_, i) => ({ t: `Made-up fact ${i}: likes topic ${i} and studies it on ${['Mon', 'Tue', 'Wed'][i % 3]}`, at: today }))
    const chat = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'coach' : 'me', bot: 'mega', text: i % 2 ? `Here is a longish made-up answer number ${i} about the plan, the gym and the lab report.` : `made-up question ${i} about my day`, at: new Date(Date.now() - (40 - i) * 60000).toISOString() }))
    setSetting(db, 'coach_memory', JSON.stringify({ facts, chat }))
    setSetting(db, 'coach_history', JSON.stringify({ days: { [y]: { plan: 'approved', score: 64, mustdos: [1, 3], kept: 1, broken: 1 } } }))
    db.prepare('INSERT INTO day_plans (day, items, review, reasons, updated_at) VALUES (?, ?, NULL, ?, ?)').run(y, JSON.stringify([{ text: 'Lab report intro', done: true }, { text: 'Algebra set 4', done: false }, { text: 'Email the tutor', done: false }]), '[]', new Date().toISOString())
    db.prepare('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, 0)').run(y, 'Lab report', 50, `${y}T09:00:00`, `${y}T09:50:00`)
    db.prepare('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, 0)').run(y, 'Algebra', 25, `${y}T15:00:00`, `${y}T15:25:00`)
    db.prepare('INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(y, '08:10', '07:30', 0, '01:40', '23:30', 0, 2, new Date().toISOString())
    for (let i = 0; i < 6; i++) db.prepare("INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(`n${i}`, `Made-up note ${i}`, 'A made-up note about study plans and the gym. '.repeat(20), new Date().toISOString(), new Date().toISOString())
  })
}

describe('Review yesterday answers in time', () => {
  it('a review prompt is trimmed: yesterday in numbers, not the whole life', async () => {
    const prompts: { kind?: string; len: number; text: string }[] = []
    const model: AskModel = async (prompt, opts) => {
      prompts.push({ kind: opts?.kind, len: prompt.length, text: prompt })
      return JSON.stringify({ reply: 'Lab intro done, algebra slipped. Today: algebra first.', actions: [], remember: [] })
    }
    const world = await evalWorld(SQL, model)
    await busyDay(world)
    const chat = await world.bots.think('what should I do this weekend, any idea?', 'speed:chat')
    expect(chat.ok).toBe(true)
    const r = await world.bots.think(REVIEW, 'speed:review')
    expect(r.ok).toBe(true)
    const [full, review] = prompts
    // Measured: the review prompt carries yesterday's numbers…
    expect(review.text).toMatch(/Yesterday \(\d{4}-\d{2}-\d{2}\) from his data/)
    expect(review.text).toMatch(/Day score: 64\/100/)
    expect(review.text).toMatch(/Must-dos: 1\/3 done/)
    expect(review.text).toMatch(/Focus: 1h 15m/)
    expect(review.text).toMatch(/bed 01:40/)
    expect(review.text).toMatch(/THIS MESSAGE IS A REVIEW/)
    // …and not his notebook or the calendar of the next days.
    expect(review.text).not.toMatch(/Made-up note 3/)
    expect(review.text).not.toMatch(/Calendar today/)
    // One call answers it: no lookup round trip.
    expect(prompts.length).toBe(2)
    const live = (t: string) => t.slice(t.indexOf('<<<LIVE>>>'))
    console.log(`prompt size: full chat ${full.len} chars (live part ${live(full.text).length}), review ${review.len} chars (live part ${live(review.text).length})`)
    if (process.env.DUMP_PROMPT) console.log(live(review.text))
    // The live part (what changes every message, not cached) is at least a third smaller.
    expect(live(review.text).length).toBeLessThan(live(full.text).length * 0.67)
    // Ends with one concrete change he can tap.
    expect(r.buttons?.length).toBe(1)
  }, 20_000)

  it('a slow strong model: the quick model answers, inside the budget', async () => {
    const calls: string[] = []
    const model: AskModel = (prompt, opts) => {
      calls.push(opts?.strong ? `strong ${opts.thinkMs}` : `quick ${opts?.kind}`)
      // The strong model never answers in time (like a long "thinking" run).
      if (opts?.strong) return new Promise(() => {})
      return Promise.resolve(JSON.stringify({ reply: 'Lab intro done, algebra slipped. Today: algebra first.', actions: [], remember: [], buttons: [{ label: '▶ 25 min Algebra', do: 'focus:25:Algebra set 4' }] }))
    }
    const world = await evalWorldTimed(model, { budgetMs: 3_000, reserveMs: 1_200, minMs: 300 })
    await busyDay(world)
    const t0 = Date.now()
    const r = await world.bots.think(REVIEW, 'speed:slow')
    const ms = Date.now() - t0
    expect(r.ok).toBe(true)
    expect(r.reply).toMatch(/algebra/i)
    expect(r.reply).not.toMatch(/took too long|couldn't think/i)
    expect(ms).toBeLessThan(3_000)
    expect(calls[calls.length - 2]).toMatch(/^strong \d+/)
    expect(calls[calls.length - 1]).toBe('quick chat-deep')
  }, 20_000)

  it('the quick model fails once: a silent retry answers', async () => {
    let quick = 0
    const model: AskModel = async (_p, opts) => {
      if (opts?.strong) throw new Error('OpenRouter 502: upstream error')
      if (quick++ === 0) throw new Error('OpenRouter 502: upstream error')
      return JSON.stringify({ reply: 'Second try worked.', actions: [], remember: [] })
    }
    const r = await (await evalWorldTimed(model, { budgetMs: 4_000, reserveMs: 1_200, minMs: 300 })).bots.think('should I study algebra or the lab report first today? why?', 'speed:retry')
    expect(r.ok).toBe(true)
    expect(r.reply).toBe('Second try worked.')
  }, 20_000)

  it('no model answers at all: a review still answers from the numbers, a chat gets a friendly line', async () => {
    const model: AskModel = () => new Promise(() => {})
    const world = await evalWorldTimed(model, { budgetMs: 1_500, reserveMs: 600, minMs: 200 })
    await busyDay(world)
    const r = await world.bots.think(REVIEW, 'speed:none')
    expect(r.ok).toBe(true)
    expect(r.reply).toMatch(/Yesterday scored 64\/100/)
    expect(r.reply).toMatch(/One change for today/)
    expect(r.buttons?.[0]?.do).toMatch(/^focus:25:Algebra set 4/)
    const c = await world.bots.think('should I study algebra or the lab report first today? why?', 'speed:none2')
    expect(c.ok).toBe(false)
    expect(c.retry).toBe(true)
    expect(c.reply).not.toMatch(/took too long|Error|OpenRouter/)
  }, 20_000)
})

/** evalWorld with a smaller time budget (the real one is 44 s). */
async function evalWorldTimed(model: AskModel, timing: { budgetMs: number; reserveMs: number; minMs: number }) {
  return evalWorld(SQL, model, {}, timing)
}

// ---- Speed: where the time goes, with realistic latency (made-up data) ------
//
// Todoist, Google, memory recall and the models answer as slowly as the real
// ones, run 10× faster so the test is quick. Each answer's own timing trace
// (core/benTrace.ts) says where its time went; the budgets catch a change that
// makes Ben slower again.

/** Real-world latencies in ms (estimates), run 10× faster. */
const SCALE = 0.1
const REAL = {
  todoist: 700,
  calendar: 900,
  recall: 600,
  tools: 250,
  /** The quick model: first words after ~1 s (+ reading the prompt), done ~2 s later. */
  quickFirst: 1_000,
  quickRest: 1_800,
  /** The thinking model: ~12 s of reasoning before the first word, then ~3 s of writing. */
  strongThink: 12_000,
  strongRest: 3_000,
  /** Reading the prompt: about 0.15 ms a token. */
  perToken: 0.15
}
const nap = (ms: number) => new Promise((ok) => setTimeout(ok, Math.round(ms * SCALE)))

/** A model stub with realistic latency; it streams its reply like the real one. */
function slowModel(log: string[]): AskModel {
  return async (prompt, opts = {}) => {
    const kind = opts.kind ?? 'chat'
    log.push(`${kind}${opts.strong ? ' strong' : ''}`)
    const read = (prompt.length / 4) * REAL.perToken
    const strong = !!opts.strong && !!opts.think
    await nap((strong ? REAL.strongThink : REAL.quickFirst) + read)
    const reply = kind === 'plan-names' ? null : 'Here is the honest answer, short and with numbers.'
    if (reply) opts.onDelta?.(reply.slice(0, 12))
    await nap(strong ? REAL.strongRest : REAL.quickRest)
    if (kind === 'plan-names') return JSON.stringify({ headline: '3 must-dos · lab first', mustdos: [], names: ['Named block', 'Named block', 'Named block'] }) // a deadline or goal session keeps its name, so name a few
    return JSON.stringify({ reply, actions: [], remember: [] })
  }
}

const NET = { todoistMs: REAL.todoist * SCALE, calendarMs: REAL.calendar * SCALE, recallMs: REAL.recall * SCALE, toolsMs: REAL.tools * SCALE, tasks: Array.from({ length: 11 }, (_, i) => ({ content: `Made-up task ${i + 1}`, priority: 1 + (i % 4) })) }
const TIMING = { budgetMs: 44_000 * SCALE, reserveMs: 14_000 * SCALE, minMs: 6_000 * SCALE }
const ASKS = ['plan my day', 'log 500 ml water', 'what should I do now?', 'review my week', 'move gym to 18:00', 'review yesterday'] as const

async function measure(say: string) {
  const calls: string[] = []
  const world = await evalWorld(SQL, slowModel(calls), {}, TIMING, NET)
  world.calls.todoist = 0
  world.calls.calendar = 0
  const r = await world.bots.think(say, `speed:${say}`, () => {})
  expect(r.ok).toBe(true)
  await world.bots.settle()
  return { r, t: r.timing!, calls, fetches: { ...world.calls }, log: world.log }
}

const real = (ms: number | null | undefined) => (ms == null ? '-' : `${(ms / SCALE / 1000).toFixed(1)} s`)
const sec = (ms: number) => ms / SCALE / 1000

describe('Speed: everyday asks with realistic latency', () => {
  afterEach(() => vi.useRealTimers())

  it('each answer says where its time went, and stays inside its budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 8, 30))
    const rows: string[] = []
    const out: Record<string, Awaited<ReturnType<typeof measure>>> = {}
    for (const say of ASKS) {
      const m = await measure(say)
      out[say] = m
      rows.push(`${say.padEnd(22)} total ${real(m.t.totalMs).padStart(6)} · first words ${real(m.t.firstTextMs).padStart(6)} · ${m.t.path.padEnd(5)} · model: ${m.calls.join(', ') || 'none'} · todoist ${m.fetches.todoist}, calendar ${m.fetches.calendar} · ${m.t.spans.filter((x) => x.ms >= 2).map((x) => `${x.name} ${real(x.ms)}`).join(', ')}`)
    }
    console.log(`Ben speed (real-time estimate; CPU work counts 10×):\n${rows.join('\n')}`)
    // "Plan my day": packed in code, Todoist and the calendar read once, the names land later.
    expect(sec(out['plan my day'].t.totalMs)).toBeLessThan(3)
    expect(out['plan my day'].fetches).toEqual({ todoist: 2, calendar: 1 })
    expect(out['plan my day'].calls).toEqual(['plan-names'])
    expect(out['plan my day'].r.show).toContain('plan')
    // Logs and "what now" need no model and no outside call.
    for (const say of ['log 500 ml water', 'what should I do now?']) {
      expect(out[say].calls).toEqual([])
      expect(sec(out[say].t.totalMs)).toBeLessThan(0.5)
    }
    expect(out['log 500 ml water'].r.done.join(' ')).toMatch(/500/)
    // "Move gym to 18:00": done in code on the calendar.
    expect(out['move gym to 18:00'].calls).toEqual([])
    expect(out['move gym to 18:00'].log.join('\n')).toMatch(/calendar\.move g3 [^\n]*T18:00/)
    expect(sec(out['move gym to 18:00'].t.totalMs)).toBeLessThan(2)
    // Reviews still think with the strong model (no power lost), but show their numbers within a second.
    for (const say of ['review my week', 'review yesterday']) {
      expect(out[say].calls).toEqual(['chat-deep strong'])
      expect(out[say].fetches).toEqual({ todoist: 0, calendar: 0 })
      expect(sec(out[say].t.firstTextMs!)).toBeLessThan(1.5)
      expect(sec(out[say].t.totalMs)).toBeLessThan(20)
    }
  }, 60_000)

  it('the plan shows before the model names its blocks; the names land in place', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 8, 30))
    const world = await evalWorld(SQL, slowModel([]), {}, TIMING, NET)
    const r = await world.bots.think('plan my day', 'speed:names', () => {})
    const titles = () => world.mirror.read((db: any) => (readSetting(db, RHYTHM as any) as any)?.briefing?.plan.blocks.map((b: any) => b.title) as string[])
    expect(r.show).toContain('plan')
    expect(await titles()).not.toContain('Named block')
    await world.bots.settle()
    expect(await titles()).toContain('Named block')
  }, 20_000)

  it('a follow-up within a minute reuses what Todoist and the calendar just said; a change through Ben reads them again', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 8, 30))
    const quick: AskModel = async () => JSON.stringify({ reply: 'Ok.', actions: [], remember: [] })
    const world = await evalWorld(SQL, quick, {}, TIMING, NET)
    await world.bots.think('how is my afternoon looking', 'speed:c1')
    const after1 = { ...world.calls }
    await world.bots.think('and the evening?', 'speed:c2')
    expect(world.calls).toEqual(after1)
    // A change made through Ben forgets the copy.
    await world.bots.act('add a task', ['task: Made-up errand today'])
    await world.bots.think('what is left today', 'speed:c3')
    expect(world.calls.todoist).toBeGreaterThan(after1.todoist)
  }, 20_000)

  it('"Think harder" asks the same question again, with the thinking model', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 8, 30))
    const seen: { strong: boolean; live: string }[] = []
    const model: AskModel = async (p, o) => {
      seen.push({ strong: !!o?.strong, live: p.slice(p.lastIndexOf('<<<LIVE>>>')) })
      // The thinking model is too slow the first time: the quick one answers and offers "Think harder".
      if (o?.strong && seen.filter((x) => x.strong).length === 1) return new Promise(() => {})
      return JSON.stringify({ reply: o?.strong ? 'Thought it through: lab first.' : 'Lab first.', actions: [], remember: [] })
    }
    const world = await evalWorld(SQL, model, {}, { budgetMs: 3_000, reserveMs: 1_200, minMs: 300 })
    const a = await world.bots.think('should I study algebra or the lab report first today? why?', 'speed:h1')
    expect(a.chips?.[0]).toBe('Think harder')
    const b = await world.bots.think('Think harder', 'speed:h2')
    expect(b.reply).toBe('Thought it through: lab first.')
    const last = seen[seen.length - 1]
    expect(last.strong).toBe(true)
    expect(last.live).toMatch(/algebra or the lab report/)
  }, 20_000)

  it('asked for the plan again at 12:00, an approved plan whose 10:00 block was missed starts from now (its calendar block moves)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 12, 0))
    const world = await evalWorld(SQL, slowModel([]), { extraEvents: [{ title: 'Lab report', h: 10 }] })
    await world.mirror.write((db: any) =>
      setSetting(db, RHYTHM, JSON.stringify({ day: world.today, water: [], briefing: { status: 'approved', sentAt: new Date().toISOString(), version: 1, planner: PLANNER_VERSION, plan: { day: world.today, headline: 'Lab first', mustdos: ['Lab report'], blocks: [{ title: 'Lab report', start: '10:00', minutes: 60, tasks: ['Lab report'] }, { title: 'Study algebra', start: '16:00', minutes: 50 }], training: null, waterMl: 2500 } } }))
    )
    const r = await world.bots.think('plan my day', 'speed:late')
    expect(r.show).toContain('plan')
    expect(r.reply).toMatch(/starting at 12:00/)
    // Moved into the free time from 12:05, before the 13:30 lab (a fixed event that stays).
    expect(world.log.join('\n')).toMatch(/calendar\.move x1 [^\n]*T12:05/)
    const blocks = await world.mirror.read((db: any) => (readSetting(db, RHYTHM as any) as any).briefing.plan.blocks as { title: string; start: string }[])
    expect(blocks.find((b) => b.title === 'Lab report')?.start).toBe('12:05')
    expect(blocks.find((b) => b.title === 'Study algebra')?.start).toBe('16:00')
  }, 20_000)

  it('a task he asks for today is remembered as his ask (the plan never moves it to tomorrow)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0))
    const model: AskModel = async () => JSON.stringify({ reply: 'Added.', actions: ['task: Read 10 min today @today'], remember: [] })
    const world = await evalWorld(SQL, model)
    await world.bots.think('add read 10 min @today', 'speed:ask')
    const asked = await world.mirror.read((db: any) => readSetting(db, 'plan_asked') as any)
    expect(asked.day).toBe(world.today)
    expect(asked.titles.join(' ')).toMatch(/Read 10 min/)
  }, 20_000)
})

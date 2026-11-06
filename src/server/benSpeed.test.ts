// Coach fix + power: "Review yesterday" must answer in time. A realistic
// (made-up) day goes into Ben's prompt; the strong model is a slow stub. The
// review must still answer (quick model, then numbers alone), never show a raw
// error, and the prompt for a review must be much smaller than a full one.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { addDays } from '@core/dates'
import { evalWorld } from './benEval'
import { setSetting } from '../main/settings'
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
    const chat = await world.bots.think('what should I eat tonight, any idea?', 'speed:chat')
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

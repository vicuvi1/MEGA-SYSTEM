// Coach chat fix (2026-11-08): "it's still slow". The owner's real questions, on a
// made-up life, with realistic latency (Todoist, Google, memory recall and the models
// answer as slowly as the real ones, run 10× faster). Each answer's own timing trace
// (core/benTrace.ts) says where its time went; the numbers print as a table.
// Simple data questions are answered from the data in code (no model, < 1.5 s);
// other questions get a prompt with only what they need.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

const SCALE = 0.1
const REAL = { todoist: 700, calendar: 900, recall: 600, tools: 250, quickFirst: 1_000, quickRest: 1_800, strongThink: 12_000, strongRest: 3_000, perToken: 0.15 }
const nap = (ms: number) => new Promise((ok) => setTimeout(ok, Math.round(ms * SCALE)))

function slowModel(log: { kind: string; strong: boolean; tokens: number }[]): AskModel {
  return async (prompt, opts = {}) => {
    const kind = opts.kind ?? 'chat'
    log.push({ kind, strong: !!opts.strong, tokens: Math.ceil(prompt.length / 4) })
    if (process.env.DUMP_PROMPT && kind.startsWith('chat')) console.log(prompt)
    const strong = !!opts.strong && !!opts.think
    await nap((strong ? REAL.strongThink : REAL.quickFirst) + (prompt.length / 4) * REAL.perToken)
    const reply = kind === 'plan-names' ? null : 'Here is the honest answer, short.'
    if (reply) opts.onDelta?.(reply.slice(0, 12))
    await nap(strong ? REAL.strongRest : REAL.quickRest)
    if (kind === 'plan-names') return JSON.stringify({ headline: '3 must-dos · lab first', mustdos: [], names: ['Named block'] })
    return JSON.stringify({ reply, actions: [], remember: [] })
  }
}

const NET = { todoistMs: REAL.todoist * SCALE, calendarMs: REAL.calendar * SCALE, recallMs: REAL.recall * SCALE, toolsMs: REAL.tools * SCALE, tasks: Array.from({ length: 11 }, (_, i) => ({ content: `Made-up task ${i + 1}`, priority: 1 + (i % 4) })) }
const TIMING = { budgetMs: 44_000 * SCALE, reserveMs: 14_000 * SCALE, minMs: 6_000 * SCALE }

/** A made-up life: 10 nights of sleep, money in and out this month, points, a long chat. */
async function madeUpLife(world: Awaited<ReturnType<typeof evalWorld>>) {
  const { mirror, today } = world
  await mirror.write((db: any) => {
    const beds = ['23:30', '00:10', '23:50', '01:00', '23:40', '00:30', '23:20', '00:00', '23:45', '00:15']
    const wakes = ['07:30', '07:40', '07:10', '08:30', '07:20', '08:00', '07:00', '07:30', '07:15', '07:45']
    for (let i = 1; i <= 10; i++)
      db.prepare('INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(addDays(today, -i + 1), wakes[i - 1], '07:30', wakes[i - 1] <= '07:30' ? 1 : 0, beds[i - 1], '23:30', 0, 3, new Date().toISOString())
    const month = today.slice(0, 8)
    const finance = {
      settings: { currency: 'MDL', categories: [{ id: 'c1', name: 'Food' }, { id: 'c2', name: 'Salary' }, { id: 'c3', name: 'Freelance' }] },
      tx: [
        { id: 'i1', type: 'income', amount: 1_200_000, category: 'c2', date: `${month}01`, note: 'made-up salary' },
        { id: 'i2', type: 'income', amount: 250_000, category: 'c3', date: `${month}02`, note: 'made-up gig' },
        { id: 'e1', type: 'expense', amount: 12_000, category: 'c1', date: `${month}01`, note: 'made-up pizza' },
        { id: 'i0', type: 'income', amount: 999_900, category: 'c2', date: '2020-01-01', note: 'long ago' }
      ]
    }
    setSetting(db, 'app_sync_finance', JSON.stringify({ data: finance }))
    const facts = Array.from({ length: 60 }, (_, i) => ({ t: `Made-up fact ${i}: likes topic ${i}`, at: today }))
    const chat = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'coach' : 'me', bot: 'mega', text: i % 2 ? `A longish made-up answer ${i} about the plan, the gym and the lab report.` : `made-up question ${i}`, at: new Date(Date.now() - (30 - i) * 60000).toISOString() }))
    setSetting(db, 'coach_memory', JSON.stringify({ facts, chat }))
    for (let i = 0; i < 6; i++) db.prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(`n${i}`, `Made-up note ${i}`, 'A made-up note about study plans and the gym. '.repeat(20), new Date().toISOString(), new Date().toISOString())
  })
}

export const ASKS = ['how much do I sleep on average', 'how much I have earned this month?', 'what are my habits today?', 'what are my tasks today?', 'should I go to the gym tonight or rest?', 'plan my day'] as const

async function measure(say: string) {
  const calls: { kind: string; strong: boolean; tokens: number }[] = []
  const world = await evalWorld(SQL, slowModel(calls), {}, TIMING, NET)
  await madeUpLife(world)
  const r = await world.bots.think(say, `speed:${say}`, () => {})
  await world.bots.settle()
  return { r, t: r.timing!, calls }
}

const real = (ms: number | null | undefined) => (ms == null ? '-' : `${(ms / SCALE / 1000).toFixed(1)} s`)
const sec = (ms: number | null | undefined) => (ms ?? 0) / SCALE / 1000

describe('Coach chat speed: the owner\'s questions', () => {
  afterEach(() => vi.useRealTimers())

  it('simple data questions answer from the data in code; others get a small prompt', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 18, 15, 21))
    const rows: string[] = []
    const out: Record<string, Awaited<ReturnType<typeof measure>>> = {}
    for (const say of ASKS) {
      const m = await measure(say)
      out[say] = m
      rows.push(`${say.padEnd(40)} total ${real(m.t.totalMs).padStart(6)} · first words ${real(m.t.firstTextMs).padStart(6)} · ${m.t.path.padEnd(5)} · model: ${m.calls.map((c) => `${c.kind}${c.strong ? ' strong' : ''} ${c.tokens} tk`).join(', ') || 'none'}`)
    }
    console.log(`Coach chat speed (real-time estimate):\n${rows.join('\n')}`)
    if (process.env.SHOW_REPLIES) for (const say of ASKS) console.log(`> ${say}\n${out[say].r.reply}\n[steps: ${(out[say].r.steps ?? []).join(" / ")}]`)
    // Simple data questions: no model, well under 1.5 s, real numbers from the data.
    for (const say of ASKS.slice(0, 4)) {
      const m = out[say]
      expect(m.r.ok, say).toBe(true)
      expect(m.calls.length, say).toBe(0)
      expect(sec(m.t.totalMs), say).toBeLessThan(1.5)
    }
    expect(out[ASKS[0]].r.reply).toMatch(/7 h \d+ min|7\.\d h|\d h \d+ min/)
    expect(out[ASKS[1]].r.reply).toMatch(/14,500 lei/)
    // A normal question: the quick model with a trimmed prompt, first words in under 3 s.
    const gym = out[ASKS[4]]
    expect(gym.calls[0].strong).toBe(false)
    expect(gym.calls[0].tokens).toBeLessThan(6_000)
    expect(sec(gym.t.firstTextMs)).toBeLessThan(3)
  }, 60_000)
})

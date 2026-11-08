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

/** A made-up life: 10 nights of sleep, money in and out this month, points, a long chat. `moneyToday`: 55 lei food and a 15 lei Rewards buy today. */
async function madeUpLife(world: Awaited<ReturnType<typeof evalWorld>>, moneyToday = false) {
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
        { id: 'i0', type: 'income', amount: 999_900, category: 'c2', date: '2020-01-01', note: 'long ago' },
        ...(moneyToday
          ? [
              { id: 'tg-food', type: 'expense', amount: 5_500, base: 5_500, category: 'food', date: today, note: 'food', createdAt: Date.now() - 60_000, account: 'a1' },
              { id: 'life-reward-41', type: 'expense', amount: 1_500, base: 1_500, category: 'c4', date: today, note: 'Reward: 1 hour of gaming', createdAt: Date.now() - 30_000, account: 'a1' }
            ]
          : [])
      ],
      ...(moneyToday ? { limit: { on: true, amount: 500_000 } } : {})
    }
    if (moneyToday) {
      ;(finance.settings as any).categories = [{ id: 'food', name: 'Food', type: 'expense' }, { id: 'c1', name: 'Dining', type: 'expense' }, { id: 'c2', name: 'Salary', type: 'income' }, { id: 'c3', name: 'Freelance', type: 'income' }, { id: 'c4', name: 'Reward', type: 'expense' }, { id: 'other', name: 'Other', type: 'expense' }]
      ;(finance.settings as any).accounts = [{ id: 'a1', name: 'Made-up card', currency: 'MDL' }]
      ;(finance.settings as any).limit = (finance as any).limit
    }
    setSetting(db, 'app_sync_finance', JSON.stringify({ data: finance }))
    const facts = Array.from({ length: 60 }, (_, i) => ({ t: `Made-up fact ${i}: likes topic ${i}`, at: today }))
    const chat = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'coach' : 'me', bot: 'mega', text: i % 2 ? `A longish made-up answer ${i} about the plan, the gym and the lab report.` : `made-up question ${i}`, at: new Date(Date.now() - (30 - i) * 60000).toISOString() }))
    setSetting(db, 'coach_memory', JSON.stringify({ facts, chat }))
    for (let i = 0; i < 6; i++) db.prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(`n${i}`, `Made-up note ${i}`, 'A made-up note about study plans and the gym. '.repeat(20), new Date().toISOString(), new Date().toISOString())
  })
}

export const ASKS = ['how much do I sleep on average', 'how much I have earned this month?', 'what are my habits today?', 'what are my tasks today?', 'should I go to the gym tonight or rest?', 'plan my day'] as const

export const MONEY_ASKS = ['add that I spent 55 mdl today for food', 'wait where you got 70 from?', 'delete the gaming one', 'how much is left this month?', 'am cheltuit 55 lei pe mancare', 'How much did I spend this month?'] as const

async function measure(say: string, moneyToday = false) {
  const calls: { kind: string; strong: boolean; tokens: number }[] = []
  const world = await evalWorld(SQL, slowModel(calls), {}, TIMING, NET)
  await madeUpLife(world, moneyToday)
  const r = await world.bots.think(say, `speed:${say}`, () => {})
  await world.bots.settle()
  return { r, t: r.timing!, calls, world }
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

  it('simple money things answer in code, under a second, with numbers from the records', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 18, 15, 21))
    const rows: string[] = []
    const out: Record<string, Awaited<ReturnType<typeof measure>>> = {}
    for (const say of MONEY_ASKS) {
      const m = await measure(say, true)
      out[say] = m
      rows.push(`${say.padEnd(40)} total ${real(m.t.totalMs).padStart(6)} · ${m.t.path.padEnd(5)} · model: ${m.calls.map((c) => c.kind).join(', ') || 'none'}`)
    }
    console.log(`Coach chat money speed (real-time estimate):\n${rows.join('\n')}`)
    if (process.env.SHOW_REPLIES) for (const say of MONEY_ASKS) console.log(`> ${say}\n${out[say].r.reply}\n[${(out[say].r.done ?? []).join(' / ')}] [${(out[say].r.buttons ?? []).map((b) => b.label).join(' / ')}]`)
    for (const say of MONEY_ASKS) {
      expect(out[say].r.ok, say).toBe(true)
      expect(out[say].calls.length, say).toBe(0)
      expect(sec(out[say].t.totalMs), say).toBeLessThan(1)
    }
    // Logged: today's total from the records (55 + 15 already there + 55 now), with Undo.
    const log = out[MONEY_ASKS[0]]
    expect(log.r.reply).toMatch(/55 MDL · Food\. Today so far: 125 lei\./)
    expect(log.r.undo?.some((u) => u?.k === 'money')).toBe(true)
    expect(out[MONEY_ASKS[4]].r.reply).toMatch(/55 MDL · Food/)
    expect(out[MONEY_ASKS[4]].r.undo?.some((u) => u?.k === 'money')).toBe(true)
    // Where 70 came from: both records, with their M-numbers.
    const from = out[MONEY_ASKS[1]].r.reply
    expect(from).toContain("Today's 70 lei is 2 records:")
    expect(from).toMatch(/M1 15 lei · Reward/)
    expect(from).toMatch(/M2 55 lei · Food/)
    // Delete asks first with the exact record; the tap deletes it, with Undo that puts it back.
    const del = out[MONEY_ASKS[2]]
    expect(del.r.reply).toMatch(/Delete this record[\s\S]*M1 15 lei · Reward/)
    const tap = del.r.buttons?.find((b) => b.label.startsWith('🗑'))
    expect(tap?.do).toMatch(/^say:✓\w+ Yes, delete M1/)
    const stillThere = await del.world.mirror.read((db: any) => JSON.parse(String(db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").get().value)).data.tx.some((t: any) => t.id === 'life-reward-41'))
    expect(stillThere).toBe(true)
    vi.setSystemTime(new Date(2026, 10, 18, 15, 22)) // the tap comes a minute later (the log keys replies by time)
    const done = await del.world.bots.think(tap!.do.slice(4), 'speed:tap', () => {})
    await del.world.bots.settle()
    expect(done.done.join(' ')).toMatch(/Deleted from Finance Helper/)
    const k = done.undo?.findIndex((u) => u?.k === 'moneyback') ?? -1
    expect(k).toBeGreaterThanOrEqual(0)
    const has = () => del.world.mirror.read((db: any) => JSON.parse(String(db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").get().value)).data.tx.some((t: any) => t.id === 'life-reward-41'))
    expect(await has()).toBe(false)
    const back = await del.world.bots.undoReply(done.at!, k)
    expect(back.ok).toBe(true)
    expect(await has()).toBe(true)
    expect(out[MONEY_ASKS[5]].r.reply).toMatch(/You spent 190 lei this month \(3 records\)/)
    // Left this month: Finance Helper's limit minus this month's spending.
    expect(out[MONEY_ASKS[3]].r.reply).toMatch(/You have 4,810 lei left this month \(spent 190 lei of 5,000 lei\)/)
  }, 60_000)
})

// Coach fix (2026-11-10): "why does the coach think so long, the coach is still stupid".
// The owner's real message at 07:41, on a made-up life with realistic latency (the
// same harness as benAskSpeed.test.ts: Todoist, Google, memory recall and the models
// answer as slowly as the real ones, run 10x faster). A sleep report with a short
// night is answered in code: the sleep is logged, today's draft plan really gets
// lighter (nothing before now, less focus, a nap that the text and the plan agree on,
// lighter training) and the reason he gave gets one kind line with a bedtime target.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld } from './benEval'
import { setSetting, getSetting } from '../main/settings'
import { PLANNER_VERSION, RHYTHM, type DayProposal } from '@core/rhythm'
import { planSummary } from '@core/benPlanText'
import type { AskModel } from '../renderer/src/web/webBots'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const SCALE = 0.1
const REAL = { todoist: 700, calendar: 900, recall: 600, tools: 250, quickFirst: 1_000, quickRest: 1_800, perToken: 0.15 }
const nap = (ms: number) => new Promise((ok) => setTimeout(ok, Math.round(ms * SCALE)))
const NET = { todoistMs: REAL.todoist * SCALE, calendarMs: REAL.calendar * SCALE, recallMs: REAL.recall * SCALE, toolsMs: REAL.tools * SCALE }
const TIMING = { budgetMs: 44_000 * SCALE, reserveMs: 14_000 * SCALE, minMs: 6_000 * SCALE }

/** The model as the owner saw it: says "keep it light", logs the sleep and shows the same plan. */
function slowModel(log: { kind: string; tokens: number }[]): AskModel {
  return async (prompt, opts = {}) => {
    log.push({ kind: opts.kind ?? 'chat', tokens: Math.ceil(prompt.length / 4) })
    await nap(REAL.quickFirst + (prompt.length / 4) * REAL.perToken)
    await nap(REAL.quickRest)
    return JSON.stringify({ reply: 'Logged 5.5 hours of sleep. Late nights happen, so keep this morning light and aim for a nap before 15:00.', actions: [], show: ['plan'], chips: ['Nap at 13:00'], remember: [] })
  }
}

/** The heavy draft plan from the screenshot: 8 blocks, 5h45 of focus, from 07:35 to 17:45. */
function heavyPlan(day: string): DayProposal {
  const b = (start: string, minutes: number, title: string, kind: 'focus' | 'quick' | 'goal', tasks: string[] = []) => ({ id: `b${start.replace(':', '')}`, start, minutes, title, kind, tasks })
  return {
    day,
    headline: '3 must-dos · 8 blocks · 5h45 focus',
    mustdos: ['laborator 4 PC', 'etica', 'sport'],
    blocks: [
      b('07:35', 25, 'Quick tasks', 'quick', ['Made-up email', 'Made-up form']),
      b('08:10', 45, 'Lab report draft', 'focus', ['laborator 4 PC']),
      b('10:10', 60, 'Ethics essay', 'focus', ['etica']),
      b('11:20', 50, 'Study algebra', 'goal'),
      b('12:20', 30, 'Emails', 'quick', ['Made-up reply']),
      b('15:10', 60, 'Side project', 'focus', ['Made-up project task']),
      b('16:20', 45, 'Reading notes', 'focus', ['Made-up reading']),
      b('17:15', 30, 'Admin', 'quick', ['Made-up admin'])
    ],
    training: { time: '18:00', what: 'Upper body 30 min', minutes: 30 },
    waterMl: 2500
  }
}

const SAY = 'I went to sleep at 2 am and got up at 7:30 am, spent too much time with gf eh'

async function world() {
  const calls: { kind: string; tokens: number }[] = []
  const w = await evalWorld(SQL, slowModel(calls), {}, TIMING, NET)
  await w.mirror.write((db: any) => setSetting(db, RHYTHM, JSON.stringify({ day: w.today, water: [], briefing: { status: 'proposed', sentAt: new Date().toISOString(), version: 1, planner: PLANNER_VERSION, plan: heavyPlan(w.today) } })))
  return { ...w, calls }
}

const real = (ms: number | null | undefined) => (ms == null ? '-' : `${(ms / SCALE / 1000).toFixed(1)} s`)

describe('A short night told to the coach (07:41)', () => {
  afterEach(() => vi.useRealTimers())

  it('answers in code at once, logs the sleep and really lightens the plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 10, 7, 41))
    const w = await world()
    const steps: string[] = []
    const r = await w.bots.think(SAY, 'short-night', (s) => steps.push(s))
    await w.bots.settle()
    const t = r.timing!
    console.log(`short night: total ${real(t.totalMs)} · first words ${real(t.firstTextMs)} · ${t.path} · model calls: ${w.calls.map((c) => `${c.kind} ${c.tokens} tk`).join(', ') || 'none'}\n${r.reply}\nCHIPS: ${(r.chips ?? []).join(' | ')}`)
    console.log(t.spans.map((s) => `${s.name} ${real(s.ms)}`).join(' · '))
    expect(r.ok).toBe(true)
    // Before: one model call (a 6k-token prompt on this small made-up life) after the Todoist,
    // calendar and memory reads: 4.8 s, and the same heavy plan. Now: no model, the first words at
    // once, the whole answer in about a second (one short calendar read).
    expect(w.calls.length).toBe(0)
    expect(t.path).not.toBe('model')
    expect(t.firstTextMs! / SCALE).toBeLessThan(300)
    expect(t.totalMs / SCALE).toBeLessThan(1_500)
    expect(steps.some((s) => s.startsWith('\u0001Logged 5h30 of sleep'))).toBe(true)

    // The sleep is logged (bed 02:00 the night before, up 07:30).
    const row = await w.mirror.read((db: any) => db.prepare('SELECT wake_time, bed_time FROM sleep_logs WHERE day = ?').get(w.today))
    expect(row).toMatchObject({ wake_time: '07:30', bed_time: '02:00' })

    // The plan really changed: nothing before now, less focus, the must-dos kept, a nap, lighter training.
    const st = await w.mirror.read((db: any) => JSON.parse(String(getSetting(db, RHYTHM))))
    const p: DayProposal = st.briefing.plan
    expect(st.briefing.version).toBe(2)
    expect(p.blocks.every((b) => b.start >= '07:45')).toBe(true)
    const sum = planSummary(p)
    expect(sum.focusMin).toBeLessThanOrEqual(225)
    expect(sum.focusMin).toBeGreaterThanOrEqual(120)
    for (const m of ['laborator 4 PC', 'etica']) expect(p.blocks.some((b) => b.tasks?.includes(m))).toBe(true)
    const napB = p.blocks.find((b) => b.rest)!
    expect(napB).toBeTruthy()
    expect(napB.start < '15:00').toBe(true)
    expect(p.training?.what).toMatch(/^(Lighter 70%|Short 50%): Upper body/)
    expect(p.training!.minutes!).toBeLessThan(30)

    // The reply leads with what changed, its numbers are the card's, the nap time is the plan's.
    const lines = r.reply.split('\n')
    expect(lines[0]).toMatch(new RegExp(`^Lighter day: ${sum.focusMin >= 60 ? `${Math.floor(sum.focusMin / 60)}h${String(sum.focusMin % 60).padStart(2, '0')}` : sum.focusMin} focus instead of 5h45, nap ${napB.start}–`))
    expect(r.reply).toContain('Slept 5h30 (02:00–07:30), logged.')
    expect(r.reply).toMatch(/Kept your 3 must-dos/)
    // He gave a reason: one kind line, no lecture, with a bedtime for tonight.
    expect(r.reply).toMatch(/Time with your girlfriend counts too, no guilt\. Tonight: say goodnight by \d\d:\d\d, lights out by \d\d:\d\d\./)
    expect(r.reply).not.toMatch(/should have|shouldn't|bad|discipline/i)
    expect(r.show).toContain('plan')
    expect(r.chips).toContain('Keep the full plan')
    expect((r.chips ?? []).some((c) => /nap at/i.test(c))).toBe(false)
    expect(r.done.join(' ')).toMatch(/Sleep .*up 07:30.*bed 02:00/)

    // "Keep the full plan" puts it back (one Undo).
    vi.setSystemTime(new Date(2026, 10, 10, 7, 42))
    const back = await w.bots.think('Keep the full plan', 'short-night-keep', () => {})
    await w.bots.settle()
    expect(back.reply).toMatch(/full plan is back/)
    const st2 = await w.mirror.read((db: any) => JSON.parse(String(getSetting(db, RHYTHM))))
    expect(planSummary(st2.briefing.plan).focusMin).toBe(345)
    expect(w.calls.length).toBe(0)
  }, 30_000)

  it('"Move the rest to tomorrow" moves only what the lighter day took off, with Todoist dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 10, 7, 41))
    const w = await world()
    await w.bots.think(SAY, 'short-night', () => {})
    vi.setSystemTime(new Date(2026, 10, 10, 7, 43))
    const r = await w.bots.think('Move the rest to tomorrow', 'short-night-rest', () => {})
    await w.bots.settle()
    expect(r.reply).toMatch(/^Moved \d+ tasks? to tomorrow\./)
    const p: DayProposal = await w.mirror.read((db: any) => JSON.parse(String(getSetting(db, RHYTHM))).briefing.plan)
    expect((p.deferred ?? []).length).toBeGreaterThan(0)
    expect(p.mustdos).toEqual(['laborator 4 PC', 'etica', 'sport'])
    expect(w.calls.length).toBe(0)
  }, 30_000)

  it('a good night changes nothing, and a question about sleep still goes to Ben', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 10, 8, 10))
    const w = await world()
    const r = await w.bots.think('went to bed at 23:30 and woke up at 7:40', 'good-night', () => {})
    await w.bots.settle()
    expect(r.reply).toMatch(/Slept 8h10 \(23:30–07:40\), logged\.\nA good night/)
    const st = await w.mirror.read((db: any) => JSON.parse(String(getSetting(db, RHYTHM))))
    expect(st.briefing.version).toBe(1)
    expect(w.calls.length).toBe(0)
    const q = await w.bots.think('why do I feel tired if I slept from 2 to 7:30?', 'question', () => {})
    await w.bots.settle()
    expect(w.calls.length).toBe(1)
    expect(q.reply).not.toMatch(/logged/)
  }, 30_000)
})

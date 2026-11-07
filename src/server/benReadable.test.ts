// Golden tests for "I need to force myself to understand what he wants to tell me"
// (Coach, v1.4.1379). The user's real messages run through think() with a stub
// model and made-up data; every reply must read easily: the answer first, short
// whole sentences, no shorthand ("Coffee in", "Next real thing"), no app words
// ("block", "window", "v2"), times as "at 15:00 (in 48 min)".
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld } from './benEval'
import { setSetting } from '../main/settings'
import { PLANNER_VERSION, RHYTHM } from '@core/rhythm'
import { atIn, daySoFar, plainTidy, readability, sentences } from '@core/benPlain'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.useRealTimers())

const sat = (h: number, m: number) => new Date(2026, 10, 7, h, m)
const at = (h: number, m: number) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(sat(h, m))
}
const stub = (reply: (prompt: string) => object = () => ({ reply: 'OK.' })) => {
  const prompts: string[] = []
  const model = async (prompt: string) => {
    prompts.push(prompt)
    return JSON.stringify({ remember: [], actions: [], ...reply(prompt) })
  }
  return { model, prompts }
}
const block = (title: string, start: string, minutes: number, extra: object = {}) => ({ title, start, minutes, ...extra })
async function setPlan(world: Awaited<ReturnType<typeof evalWorld>>, blocks: object[], mustdos = ['Lab report']) {
  await world.mirror.write((db: any) =>
    setSetting(db, RHYTHM, JSON.stringify({ day: world.today, water: [], briefing: { status: 'approved', sentAt: new Date().toISOString(), version: 3, planner: PLANNER_VERSION, plan: { day: world.today, headline: 'Saturday', mustdos, blocks, training: null, waterMl: 2500 } } }))
  )
}

/** Easy to read: short sentences, no shorthand, no app words. */
function expectReadable(reply: string, maxWords = 18) {
  const r = readability(reply)
  expect(r.shorthand, reply).toEqual([])
  expect(r.jargon, reply).toEqual([])
  expect(r.longest, reply).toBeLessThanOrEqual(maxWords)
}

describe("Ben's replies read easily (the user's real messages)", () => {
  it('"just drunk a cup of coffee": the answer first, whole sentences', async () => {
    at(14, 2)
    const s = stub(() => ({ reply: 'Coffee in, room nearly done — good.' }))
    const world = await evalWorld(SQL, s.model)
    const r = await world.bots.think('just drunk a cup of coffee', 'r1')
    expect(s.prompts).toHaveLength(0)
    expect(sentences(r.reply)[0]).toMatch(/^☕ Logged your first coffee today\.$/)
    expectReadable(r.reply)
  })

  it('"how is my day going?" at 18:55: a summary from the numbers in code, no model, instant', async () => {
    at(9, 0)
    const s = stub(() => ({ reply: 'Should not be asked.' }))
    const world = await evalWorld(SQL, s.model)
    await world.services.write((x: any) => {
      x.focus.setPlan(['Lab report', 'Algebra', 'CV'])
      x.focus.togglePlan(0)
      x.focus.add('Study Harness Engineering', 50)
    })
    await setPlan(world, [block('Lab report', '09:00', 60, { tasks: ['Lab report'], done: ['Lab report'] }), block('Study Harness Engineering', '17:25', 50), block('Algebra', '18:00', 30), block('CV update', '19:30', 45)], ['Lab report', 'Algebra', 'CV'])
    at(18, 55)
    const t0 = Date.now()
    const r = await world.bots.think('how is my day going?', 'r2')
    expect(s.prompts).toHaveLength(0)
    expect(Date.now() - t0).toBeLessThan(1500)
    const lines = r.reply.split('\n')
    // The verdict first, then one number per line, then what's next and one step.
    expect(lines[0]).toMatch(/^Your day is (going well|going OK|behind)/)
    expect(r.reply).toContain('• Plan: 2 of 4 done, 1 still ahead.')
    expect(r.reply).toContain('• Must-dos: 1 of 3 done. Still open: Algebra.')
    expect(r.reply).toMatch(/• Focus: 50 min/)
    expect(r.reply).toMatch(/• Water: \d\.\d L of \d\.\d L\./)
    expect(r.reply).toContain('Next: CV update at 19:30 (in 35 min).')
    expect(lines.at(-1)).toBe('One step now: 25 min on Algebra.')
    expect(r.buttons?.[0]).toEqual({ label: '▶ 25 min Algebra', do: 'focus:25:Algebra' })
    expectReadable(r.reply)
  })

  it('"what should I focus on right now?": the answer first, the timer end, then the next thing', async () => {
    at(17, 25)
    const world = await evalWorld(SQL, stub().model)
    await world.services.write((x: any) => x.focus.start('Study Harness Engineering', 50))
    await setPlan(world, [block('Study Harness Engineering', '17:25', 50), block('CV update', '18:30', 45)])
    at(18, 11)
    const r = await world.bots.think('what should I focus on right now?', 'r3')
    expect(sentences(r.reply)[0]).toBe('🎯 Focus on Study Harness Engineering for now.')
    expect(r.reply).toContain('Next: CV update at 18:30 (in 19 min).')
    expectReadable(r.reply)
  })

  it('"now I am going to clean up the room": one point per line, one step with a button', async () => {
    at(13, 43)
    const world = await evalWorld(SQL, stub().model)
    await setPlan(world, [block('Etica lab', '13:45', 45), block('Clean room', '14:30', 45)])
    const r = await world.bots.think('now I am going to clean up the room', 'r4')
    expect(r.reply.split('\n')).toHaveLength(3)
    expect(r.reply.split('\n')[0]).toBe('Good, clean up the room now.')
    expect(r.buttons?.[0].do).toBe('focus:45:Clean room')
    expectReadable(r.reply)
  })

  it('the model path: the screenshot reply is tidied (app words out, one sentence per line) and grounded', async () => {
    at(14, 12)
    const s = stub(() => ({ reply: "Coffee in, room nearly done — good. Next real thing is the lab block at 15:00, 48 min away, and you've got 14:30–15:00 free before it." }))
    const world = await evalWorld(SQL, s.model)
    const r = await world.bots.think('back from the kitchen', 'r5')
    // The prompt carries the plain-writing rules.
    expect(s.prompts.at(-1)).toContain('Start with the direct answer')
    expect(s.prompts.at(-1)).toContain('at 15:00 (in 48 min)')
    expect(r.reply).not.toMatch(/nearly done|block|min away|Next real thing/)
  })
})

describe('plain helpers', () => {
  it('times read "at 15:00 (in 48 min)"', () => {
    expect(atIn('15:00', sat(14, 12))).toBe('at 15:00 (in 48 min)')
    expect(atIn('19:30', sat(18, 0))).toBe('at 19:30 (in 1 h 30 min)')
    expect(atIn('09:00', sat(10, 0))).toBe('at 09:00')
  })
  it('readability flags the screenshot reply and passes the plain one', () => {
    const bad = readability("Coffee in, room nearly done — good. Next real thing is the lab block at 15:00, 48 min away, and you've got 14:30–15:00 free before it.")
    expect(bad.shorthand.length).toBeGreaterThan(1)
    expect(bad.jargon).toEqual(['block'])
    expect(bad.longest).toBeGreaterThan(18)
    const good = readability('Coffee logged.\nNext is the lab at 15:00 (in 48 min).\nYou are free from 14:30 to 15:00.')
    expect(good).toEqual({ longest: 9, shorthand: [], jargon: [] })
  })
  it('plainTidy takes app words out and puts 3+ sentences on their own lines; planner titles stay', () => {
    expect(plainTidy('The lab block is at 15:00. You have a free window before it. Eat first.')).toBe('The lab is at 15:00.\nYou have free time before it.\nEat first.')
    expect(plainTidy("Here's the plan (v2). Deep block 1 starts at 09:00.")).toBe("Here's the plan. Deep block 1 starts at 09:00.")
  })
  it('daySoFar with nothing logged says so and offers to plan', () => {
    const r = daySoFar({ planDone: 0, planTotal: 0, planAhead: 0, focusMin: 0, focusGoal: 0, waterMl: 0, waterTarget: 0, mustDone: 0, mustTotal: 0, nextMust: null, next: null, running: null }, sat(10, 0))
    expect(r.reply.split('\n')[0]).toBe("I don't have much logged today yet.")
    expect(r.chips).toContain('Plan my day')
  })
})

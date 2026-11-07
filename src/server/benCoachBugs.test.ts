// Golden tests for the Coach bugs from real use (Saturday 7 Nov 2026). Each case
// uses the exact message, a stub model and made-up data, and each think() call
// runs at its own pinned moment. What is checked: the corrected behaviour, and
// that Ben names no time, event or progress that isn't in his data.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld } from './benEval'
import { readSetting, setSetting } from '../main/settings'
import { PLANNER_VERSION, RHYTHM } from '@core/rhythm'
import { REPLACE_ASK, liveHeadline, planSummary } from '@core/benPlanText'
import { groundReply, ungrounded } from '@core/benGround'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.useRealTimers())

/** Saturday 7 November 2026 at hh:mm (local). */
const sat = (h: number, m: number) => new Date(2026, 10, 7, h, m)
const at = (h: number, m: number) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(sat(h, m))
}

/** A stub model: records every call and answers `reply(prompt)`. */
const stub = (reply: (prompt: string) => object = () => ({ reply: 'OK.' })) => {
  const prompts: string[] = []
  const model = async (prompt: string) => {
    prompts.push(prompt)
    return JSON.stringify({ remember: [], actions: [], ...reply(prompt) })
  }
  return { model, prompts }
}

const block = (title: string, start: string, minutes: number, extra: object = {}) => ({ title, start, minutes, ...extra })
async function setPlan(world: Awaited<ReturnType<typeof evalWorld>>, status: 'proposed' | 'approved', blocks: object[], o: { version?: number; headline?: string; mustdos?: string[] } = {}) {
  await world.mirror.write((db: any) =>
    setSetting(db, RHYTHM, JSON.stringify({ day: world.today, water: [], briefing: { status, sentAt: new Date().toISOString(), version: o.version ?? 1, planner: PLANNER_VERSION, plan: { day: world.today, headline: o.headline ?? 'Saturday', mustdos: o.mustdos ?? ['Lab report'], blocks, training: null, waterMl: 2500 } } }))
  )
}
const briefing = (world: Awaited<ReturnType<typeof evalWorld>>): Promise<any> => world.mirror.read((db: any) => (readSetting(db, RHYTHM) as any)?.briefing)

describe('Coach bugs from Saturday', () => {
  it('2. "What should I focus on right now?" at 18:11 uses the running timer and the real next item, no model', async () => {
    at(17, 25)
    const s = stub(() => ({ reply: 'Finish up the session at 18:15. After that, you have until 19:50 before the next meeting… CV or crypto project.' }))
    const world = await evalWorld(SQL, s.model)
    await world.services.write((x: any) => x.focus.start('Study Harness Engineering', 50))
    await setPlan(world, 'approved', [block('Study Harness Engineering', '17:25', 50), block('CV update', '18:30', 45)])
    at(18, 11)
    const r = await world.bots.think('What should I focus on right now?', 'bug2')
    expect(s.prompts).toHaveLength(0)
    expect(r.reply).toBe('🎯 Focus on Study Harness Engineering for now.\nYour timer ends at 18:15 (4 min left).\nNext: CV update at 18:30 (in 19 min).')
    expect(r.reply).not.toMatch(/meeting|19:50/)
  })

  it('2b. the model path: a made-up "meeting" and time are taken out; the timer end is in its context', async () => {
    at(17, 25)
    const s = stub(() => ({ reply: "Finish up the session at 18:15. After that, you have until 19:50 before the next meeting… CV or crypto project. Don't burn out before the evening." }))
    const world = await evalWorld(SQL, s.model)
    await world.services.write((x: any) => x.focus.start('Study Harness Engineering', 50))
    at(18, 11)
    const r = await world.bots.think('so honestly which one matters more tonight, cv or crypto?', 'bug2b')
    expect(s.prompts.at(-1)).toContain('RUNNING now on "Study Harness Engineering" (50 min planned, ends 18:15, 4 min left)')
    expect(r.reply).toContain('Finish up the session at 18:15.')
    expect(r.reply).not.toMatch(/19:50|meeting/)
    // The real next event (Gym 19:00 in the made-up calendar) would have been allowed.
    expect(ungrounded('Gym is at 19:00.', { facts: s.prompts.at(-1)!, said: '', now: sat(18, 11) }).times).toEqual([])
  })

  it('3. "create a new plan" while a plan is approved: asks first, then a new version keeps done and pinned blocks', async () => {
    at(12, 37)
    const s = stub()
    const world = await evalWorld(SQL, s.model)
    const blocks = [block('Lab report', '09:00', 60, { tasks: ['Lab report'], done: ['Lab report'] }), block('Algebra', '13:00', 50, { locked: true }), block('CV update', '15:00', 45), block('Reading', '17:00', 30), block('Crypto project', '18:00', 60)]
    await setPlan(world, 'approved', blocks, { version: 15, headline: '3 must-dos · 8 blocks · 6h10 · gym 19:00', mustdos: ['Lab report', 'Algebra', 'CV'] })
    const r = await world.bots.think('create a new plan', 'bug3')
    expect(s.prompts).toHaveLength(0)
    expect(r.reply).toBe(REPLACE_ASK)
    expect(r.chips).toEqual(['Yes, replace it', 'No, keep it'])
    expect((await briefing(world)).version).toBe(15)
    expect((await briefing(world)).status).toBe('approved')
    // The card's headline no longer says "8 blocks · 6h10" for a 5-block, 4h05 plan; the card counts are the live ones.
    const p = (await briefing(world)).plan
    expect(liveHeadline(p.headline, p)).toBe('3 must-dos · gym 19:00')
    expect(planSummary(p)).toMatchObject({ blocks: 5, focusMin: 245, mustdos: 3 })
    at(12, 38)
    const y = await world.bots.think('Yes, replace it', 'bug3:yes')
    expect(y.reply).toMatch(/^Here's a new plan for the rest of today, from 12:38\.\nIt has \d+ sessions?, .* of focus/)
    expect(y.show).toContain('plan')
    const after = await briefing(world)
    expect(after.version).toBe(16)
    expect(after.status).toBe('approved')
    // Done and pinned blocks stay where they were.
    expect(after.plan.blocks.find((b: any) => b.title === 'Lab report')?.start).toBe('09:00')
    expect(after.plan.blocks.find((b: any) => b.title === 'Algebra')?.start).toBe('13:00')
    // The chat line's numbers are the card's numbers.
    expect(y.reply).toContain(planSummary(after.plan).text)
  })

  it('3b. a new plan (nothing approved): the chat line has the card numbers and no version', async () => {
    at(12, 37)
    const s = stub(() => ({ reply: '{}' }))
    const world = await evalWorld(SQL, s.model)
    await setPlan(world, 'proposed', [block('Lab report', '10:00', 60)], { version: 1 })
    const r = await world.bots.think('create a new plan', 'bug3b')
    const b = await briefing(world)
    expect(b.version).toBe(2)
    expect(r.reply).not.toMatch(/\(v\d+\)/)
    expect(r.reply).toContain(planSummary(b.plan).text)
  })

  it('3c. "No, keep it" keeps the approved plan as it is', async () => {
    at(12, 37)
    const world = await evalWorld(SQL, stub().model)
    await setPlan(world, 'approved', [block('CV update', '15:00', 45)], { version: 4 })
    await world.bots.think('create a new plan', 'bug3c')
    at(12, 38)
    const r = await world.bots.think('No, keep it', 'bug3c:no')
    expect(r.reply).toBe('OK, the approved plan stays as it is.')
    expect((await briefing(world)).version).toBe(4)
  })

  it('4. "now I am going to clean up the room": Start / Later, not a retelling of the plan', async () => {
    at(13, 43)
    const s = stub(() => ({ reply: "Room's on the plan at 13:45–14:30, right after the etica lab block that starts in 2 min." }))
    const world = await evalWorld(SQL, s.model)
    await setPlan(world, 'approved', [block('Etica lab', '13:45', 45), block('Clean room', '14:30', 45)])
    const r = await world.bots.think('now I am going to clean up the room', 'bug4')
    expect(s.prompts).toHaveLength(0)
    expect(r.reply).toBe('Good, clean up the room now.\nIt was on your plan for 14:30–15:15, so it moves up to now.\nStart a 45-min timer so it counts?')
    expect(r.buttons).toEqual([{ label: '▶ Start 45 min Clean room', do: 'focus:45:Clean room' }])
    expect(r.chips).toEqual(['Later'])
  })

  it('4b. a timer already running: offers to switch', async () => {
    at(13, 30)
    const world = await evalWorld(SQL, stub().model)
    await world.services.write((x: any) => x.focus.start('Etica', 30))
    at(13, 43)
    const r = await world.bots.think("I'm starting the room now", 'bug4b')
    expect(r.reply).toMatch(/^You have "Etica" running \(17 min left\)\.\nSwitch to the room now\?/)
    expect(r.buttons?.map((b) => b.do)).toEqual(['say:stop', 'focus:25:Room'])
  })

  it('5. "just drunk a cup of coffee": logged as caffeine, no guess about the room', async () => {
    at(14, 2)
    const s = stub(() => ({ reply: 'Coffee in, room nearly done — good.' }))
    const world = await evalWorld(SQL, s.model)
    const r = await world.bots.think('just drunk a cup of coffee', 'bug5')
    expect(s.prompts).toHaveLength(0)
    expect(r.reply).toMatch(/^☕ Logged your first coffee today\.\n/)
    expect(r.reply).not.toMatch(/room/i)
  })

  it('5b. the model claims progress it has no data for: that part is taken out', async () => {
    at(14, 5)
    const s = stub(() => ({ reply: 'Coffee in, room nearly done — good. Etica next.' }))
    const world = await evalWorld(SQL, s.model)
    const r = await world.bots.think('back from the kitchen', 'bug5b')
    expect(r.reply).not.toMatch(/nearly done/)
    expect(r.reply).toContain('Etica next.')
  })
})

describe('Ben names nothing that is not in his data (guard)', () => {
  const g = { facts: 'RIGHT NOW (18:11): nothing in his calendar; next: "Gym" at 19:00 (in 49 min).', said: 'what now?', now: sat(18, 11) }
  it('drops a sentence with a made-up time or meeting, keeps the rest', () => {
    expect(groundReply('Gym at 19:00. Your meeting at 19:50 comes first.', g)).toEqual({ reply: 'Gym at 19:00.', dropped: ['Your meeting at 19:50 comes first.'] })
  })
  it('a meeting that is in the calendar is fine, so is the time now', () => {
    expect(groundReply('Team meeting at 19:00, it is 18:11 now.', { ...g, facts: g.facts.replace('Gym', 'Team meeting') }).dropped).toEqual([])
  })
  it('when every sentence is made up, only the made-up parts go', () => {
    expect(groundReply('You have until 19:50 before the next meeting.', g).reply).toBe('You have.')
  })
  it('progress he said himself is fine', () => {
    expect(groundReply('Room nearly done, nice.', { ...g, said: 'room is almost done' }).dropped).toEqual([])
  })
})

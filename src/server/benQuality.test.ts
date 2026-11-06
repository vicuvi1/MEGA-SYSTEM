// BQ: "Ben quality" on a stub model (no AI calls, made-up data): what reaches
// his prompt (the clock in words, what he already said, the typo-fixed
// message, the language and "no" rules, the plan's B-numbers) and what the
// code does with his answer (cards, chips, honest results, Undo).
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld, traceOf } from './benEval'
import { readSetting } from '../main/settings'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.useRealTimers())

/** A stub model: remembers every prompt and answers with `reply(prompt)`. */
const stub = (reply: (prompt: string) => object) => {
  const prompts: string[] = []
  const model = async (prompt: string) => {
    prompts.push(prompt)
    return JSON.stringify({ remember: [], actions: [], ...reply(prompt) })
  }
  return { model, prompts, last: () => prompts[prompts.length - 1] ?? '' }
}

const LECTURES = [
  { role: 'me' as const, text: 'slept 4h lol' },
  { role: 'coach' as const, text: "😤 Look, Victor, you can't build a company on 4 hours of sleep." },
  { role: 'me' as const, text: 'ok. what about lunch' },
  { role: 'coach' as const, text: '😤 Look, Victor, eat, then sleep early tonight.' },
  { role: 'me' as const, text: 'gym later?' },
  { role: 'coach' as const, text: '😤 Look, Victor, gym yes, but sleep comes first.' }
]

describe('Ben quality: the prompt', () => {
  it('after midnight he gets the clock in words: 07:00 is this morning, in 6 h 29 min', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 7, 0, 31))
    const s = stub(() => ({ reply: 'Bed now: the 07:00 block is in 6.5 h.' }))
    const { bots } = await evalWorld(SQL, s.model)
    await bots.think('when is my first block tomorrow morning?', 'q:night')
    const p = s.last()
    expect(p).toContain('It is AFTER MIDNIGHT')
    expect(p).toContain('07:00 is in 6 h 29 min, this morning')
    expect(p).toMatch(/never "tomorrow morning"/)
    expect(p).toContain('Calendar for THIS MORNING')
  })

  it('lists what he already said, and the stub that obeys it stops lecturing', async () => {
    const s = stub((p) => ({ reply: /Already said[\s\S]*sleep \(3×\)/.test(p) ? 'Split it: intro, method, results.' : "😤 Look, Victor, sleep." }))
    const { bots } = await evalWorld(SQL, s.model, { chat: LECTURES })
    const r = await bots.think('how do I split the lab report?', 'q:repeat')
    expect(s.last()).toMatch(/Points you already made: sleep \(3×\)/)
    expect(s.last()).toMatch(/How your last replies started: "Look, Victor"/)
    expect(s.last()).toMatch(/Emoji you used lately: 😤/)
    expect(s.last()).toContain('Answer HIS message first, in 1–3 sentences')
    expect(r.reply).toBe('Split it: intro, method, results.')
  })

  it('a "Look, Victor," opener and extra emoji are taken out in code', async () => {
    const s = stub(() => ({ reply: '😤 Look, Victor, ship the fix first 🔥🔥' }))
    const { bots } = await evalWorld(SQL, s.model, { chat: LECTURES })
    const r = await bots.think('should I ship the fix tonight?', 'q:tidy')
    expect(r.reply).toBe('Ship the fix first')
  })

  it('typos and mixed languages: he sees what was meant and answers in the language used', async () => {
    const s = stub(() => ({ reply: 'Ok.' }))
    const { bots } = await evalWorld(SQL, s.model)
    await bots.think('waht shuold i do tommorow', 'q:typo')
    expect(s.last()).toContain('Read his message as: "what shuold i do tomorrow"')
    expect(s.last()).toContain('Reply in the language his message is written in')
    expect(s.last()).toMatch(/mixes English, Romanian and Russian/)
  })

  it('after a no he stops pushing', async () => {
    const s = stub(() => ({ reply: 'OK, your call.' }))
    const { bots } = await evalWorld(SQL, s.model)
    await bots.think('no', 'q:no')
    expect(s.last()).toContain('He just said NO')
  })

  it('unsure: the prompt asks for 2–3 chip guesses instead of a wrong guess', async () => {
    const s = stub(() => ({ reply: 'Plan or calendar?', chips: ['Show the plan', 'Show my day'] }))
    const { bots } = await evalWorld(SQL, s.model)
    const r = await bots.think('the thing from before', 'q:unsure')
    expect(s.last()).toMatch(/make the chips your 2–3 best guesses/)
    expect(r.chips).toEqual(['Show the plan', 'Show my day'])
  })
})

describe('Ben quality: show, act, confirm', () => {
  it('"how can I approve the plan if I don\'t see it": the plan card, Approve and Change, plan blocks as B-numbers', async () => {
    const s = stub(() => ({ reply: 'Here it is.' }))
    const { bots, log } = await evalWorld(SQL, s.model, { plan: true })
    const r = await bots.think('how can i aporve the paln if i dont see it haha', 'q:plan')
    expect(s.last()).toContain('B1 10:00–11:30 Lab report')
    expect(s.last()).toContain("SHOW, DON'T TELL")
    const t = traceOf(log, r)
    expect(t).toMatch(/SHOW: plan/)
    expect(t).toMatch(/BUTTONS: approve, change/)
  })

  it('"show me my day" and "what are my tasks": the day and task cards carry the real items', async () => {
    const s = stub(() => ({ reply: 'Here.' }))
    const { bots } = await evalWorld(SQL, s.model)
    const day = await bots.think('show me my day', 'q:day')
    expect(day.show).toContain('day')
    expect(day.cards?.day?.map((e) => e.title)).toEqual(['Deep block', 'Lab: Programming', 'Gym', 'Reading'])
    const tasks = await bots.think('what are my tasks today?', 'q:tasks')
    expect(tasks.show).toContain('tasks')
    expect(tasks.cards?.tasks?.map((t) => t.text)).toEqual(['etica', 'sport', 'laborator 4 PC'])
  })

  it('a plan block renamed by the model: the real result with Undo, and Undo puts it back', async () => {
    const s = stub(() => ({ reply: 'Swapped.', actions: ['rename: B1 | App dev'] }))
    const { bots, mirror } = await evalWorld(SQL, s.model, { plan: true })
    const r = await bots.think('make the lab report slot app dev instead', 'q:planrename')
    expect(r.done).toEqual(['✏️ Renamed: Lab report (10:00–11:30) → App dev'])
    expect(r.undo?.[0]).toMatchObject({ k: 'planblock', title: 'Lab report' })
    const titles = async () => mirror.read((db) => (readSetting(db as any, 'coach_rhythm') as any).briefing.plan.blocks.map((b: any) => b.title))
    expect(await titles()).toEqual(['App dev', 'Study algebra'])
    const u = await bots.undoReply(r.at!)
    expect(u.lines[0]).toMatch(/back to Lab report/)
    expect(await titles()).toEqual(['Lab report', 'Study algebra'])
  })

  it('a calendar rename can be undone; a move can be undone too', async () => {
    const s = stub(() => ({ reply: 'x' }))
    const { bots, log } = await evalWorld(SQL, s.model)
    const r = await bots.think('rename the gym block to football', 'q:rename')
    expect(r.reply).toBe('Done.')
    expect(s.prompts.length).toBe(0)
    await bots.undoReply(r.at!)
    expect(log).toContain('calendar.update g3 title=Gym')
    const m = await bots.think('move the reading block to 22', 'q:move')
    expect(m.done[0]).toMatch(/Moved: Reading/)
    await bots.undoReply(m.at!)
    expect(log.some((l) => /^calendar\.move g4 .*T21:00/.test(l))).toBe(true)
  })

  it('two deep blocks: chips, then "first one" acts; the reply is in his language', async () => {
    // A morning clock: once the 09:00 block has ended Ben (rightly) offers only the 14:00 one.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 6, 7, 30))
    const s = stub(() => ({ reply: 'x' }))
    const { bots, log } = await evalWorld(SQL, s.model, { extraEvents: [{ title: 'Deep block 2', h: 14 }] })
    const ask = await bots.think('schimbă deep blocul în app', 'q:ro1')
    expect(ask.chips).toEqual(['Deep block · 09:00', 'Deep block 2 · 14:00'])
    expect(ask.reply).toBe('Se potrivesc 2 blocuri. Care?')
    expect(log.filter((l) => l.startsWith('calendar.update'))).toEqual([])
    const done = await bots.think('al doilea', 'q:ro2')
    expect(log).toContain('calendar.update x1 title=App')
    expect(done.reply).toBe('Gata.')
  })

  it('a reply that claims a change with no action says plainly nothing changed', async () => {
    const s = stub(() => ({ reply: "I'll swap Deep Block 1 to App Dev." }))
    const { bots } = await evalWorld(SQL, s.model)
    const r = await bots.think('the first one would be better as app dev i guess', 'q:claim')
    expect(r.done).toEqual([])
    expect(r.reply).toMatch(/Nothing is changed yet/)
    expect(r.chips?.[0]).toBe('Do it')
  })
})

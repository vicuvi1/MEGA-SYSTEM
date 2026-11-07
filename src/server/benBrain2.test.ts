// Golden tests, "Ben understands you and remembers" (LS2–LS6, ME1–ME5, TL1,
// TL2, TL5), in the benQuality style: a stub model on throwaway data (made-up
// tasks, events and people), every think call at its own pinned moment.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld, traceOf } from './benEval'
import { readSetting } from '../main/settings'
import { knowView, loadConvo, loadKnow } from '../renderer/src/web/benMind'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.useRealTimers())

/** A stub model: remembers every prompt (and its kind) and answers with `reply(prompt, kind)`. */
const stub = (reply: (prompt: string, kind: string) => object | string = () => ({ reply: 'Ok.' })) => {
  const prompts: { p: string; kind: string }[] = []
  const model = async (p: string, opts?: { kind?: string }) => {
    const kind = opts?.kind ?? 'chat'
    prompts.push({ p, kind })
    const r = reply(p, kind)
    return typeof r === 'string' ? r : JSON.stringify({ remember: [], actions: [], ...r })
  }
  return { model: model as any, prompts, chats: () => prompts.filter((x) => x.kind !== 'breakdown'), last: () => prompts[prompts.length - 1]?.p ?? '' }
}
/** Each think call gets its own moment (Nov 7 2026, a Saturday). */
const at = (h: number, m = 0, d = 7) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, d, h, m))
}

describe('LS2 + LS4: several things in one message, one receipt, one Undo all', () => {
  it('"add laundry, move gym to 18, and remind me to call mom at 20": all three in code, in order, no model call', async () => {
    at(10)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think('add laundry, move gym to 18, and remind me to call mom at 20', 'g:multi')
    expect(s.chats()).toHaveLength(0)
    const t = traceOf(w.log, r)
    expect(t).toMatch(/todoist\.quickAdd Laundry/)
    expect(t).toMatch(/calendar\.move g3 2026-11-07T18:00/)
    expect(t).toMatch(/⏰ Reminder 20:00: Call mom/)
    expect(r.receipt).toBe("Added 'Laundry' · Todoist ✓; Moved 'Gym' at 18:00 · Calendar ✓; Reminder 'Call mom' at 20:00 · Reminders ✓")
    expect(r.undo?.filter(Boolean)).toHaveLength(3)
    // One Undo takes all of it back.
    at(10, 1)
    const u = await w.bots.undoReply(r.at!)
    expect(u.ok).toBe(true)
    expect(w.log.join('\n')).toMatch(/todoist\.remove t9/)
    expect(w.log.join('\n')).toMatch(/calendar\.move g3 2026-11-07T19:00/)
    const list = await w.mirror.read((db: any) => readSetting(db, 'coach_reminders') as any[])
    expect(list).toHaveLength(0)
  })

  it('a clause code can\'t read sends the whole message to the model, as before', async () => {
    at(10)
    const s = stub(() => ({ reply: 'Both done.', actions: [] }))
    const w = await evalWorld(SQL, s.model)
    await w.bots.think('add laundry and think about my life choices', 'g:multi-model')
    expect(s.chats().length).toBeGreaterThan(0)
  })

  it('a model action gets the receipt too (web log and the result)', async () => {
    at(10)
    const s = stub(() => ({ reply: 'Booked.', actions: ['event: Read 10 min | 2026-11-07 21:40 | 10', 'task: Read 10 min today'] }))
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think('book read 10 min at 21:40 and put it in todoist', 'g:receipt')
    expect(r.receipt).toBe("Added 'Read 10 min' at 21:40 · Calendar ✓ Todoist ✓")
    const log = await w.mirror.read((db: any) => readSetting(db, 'coach_log') as any[])
    expect(log[log.length - 1].receipt).toBe(r.receipt)
  })
})

describe('LS3: messy typing (Romanian, Russian, slang, no diacritics)', () => {
  it('"fa-mi ziua" makes the day plan, like "plan my day"', async () => {
    at(9)
    const s = stub((p) => (/name and rank|Name each block/i.test(p) ? '{}' : { reply: 'Ok.' }))
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think('fa-mi ziua', 'g:ro-plan')
    expect(r.show).toContain('plan')
    expect(r.reply).toMatch(/today's plan/)
  })

  it('"curata camera azi" adds the task for today; "завтра спортзал в 18" books gym tomorrow 18:00 (calendar and Todoist)', async () => {
    at(11)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const a = await w.bots.think('curata camera azi', 'g:ro-add')
    expect(w.log.join('\n')).toMatch(/todoist\.quickAdd Curata camera today/)
    expect(a.receipt).toMatch(/^Added 'Curata camera/)
    at(11, 5)
    const b = await w.bots.think('завтра спортзал в 18', 'g:ru-add')
    expect(w.log.join('\n')).toMatch(/calendar\.create Gym 2026-11-08T18:00 → 2026-11-08T19:00/)
    expect(w.log.join('\n')).toMatch(/todoist\.quickAdd Gym tomorrow 18:00/)
    expect(b.receipt).toMatch(/Added 'Gym' tomorrow at 18:00 · Calendar ✓ Todoist ✓/)
    expect(s.chats()).toHaveLength(0)
  })

  it('a move typed in Romanian with no diacritics finds the block ("muta sala la 18")', async () => {
    at(10)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    await w.bots.think('muta sala la 18', 'g:ro-move')
    expect(w.log.join('\n')).toMatch(/calendar\.move g3 2026-11-07T18:00/)
  })
})

describe('LS5: one short question instead of a guess', () => {
  it('"remind me to call mom at 8" at 07:00: chips 08:00 / 20:00, nothing changes; the pick sets it', async () => {
    at(7)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const q = await w.bots.think('add water bottle, and remind me to call mom at 8', 'g:ask')
    expect(q.reply).toBe('Call mom: morning or evening?')
    expect(q.chips).toEqual(['08:00', '20:00'])
    expect(q.done).toEqual([])
    expect(w.log).toEqual([])
    at(7, 1)
    const r = await w.bots.think('20:00', 'g:ask-pick')
    expect(r.done.join('\n')).toMatch(/⏰ Reminder 20:00: Call mom/)
    // The rest of the first message runs with the pick.
    expect(w.log.join('\n')).toMatch(/todoist\.quickAdd Water bottle/)
  })

  it('"move gym to 9": 09:00 or 21:00? (no change until he picks)', async () => {
    at(7)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const q = await w.bots.think('move gym to 9', 'g:move-ask')
    expect(q.chips).toEqual(['09:00', '21:00'])
    expect(w.log).toEqual([])
    at(7, 2)
    await w.bots.think('21:00', 'g:move-pick')
    expect(w.log.join('\n')).toMatch(/calendar\.move g3 2026-11-07T21:00/)
  })
})

describe('LS6: corrections are remembered and used next time', () => {
  it('"no, curata camera takes 40 min" and "gym is always at 18" are saved (with Undo) and used by the next adds', async () => {
    at(10)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const a = await w.bots.think('no, curata camera takes 40 min', 'g:dur')
    expect(a.done).toEqual(['📌 Remembered: curata camera takes 40 min'])
    expect(a.undo?.[0]).toMatchObject({ k: 'know' })
    at(10, 1)
    await w.bots.think('gym is always at 18', 'g:time')
    at(10, 2)
    await w.bots.think('add curata camera tomorrow at 10, then add gym tomorrow', 'g:use')
    const log = w.log.join('\n')
    expect(log).toMatch(/calendar\.create Curata camera 2026-11-08T10:00 → 2026-11-08T10:40/)
    expect(log).toMatch(/calendar\.create Gym 2026-11-08T18:00/)
    expect(s.chats()).toHaveLength(0)
    // Undo forgets the duration again.
    at(10, 3)
    await w.bots.undoReply(a.at!)
    const k = await w.mirror.read((db: any) => loadKnow(db))
    expect(k.prefs.map((p) => p.kind)).toEqual(['time'])
  })
})

describe('ME1: a memory he can see and change', () => {
  it('"my shift is 17-24": Ben asks first; No saves nothing; Yes saves it with its source and sets My life', async () => {
    at(12)
    const s = stub(() => ({ reply: 'Long evenings.' }))
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think('my shift is 17-24', 'g:offer')
    expect(r.reply).toBe('Long evenings. Remember that your shift is 17:00–24:00?')
    expect(r.buttons?.map((b) => b.label)).toEqual(['✅ Yes, remember', 'No'])
    let v = await w.mirror.read((db: any) => knowView(db))
    expect(v.items.some((x) => /shift/.test(x.text))).toBe(false)
    expect(v.offers).toHaveLength(1)
    at(12, 1)
    const yes = await w.bots.think(r.buttons![0].do.replace(/^say:/, ''), 'g:offer-yes')
    expect(yes.done[0]).toMatch(/📌 Remembered: Your shift is 17:00–24:00 \(also in My life\)/)
    v = await w.mirror.read((db: any) => knowView(db))
    expect(v.items.find((x) => /shift/.test(x.text))).toMatchObject({ source: 'Chat in the app', kind: 'fact' })
    const fit = await w.mirror.read((db: any) => readSetting(db, 'life_fit') as any)
    expect(fit.work).toMatchObject({ on: true, from: '17:00', to: '24:00' })
  })

  it('a fact the model only guessed waits as an offer; "remember that …" is saved at once', async () => {
    at(12)
    const s = stub((p) => ({ reply: 'Ok.', remember: [/Victor's message: remember/.test(p) ? 'Etica exam on Friday' : 'Likes night runs'] }))
    const w = await evalWorld(SQL, s.model)
    await w.bots.think('ran 5k at 23:00 again haha', 'g:guess')
    let mem = await w.mirror.read((db: any) => readSetting(db, 'coach_memory') as any)
    expect((mem?.facts ?? []).length).toBe(0)
    expect((await w.mirror.read((db: any) => loadKnow(db))).offers.map((o) => o.text)).toEqual(['Likes night runs'])
    at(12, 1)
    await w.bots.think('remember that the etica exam is on friday', 'g:explicit')
    mem = await w.mirror.read((db: any) => readSetting(db, 'coach_memory') as any)
    expect(mem.facts.map((f: any) => f.t)).toEqual(['Etica exam on Friday'])
  })

  it('"forget everything about Ana" clears facts, people and offers about her', async () => {
    at(12)
    const s = stub()
    const w = await evalWorld(SQL, s.model, { facts: ['His sister is Ana', 'Likes coffee'] })
    const r = await w.bots.think('forget everything about Ana', 'g:forget')
    expect(r.reply).toBe('Done: I forgot 1 thing about Ana.')
    const v = await w.mirror.read((db: any) => knowView(db))
    expect(v.items.map((x) => x.text)).toEqual(['Likes coffee'])
  })

  it('only the memories that fit go into the prompt', async () => {
    at(12)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    await w.bots.think('no, curata camera takes 40 min', 'g:p1')
    at(12, 1)
    await w.bots.think('how should I clean the curata camera faster?', 'g:p2')
    expect(s.last()).toContain('What he told you (use it): curata camera takes 40 min')
    at(12, 2)
    await w.bots.think('what do you think about music?', 'g:p3')
    expect(s.last()).not.toContain('What he told you')
  })
})

describe('ME4: past conversations', () => {
  it('a struggle is kept, and days later Ben gets one short line about it', async () => {
    at(20, 0, 1)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    await w.bots.think('the essay feels so hard, I cant focus on it', 'g:past1')
    const c = await w.mirror.read((db: any) => loadConvo(db))
    expect(c.points.map((p) => p.kind)).toEqual(['struggle'])
    at(10, 0, 7)
    await w.bots.think('should I start the essay now or after lunch?', 'g:past2')
    expect(s.last()).toMatch(/From past chats[^\n]*6 days ago he said \(struggle\): "the essay feels so hard/)
  })
})

describe('ME5: promises', () => {
  it('"I\'ll start the essay tomorrow" is kept as a promise (asked tomorrow at 10:00), the model is told not to add a check-in', async () => {
    at(21, 0, 6)
    const s = stub(() => ({ reply: 'Holding you to it.', actions: ['checkin: 60 | Started the essay?'] }))
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think("I'll start the essay tomorrow", 'g:promise')
    expect(s.last()).toMatch(/He just promised: "start the essay" \(tomorrow\)/)
    expect(r.done).toEqual(["🤝 Promise noted: start the essay · I'll ask tomorrow 10:00"])
    const list = await w.mirror.read((db: any) => readSetting(db, 'coach_reminders') as any[])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'checkin', promise: { what: 'start the essay', when: 'tomorrow' } })
    expect(new Date(list[0].at).getHours()).toBe(10)
    // Done (a button under the follow-up) closes it as kept.
    at(10, 30, 7)
    const d = await w.bots.think(`Promise done (${list[0].id})`, 'g:promise-done')
    expect(d.done).toEqual(['✅ Promise kept: start the essay'])
    const after = await w.mirror.read((db: any) => readSetting(db, 'coach_reminders') as any[])
    expect(after[0].outcome).toBe('kept')
  })
})

describe('TL1: buying a reward and ticking his own habit (honest)', () => {
  it('"buy movie night" buys through the shop (points go, Undo gives them back); the model alone cannot', async () => {
    at(15)
    const s = stub(() => ({ reply: 'Enjoy.', actions: ['buy: Movie nigth'] }))
    const w = await evalWorld(SQL, s.model)
    await w.services.write((sv: any) => {
      for (let i = 0; i < 6; i++) sv.wallet.append({ ts: new Date().toISOString(), day: sv.wallet.today(), module: 'test', kind: 'earn', coins: 50, xp: 50, note: 'made-up points' })
      sv.shop.save({ title: 'Movie night', price: 40, tier: 'bronze', realCost: 0, pinned: false, note: '', currency: 'MDL' })
    })
    const before = await w.services.read((sv: any) => sv.shop.state().balance)
    const r = await w.bots.think('buy movie night', 'g:buy')
    expect(r.done[0]).toMatch(/^🎁 Bought: Movie night · −40 points/)
    expect(await w.services.read((sv: any) => sv.shop.state().balance)).toBe(before - 40)
    at(15, 1)
    await w.bots.undoReply(r.at!)
    expect(await w.services.read((sv: any) => sv.shop.state().balance)).toBe(before)
    // The model asking to buy when he didn't: a confirm button, nothing bought.
    at(15, 2)
    const n = await w.bots.think('what rewards do I have?', 'g:buy-no')
    expect(n.done.join('\n')).not.toMatch(/Bought/)
    expect(await w.services.read((sv: any) => sv.shop.state().balance)).toBe(before)
  })
})

describe('TL2: break big tasks down', () => {
  it("\"break down 'harder sport system implement'\": 3–6 steps with minutes, each a Todoist task, a ▶ button for step 1", async () => {
    at(14)
    const s = stub((_p, kind) => (kind === 'breakdown' ? '{"steps":[{"title":"List what the system must do","minutes":15},{"title":"Sketch the data model","minutes":25},{"title":"Build the first screen","minutes":45},{"title":"Test it with real workouts","minutes":30}]}' : { reply: 'Ok.' }))
    const w = await evalWorld(SQL, s.model)
    const r = await w.bots.think("break down 'harder sport system implement'", 'g:break')
    expect(w.log.filter((l) => l.startsWith('todoist.quickAdd'))).toEqual([
      'todoist.quickAdd harder sport system implement · List what the system must do (15 min)',
      'todoist.quickAdd harder sport system implement · Sketch the data model (25 min)',
      'todoist.quickAdd harder sport system implement · Build the first screen (45 min)',
      'todoist.quickAdd harder sport system implement · Test it with real workouts (30 min)'
    ])
    expect(r.reply).toMatch(/in 4 steps, about 1h 55m in all/)
    expect(r.buttons?.[0].do).toBe('focus:15:List what the system must do')
    expect(r.undo?.filter(Boolean)).toHaveLength(4)
  })
})

describe('TL5: smart reminders', () => {
  it('"after the lab" fires when the lab ends; "when I get home" is honest about what home means', async () => {
    at(11)
    const s = stub()
    const w = await evalWorld(SQL, s.model)
    const a = await w.bots.think('remind me to email the professor after the lab', 'g:after')
    expect(a.done).toEqual(['⏰ Reminder 15:00: email the professor (after Lab: Programming (15:00))'])
    at(11, 1)
    const h = await w.bots.think('remind me to take out the trash when I get home', 'g:home')
    expect(h.reply).toMatch(/PC waking up after 2\+ hours away/)
    const list = await w.mirror.read((db: any) => readSetting(db, 'coach_reminders') as any[])
    expect(list.map((r) => r.when?.kind ?? 'time')).toEqual(['time', 'home'])
    expect(s.chats()).toHaveLength(0)
  })
})

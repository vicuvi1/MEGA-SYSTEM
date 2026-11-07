// A short day with Ben on a stub model (made-up data), each message at its own
// pinned moment: a plan, approve, what now, I'm starting X, I finished X, logs,
// a move, a late plan, what now again. Every reply must name only times and
// events that exist (the made-up calendar, the plan, the clock), and the logs
// and moves must really happen.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { evalWorld } from './benEval'
import { readSetting } from '../main/settings'
import { RHYTHM } from '@core/rhythm'
import { timesIn } from '@core/benGround'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.useRealTimers())

const at = (h: number, m: number) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 7, h, m))
}

describe('Ben self-review: a day of 10 messages', () => {
  it('answers from the data, acts when asked, invents nothing', async () => {
    const prompts: string[] = []
    // The stub answers like a careless model would: it names a "meeting" at 19:50 and claims progress.
    const model = async (prompt: string) => {
      prompts.push(prompt)
      if (/Write the day plan|block names|headline/i.test(prompt) && !/== Victor right now ==/.test(prompt)) return '{}'
      return JSON.stringify({ reply: 'Nice work, the lab report is nearly done. Your meeting at 19:50 is next.', actions: [], remember: [] })
    }
    at(8, 25)
    const world = await evalWorld(SQL, model)
    const plan = (): Promise<any> => world.mirror.read((db: any) => (readSetting(db, RHYTHM) as any)?.briefing)
    const say = async (h: number, m: number, text: string) => {
      at(h, m)
      const r = await world.bots.think(text, `self:${h}:${m}`)
      // Every clock time in a reply exists: the calendar, today's plan, or the time now.
      const b = await plan()
      const known = new Set([
        ...['09:00', '10:00', '13:30', '15:00', '19:00', '20:00', '21:00', '21:30'],
        ...(b?.plan.blocks ?? []).flatMap((x: any) => [x.start, `${String(Math.floor((Number(x.start.slice(0, 2)) * 60 + Number(x.start.slice(3)) + x.minutes) / 60)).padStart(2, '0')}:${String((Number(x.start.slice(3)) + x.minutes) % 60).padStart(2, '0')}`]),
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        ...timesIn(text)
      ])
      const made = timesIn(r.reply).filter((x) => !known.has(x))
      if (process.env.BEN_TRANSCRIPT) require('node:fs').appendFileSync(process.env.BEN_TRANSCRIPT, `${text} => ${r.reply.replace(/\s+/g, ' ')}${r.chips?.length ? ` [chips: ${r.chips.join(' | ')}]` : ''}${r.buttons?.length ? ` [buttons: ${r.buttons.map((b) => b.do).join(', ')}]` : ''}${r.done?.length ? ` [done: ${r.done.join(' ; ')}]` : ''}\n`)
      return { ...r, made }
    }

    const t1 = await say(8, 30, 'plan my day')
    expect(t1.reply).toMatch(/^Here's today's plan, starting at \d\d:\d\d\.\nIt has \d+ sessions?/)
    expect(t1.made).toEqual([])
    // He taps ✅ Approve on the card (the same call the app makes).
    at(8, 31)
    await (world.bots as any).rhythm.approve()
    expect((await plan()).status).toBe('approved')
    const t2 = await say(8, 32, 'ok approved, thanks')
    const t3 = await say(9, 5, 'what now?')
    expect(t3.reply).toMatch(/^🎯/)
    expect(t3.reply).not.toMatch(/meeting|19:50/)
    expect(t3.made).toEqual([])
    const t4 = await say(9, 10, "I'm starting the lab report now")
    expect(t4.buttons?.[0]?.do).toMatch(/^focus:\d+:/)
    expect(t4.chips).toContain('Later')
    const t5 = await say(10, 5, 'I finished the lab report')
    expect(t5.reply).not.toMatch(/meeting|19:50|nearly done/)
    const t6 = await say(10, 6, 'water 500')
    expect(t6.reply).toMatch(/500 ml/)
    const t7 = await say(10, 7, 'just had an espresso')
    expect(t7.reply).toMatch(/^☕ Logged/)
    const t8 = await say(10, 10, 'move gym to 18:00')
    expect(world.log.some((l) => /calendar\.move g3 .*T18:00/.test(l))).toBe(true)
    expect(t8.made).toEqual([])
    const t9 = await say(16, 8, 'plan my day')
    expect(t9.made).toEqual([])
    const t10 = await say(16, 10, 'what should I be doing right now?')
    expect(t10.reply).toMatch(/^🎯/)
    expect(t10.made).toEqual([])
    expect(t10.reply).not.toMatch(/meeting|19:50/)
  }, 30_000)
})

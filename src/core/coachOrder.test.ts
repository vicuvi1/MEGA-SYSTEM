import { describe, expect, it } from 'vitest'
import { inOrder, livePlanAt, orderLog, type OrderEntry } from './coachOrder'
import { buildFeed } from './chatFeed'

type E = OrderEntry & { text: string; show?: string[]; bot?: string; via?: string }
const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m).toISOString()
const plan = (e: E) => !!e.show?.includes('plan') || (!!e.proactive && /your plan for today/i.test(e.text))

describe('Coach chat: true time order', () => {
  it('the morning plan card stays in the morning; new questions and answers go to the bottom', () => {
    // What the owner saw: the plan message drawn after the 15:21 questions.
    const log: E[] = [
      { role: 'coach', proactive: true, text: 'Your plan for today: 3 must-dos. Approve?', at: at(8, 5) },
      { role: 'me', text: 'how much do I sleep on average', at: at(15, 21) },
      { role: 'coach', text: 'On average you sleep 7 h 31 min a night.', at: at(15, 21) },
      { role: 'coach', text: "Here is today's plan.", show: ['plan'], at: at(9, 0) }
    ]
    const o = orderLog(log)
    expect(o.map((x) => x.at)).toEqual([at(8, 5), at(9, 0), at(15, 21), at(15, 21)])
    expect(o[o.length - 1].text).toMatch(/7 h 31 min/)
    // A new question and its answer (the one being written) land at the very bottom.
    const next = orderLog([...o, { role: 'me', text: 'how much I have earned this month?', at: at(15, 22) }, { role: 'coach', text: '', at: at(15, 22), pending: true }])
    expect(next.slice(-2).map((x) => x.role)).toEqual(['me', 'coach'])
    expect(next[next.length - 1].pending).toBe(true)
  })

  it('a reply never goes above its question when the server clock is a little behind', () => {
    const log: E[] = [
      { role: 'me', text: 'what are my tasks today?', at: at(15, 21) },
      { role: 'coach', text: 'Two must-dos are left.', at: new Date(Date.parse(at(15, 21)) - 1500).toISOString() }
    ]
    expect(orderLog(log).map((x) => x.role)).toEqual(['me', 'coach'])
    expect(inOrder(log)).toBe(true)
  })

  it('keeps equal times in their written order and returns the same entries', () => {
    const a: E = { role: 'me', text: 'a', at: at(10) }
    const b: E = { role: 'coach', text: 'b', at: at(10) }
    expect(orderLog([a, b])).toEqual([a, b])
    expect(orderLog([a, b])[0]).toBe(a)
  })
})

describe('Coach chat: one live plan card', () => {
  const dayStart = new Date(2026, 10, 18, 4, 0).getTime()
  it('the newest plan card from today is the live one; older ones are not', () => {
    const log: E[] = [
      { role: 'coach', text: 'Last night draft', show: ['plan'], at: new Date(2026, 10, 17, 22).toISOString() },
      { role: 'coach', proactive: true, text: 'Your plan for today: 3 must-dos.', at: at(8, 5) },
      { role: 'coach', text: "Here is today's plan.", show: ['plan'], at: at(9) },
      { role: 'me', text: 'how much do I sleep', at: at(15, 21) },
      { role: 'coach', text: '7 h 31 min', at: at(15, 21) }
    ]
    expect(livePlanAt(log, dayStart, plan)).toBe(2)
    expect(livePlanAt(log.slice(0, 2), dayStart, plan)).toBe(1)
    // Only last night's draft: nothing is live today.
    expect(livePlanAt(log.slice(0, 1), dayStart, plan)).toBe(-1)
  })

  it("the morning plan message never folds away into '3 earlier updates' (its card is the live plan)", () => {
    const log = [
      { role: 'coach' as const, bot: 'mega', via: 'tg', proactive: true, text: 'Your plan for today: 3 must-dos. Approve?', at: at(8, 5) },
      { role: 'coach' as const, bot: 'mega', via: 'tg', proactive: true, text: '💧 Water: 500 ml so far, drink a glass.', at: at(8, 30) },
      { role: 'coach' as const, bot: 'mega', via: 'tg', proactive: true, text: '💧 Water: 900 ml so far.', at: at(9, 30) }
    ]
    const feed = buildFeed(log, { now: new Date(2026, 10, 18, 15, 30) })
    const shown = feed.filter((x) => x.t === 'msg').map((x) => (x as { i: number }).i)
    expect(shown).toContain(0)
  })
})

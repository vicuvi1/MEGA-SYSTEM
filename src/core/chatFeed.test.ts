import { describe, expect, it } from 'vitest'
import { buildFeed, isSettled, momentChips, nudgeInfo, nudgeKind, partOfDay, readSlash, tagNudge, tidyText, type FeedEntry } from './chatFeed'

const at = (h: number, m = 0, day = 5) => new Date(2026, 10, day, h, m).toISOString()
const ben = (h: number, m: number, text: string): FeedEntry => ({ role: 'coach', text, at: at(h, m), proactive: true })
const me = (h: number, m: number, text: string): FeedEntry => ({ role: 'me', text, at: at(h, m) })
const reply = (h: number, m: number, text: string): FeedEntry => ({ role: 'coach', text, at: at(h, m) })

describe('chat feed (Night 7)', () => {
  it('knows the kinds of Ben nudges', () => {
    expect(nudgeKind('🌅 Your day · 45-min crypto focus first; 20-min sport\nMust-dos\n1. focus\nApprove, change it, or ask for another one.')).toBe('plan')
    expect(nudgeKind('⏳ Your plan for today is still waiting: 45-min crypto focus first.')).toBe('plan')
    expect(nudgeKind('💧 Water 0.3 of 2.7 L and the day is going.')).toBe('water')
    expect(nudgeKind('😐 Lunch check-in: how do you feel right now?')).toBe('mood')
    expect(nudgeKind('🎯 6h 57m since your last thing. Pick anything on your list and give it 10 minutes.')).toBe('idle')
    expect(nudgeKind('📚 🎯 Deep block (afternoon) starts at 14:00 · 100 min · +30 points if you focus.\nStart the timer?')).toBe('block')
    expect(nudgeKind('📅 🎯 Deep block (afternoon) in 9 min\n14:00–15:40')).toBe('calendar')
    expect(nudgeKind('🔗 Yesterday slipped (no focus yesterday).')).toBe('slip')
  })
  it('reads block and calendar details', () => {
    expect(nudgeInfo('📚 🎯 Deep block (afternoon) starts at 14:00 · 100 min · +30 points', 'block')).toEqual({ title: 'Deep block (afternoon)', time: '14:00', minutes: 100 })
    expect(nudgeInfo('📅 🎯 Deep block (afternoon) in 9 min\n14:00–15:40', 'calendar')).toEqual({ title: 'Deep block (afternoon)', time: '14:00', end: '15:40', minutes: 9 })
  })
  it('LT12: a nudge is tagged from its template when it is sent', () => {
    expect(tagNudge('💧 Water 0.3 of 2.7 L and the day is going.')).toEqual({ kind: 'water' })
    expect(tagNudge('📚 🎯 Deep block starts at 14:00 · 100 min · +30 points if you focus.\nStart the timer?')).toEqual({ kind: 'block', info: { title: 'Deep block', time: '14:00', minutes: 100 } })
  })
  it('LT12: the stored kind wins over the words (Ben reworded it); old entries still use the words', () => {
    const reworded: FeedEntry = { ...ben(13, 32, 'Hey, drink something, you are way behind today.'), kind: 'water' }
    const old = ben(13, 34, '💧 Water 0.3 of 2.7 L.')
    const junk = { ...ben(13, 36, '🔗 Yesterday slipped (no focus yesterday).'), kind: 'nonsense' as any }
    const kinds = (log: FeedEntry[]) => (buildFeed(log, { filter: 'raw', now: new Date(at(14)) }).filter((x) => x.t === 'msg') as any[]).map((x) => x.kind)
    expect(kinds([reworded])).toEqual(['water'])
    expect(kinds([old])).toEqual(['water'])
    expect(kinds([junk])).toEqual(['slip'])
    // the stored info is used for a block whose words no longer say the time
    const block: FeedEntry = { ...ben(13, 50, 'Your deep work is up, go!'), kind: 'block', info: { title: 'Deep block', time: '14:00', minutes: 100 } }
    const m = buildFeed([block], { filter: 'raw', now: new Date(at(13, 55)) }).find((x) => x.t === 'msg') as any
    expect(m.info).toEqual({ title: 'Deep block', time: '14:00', minutes: 100 })
    expect(m.settled).toBe(false)
  })
  it('CL5: one icon, the rest is text', () => {
    expect(tidyText('📅 🎯 Deep block in 9 min')).toEqual({ icon: '📅', text: 'Deep block in 9 min' })
    expect(tidyText('Plain words')).toEqual({ icon: null, text: 'Plain words' })
  })
  it('CN3 + CN1: repeats are absorbed, older nudges fold, the latest shows', () => {
    const log = [
      ben(6, 43, '🌅 Your day · 45-min focus\nMust-dos\n1. a\nApprove, change it, or ask for another one.'),
      ben(11, 2, '⏳ Your plan for today is still waiting.'),
      ben(11, 45, '🔗 Yesterday slipped (no focus yesterday).'),
      ben(13, 32, '💧 Water 0.3 of 2.7 L.'),
      ben(13, 34, '🎯 6h 57m since your last thing.')
    ]
    const f = buildFeed(log, { now: new Date(at(13, 40)) })
    const msgs = f.filter((x) => x.t === 'msg')
    expect(msgs.map((x) => (x as any).i)).toEqual([4])
    const plan = f.find((x) => x.t === 'fold' && x.entries.includes(1))
    expect(plan).toBeTruthy()
    // the first plan message is replaced by the later one, which counts it
    expect(f.some((x) => x.t === 'fold' && x.entries.includes(0))).toBe(false)
  })
  it('your conversation stays, with parts of the day and grouping', () => {
    const log = [me(9, 0, 'hi'), reply(9, 0, 'Morning!'), reply(9, 1, 'Plan?'), me(14, 0, 'back')]
    const f = buildFeed(log, { now: new Date(at(15)) })
    expect(f.filter((x) => x.t === 'divider').map((x) => (x as any).label)).toEqual(['Today · Morning', 'Afternoon'])
    const m = f.filter((x) => x.t === 'msg') as any[]
    expect(m.map((x) => x.grouped)).toEqual([false, false, true, false])
  })
  it('CN8: a line where new messages start', () => {
    const log = [me(9, 0, 'hi'), reply(9, 1, 'yo'), ben(12, 0, '💧 Water 0.5 of 2.7 L')]
    const f = buildFeed(log, { now: new Date(at(13)), seenAt: at(10) })
    const k = f.findIndex((x) => x.t === 'new')
    expect(k).toBeGreaterThan(0)
    expect((f[k + 1] as any).i).toBe(2)
  })
  it('CN4: a block settles once its time is past', () => {
    const e = ben(13, 51, '📚 Deep block starts at 14:00 · 100 min.\nStart the timer?')
    const info = nudgeInfo(e.text, 'block')
    expect(isSettled(e, 'block', info, new Date(at(13, 55)))).toBe(false)
    expect(isSettled(e, 'block', info, new Date(at(14, 20)))).toBe(true)
  })
  it('CM5: filters', () => {
    const log = [me(9, 0, 'water 250'), { ...reply(9, 0, 'ok'), done: ['💧 +250 ml'] }, ben(12, 0, '💧 Water 0.5 of 2.7 L')]
    expect(buildFeed(log, { filter: 'talk' }).filter((x) => x.t === 'msg')).toHaveLength(2)
    expect(buildFeed(log, { filter: 'nudges' }).filter((x) => x.t === 'msg')).toHaveLength(1)
    expect(buildFeed(log, { filter: 'logged' }).filter((x) => x.t === 'msg')).toHaveLength(1)
  })
  it('CM3: slash shortcuts', () => {
    expect(readSlash('/water 500')).toBe('water 500')
    expect(readSlash('/water')).toBe('water 250')
    expect(readSlash('/focus 45 algebra')).toBe('Start a 45 minute focus block on algebra.')
    expect(readSlash('/rescue')).toMatch(/Rescue my day/)
    expect(readSlash('hello')).toBeNull()
    expect(readSlash('/nope')).toBeNull()
  })
  it('CM2: chips fit the moment', () => {
    expect(momentChips({ hour: 13, planStatus: 'approved', blockSoon: 'the 14:00 block', mustLeft: 2 })).toEqual(['Start the 14:00 block', "What's left today?", "I'm tired"])
    expect(momentChips({ hour: 8, planStatus: 'none', mustLeft: 0 })[0]).toBe('Plan my day')
    expect(partOfDay(3)).toBe('Night')
  })
  it('BG15: no empty divider for messages inside a fold', () => {
    const log = [ben(11, 0, '💧 Water 0.3 of 2.7 L.'), ben(12, 30, '🎯 3h since your last thing.'), ben(13, 0, '😐 Lunch check-in: how do you feel right now?')]
    const f = buildFeed(log, { now: new Date(at(14)) })
    // Morning has the fold; Afternoon starts with the next shown item, never directly followed by another divider.
    for (let k = 0; k < f.length - 1; k++) expect(f[k].t === 'divider' && f[k + 1].t === 'divider').toBe(false)
    expect(f[f.length - 1].t).toBe('msg')
  })
})

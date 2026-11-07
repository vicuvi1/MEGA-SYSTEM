import { describe, expect, it } from 'vitest'
import { blockFor, meansTimer, readFinished, readStartingNow } from './benNow'
import { nowSlots, quickKind } from './benQuick'
import { parseCoffee } from './sleepCare'
import { liveHeadline, replaceAnswer, wantsNewPlan } from './benPlanText'

describe('he is starting something now', () => {
  it('reads "now I am going to…", "I\'m starting…", "about to…"', () => {
    expect(readStartingNow('now I am going to clean up the room')).toBe('clean up the room')
    expect(readStartingNow("I'm starting the essay now")).toBe('the essay')
    expect(readStartingNow('about to do algebra')).toBe('algebra')
    expect(readStartingNow('ok time to study')).toBe('study')
  })
  it('a later time is a promise, sleep and questions are not this', () => {
    expect(readStartingNow("I'm going to clean the room tomorrow")).toBeNull()
    expect(readStartingNow('I am going to clean the room')).toBeNull()
    expect(readStartingNow("I'm going to bed now")).toBeNull()
    expect(readStartingNow('should I start algebra now?')).toBeNull()
  })
  it('finds the plan block it means', () => {
    const blocks = [{ title: 'Etica lab', start: '13:45', minutes: 45 }, { title: 'Clean room', start: '14:30', minutes: 45 }]
    expect(blockFor('clean up the room', blocks)?.title).toBe('Clean room')
    expect(blockFor('call grandma', blocks)).toBeNull()
  })
  it('reads "I finished X" and matches the running timer', () => {
    expect(readFinished('I finished the lab report')).toBe('the lab report')
    expect(readFinished('algebra done')).toBe('algebra')
    expect(readFinished('almost done with algebra')).toBeNull()
    expect(meansTimer('the lab report', 'Lab report')).toBe(true)
    expect(meansTimer('the session', 'Anything')).toBe(true)
    expect(meansTimer('gym', 'Lab report')).toBe(false)
  })
})

describe('"what now?" from the data', () => {
  it('"What should I focus on right now?" is answered in code', () => {
    expect(quickKind('What should I focus on right now?', '2026-11-07')).toEqual({ kind: 'now' })
    expect(quickKind('what should I be doing right now?', '2026-11-07')).toEqual({ kind: 'now' })
    expect(quickKind('what should I focus on this week to pass algebra?', '2026-11-07')).toBeNull()
  })
  it('names only real plan blocks and events, the plan block once', () => {
    const now = new Date(2026, 10, 7, 18, 11)
    const iso = (h: number, m: number) => new Date(2026, 10, 7, h, m).toISOString()
    const s = nowSlots([{ title: 'CV update', start: '18:30', minutes: 45 }], [{ title: 'CV update', start: iso(18, 30), end: iso(19, 15) }, { title: 'Gym', start: iso(19, 0), end: iso(20, 0) }], now, new Date(2026, 10, 7, 18, 15).getTime())
    expect(s).toEqual({ current: null, next: { title: 'CV update', start: '18:30', end: '19:15', kind: 'block' } })
    expect(nowSlots([], null, now)).toEqual({ current: null, next: null })
  })
})

describe('logs and plan words', () => {
  it('"just drunk a cup of coffee" is a coffee', () => {
    expect(parseCoffee('just drunk a cup of coffee')).toBe(1)
    expect(parseCoffee("I've had 2 espressos")).toBe(2)
    expect(parseCoffee('no coffee today')).toBeNull()
  })
  it('a new plan request, and the answer to "Replace it?"', () => {
    expect(wantsNewPlan('create a new plan')).toBe(true)
    expect(wantsNewPlan('redo my day plan')).toBe(true)
    expect(wantsNewPlan('show me the plan')).toBe(false)
    expect(replaceAnswer('Yes, replace it')).toBe('yes')
    expect(replaceAnswer('No, keep it')).toBe('no')
    expect(replaceAnswer('maybe')).toBeNull()
  })
  it('a headline keeps only counts that still match', () => {
    const p = { blocks: [{ title: 'A', start: '10:00', minutes: 60 }, { title: 'B', start: '12:00', minutes: 40 }], mustdos: ['x', 'y', 'z'] }
    expect(liveHeadline('3 must-dos · 8 blocks · 6h10 · gym 18:00', p)).toBe('3 must-dos · gym 18:00')
    expect(liveHeadline('3 must-dos · 2 blocks · 1h40 focus', p)).toBe('3 must-dos · 2 blocks · 1h40 focus')
  })
})

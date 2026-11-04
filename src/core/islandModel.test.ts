import { describe, expect, it } from 'vitest'
import { EMPTY_ISLAND, blocksFromPlan, nowNext, pickAlert, pill, type AlertInput } from './islandModel'

const day = new Date(2026, 10, 4)
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime()
const blocks = blocksFromPlan([{ title: 'Study math', start: '10:00', minutes: 50 }, { title: 'Gym', start: '17:30', minutes: 60 }], day)
const base: AlertInput = { now: at(9), running: null, blocks, log: [], seenBen: at(8), dismissed: {} }

describe('desktop island', () => {
  it('finds the block now and the next one', () => {
    expect(nowNext(blocks, at(10, 20)).now?.title).toBe('Study math')
    expect(nowNext(blocks, at(10, 20)).next?.title).toBe('Gym')
    expect(nowNext(blocks, at(19)).now).toBeNull()
  })

  it('drops down when a block starts, offers to start it, and stays quiet once snoozed', () => {
    const a = pickAlert({ ...base, now: at(10, 1) })
    expect(a).toMatchObject({ kind: 'block', text: 'Study math' })
    expect(a!.actions[0].action).toEqual({ kind: 'start', subject: 'Study math', minutes: 49 })
    expect(pickAlert({ ...base, now: at(10, 2), dismissed: { [a!.id]: at(10, 11) } })).toBeNull()
    expect(pickAlert({ ...base, now: at(10, 30) })).toBeNull()
  })

  it('time up beats everything; then Ben’s new message', () => {
    const running = { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) }
    expect(pickAlert({ ...base, now: at(10, 26), running })?.kind).toBe('over')
    const log = [{ role: 'coach' as const, via: 'telegram', text: 'Water time 💧', at: new Date(at(9, 30)).toISOString() }]
    expect(pickAlert({ ...base, now: at(9, 31), log })).toMatchObject({ kind: 'ben', text: 'Water time 💧' })
    // His replies inside the app don't drop it down.
    expect(pickAlert({ ...base, now: at(9, 31), log: [{ ...log[0], via: 'app' }] })).toBeNull()
  })

  it('smart pill: timer, block now, next within an hour, else a glow', () => {
    const s = { ...EMPTY_ISLAND, locked: false, now: null, next: blocks[0] }
    expect(pill({ ...s, running: { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) } }, at(10, 5))).toMatchObject({ kind: 'timer', text: '20:00', sub: 'Math' })
    expect(pill({ ...s, running: { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) } }, at(10, 27)).text).toBe('+2:00')
    expect(pill(s, at(9, 40))).toMatchObject({ kind: 'next', sub: 'in 20m' })
    expect(pill(s, at(8)).kind).toBe('idle')
    expect(pill({ ...s, ben: { ...s.ben, unread: 2 } }, at(8)).dot).toBe(true)
  })
})

describe('island prefs', () => {
  it('cleans saved prefs: keeps your order, adds missing sections, clamps values', async () => {
    const { cleanIslandPrefs } = await import('./islandModel')
    const p = cleanIslandPrefs({ size: 'large', opacity: 0.2, look: 'neon', sections: [{ id: 'ben', on: true }, { id: 'logs', on: false }, { id: 'nope' }], shortcut: 'Ctrl+Hack' })
    expect(p.size).toBe('large')
    expect(p.opacity).toBe(0.55)
    expect(p.look).toBe('black')
    expect(p.sections.map((s) => s.id)).toEqual(['ben', 'logs', 'timer', 'plan', 'mustdos'])
    expect(p.sections[1].on).toBe(false)
    expect(p.shortcut).toBe('Control+Alt+Space')
    expect(cleanIslandPrefs(null).sections).toHaveLength(5)
  })
})

describe('live activities', () => {
  it('timer first, then now / next, Ben unread, water; nothing → empty', async () => {
    const { activities, EMPTY_ISLAND } = await import('./islandModel')
    const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime()
    const s = {
      ...EMPTY_ISLAND,
      locked: false,
      running: { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) },
      next: { title: 'Gym', start: at(12), end: at(13) },
      ben: { ...EMPTY_ISLAND.ben, unread: 1, last: { text: 'Drink water <b>now</b>', at: 'x', face: '😤' } },
      water: { ml: 500, target: 2700 }
    }
    expect(activities(s, at(10, 5)).map((a) => a.kind)).toEqual(['timer', 'next', 'ben', 'water'])
    expect(activities(s, at(10, 5))[2].text).toBe('Drink water now')
    expect(activities({ ...EMPTY_ISLAND, locked: false }, at(9))).toEqual([])
  })
})

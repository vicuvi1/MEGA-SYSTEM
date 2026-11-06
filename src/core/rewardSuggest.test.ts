import { describe, expect, it } from 'vitest'
import { activity, type Activity } from './rewardActivity'
import { BANDS, STARTERS, starterReward, suggest } from './rewardSuggest'
import { validateReward } from './shop'
import { cleanUnlocks } from './unlocks'
import { cleanRules } from './rewardGuard'

const today = '2026-11-05'
const quiet: Activity = activity({ today, ledger: [], focus: [], workoutDays: [], sleep: [] })
const coder: Activity = activity({
  today,
  ledger: [],
  focus: [
    { day: '2026-11-02', subject: 'Rust', minutes: 240 },
    { day: '2026-11-03', subject: 'Rust project', minutes: 200 },
    { day: '2026-11-04', subject: 'Python', minutes: 100 }
  ],
  workoutDays: [],
  sleep: []
})
const base = { balance: 200, perDay: 120, have: [] as string[], hidden: [] as string[], hasGoal: false }

describe('the starter catalogue', () => {
  it('has about 50 valid rewards in four sizes with sane prices', () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(40)
    expect(STARTERS.length).toBeLessThanOrEqual(60)
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(STARTERS.length)
    for (const s of STARTERS) {
      expect(() => validateReward({ ...starterReward(s), archived: false })).not.toThrow()
      if (s.band === 'daily') expect(s.points, s.key).toBeLessThanOrEqual(150)
      if (s.band === 'weekly') expect(s.points >= 300 && s.points <= 800, s.key).toBe(true)
      if (s.band === 'monthly') expect(s.points >= 1000 && s.points <= 3000, s.key).toBe(true)
      if (s.band === 'big') expect(s.points, s.key).toBeGreaterThanOrEqual(5000)
      if (s.unlock) expect(Object.keys(cleanUnlocks({ 1: s.unlock })), s.key).toEqual(['1'])
      if (s.rules) expect(Object.keys(cleanRules({ 1: s.rules })), s.key).toEqual(['1'])
    }
    for (const b of Object.keys(BANDS)) expect(STARTERS.filter((s) => s.band === b).length).toBeGreaterThanOrEqual(6)
  })
})

describe('suggestions from what you do', () => {
  it('a coding week brings coding rewards, with the reason', () => {
    const xs = suggest({ ...base, activity: coder })
    const kb = xs.find((x) => x.starter.key === 'keyboard')
    expect(kb).toBeTruthy()
    expect(kb!.reason).toBe('You coded 9 h this week: a mechanical keyboard fits.')
    expect(xs.length).toBe(8)
  })
  it('one of each size, and no more than a few of a kind', () => {
    const xs = suggest({ ...base, activity: quiet })
    for (const b of Object.keys(BANDS)) expect(xs.some((x) => x.starter.band === b), b).toBe(true)
    const cats = new Map<string, number>()
    for (const x of xs) cats.set(x.starter.category, (cats.get(x.starter.category) ?? 0) + 1)
    // The size picks come first and may add a third of a kind; the rest keep to 2.
    expect(Math.max(...cats.values())).toBeLessThanOrEqual(3)
  })
  it('skips what you have and what you hid', () => {
    const xs = suggest({ ...base, activity: coder, have: ['A mechanical keyboard'], hidden: ['headphones'] })
    expect(xs.some((x) => x.starter.key === 'keyboard' || x.starter.key === 'headphones')).toBe(false)
  })
  it('fun steps back when fun runs ahead of earning', () => {
    const gamer = activity({ today, ledger: [1, 2, 3, 4].map((i) => ({ id: i, ts: '', day: '2026-11-04', module: 'fun', kind: 'spend' as const, coins: -60, xp: 0 })), focus: [], workoutDays: [], sleep: [] })
    const fun = (xs: ReturnType<typeof suggest>) => xs.filter((x) => x.starter.category === 'fun').length
    expect(fun(suggest({ ...base, activity: gamer, funOver: true }))).toBeLessThan(fun(suggest({ ...base, activity: gamer })))
  })
  it('with no signal it talks about your points', () => {
    const xs = suggest({ ...base, activity: quiet, balance: 1000 })
    const plain = xs.filter((x) => x.starter.band !== 'big' && !x.starter.tags.some((t) => ['rest', 'gaming', 'music'].includes(t)))
    expect(plain.length).toBeGreaterThan(0)
    for (const x of plain) expect(x.reason).toMatch(/today with what you have|usual earning|working towards/)
  })
})

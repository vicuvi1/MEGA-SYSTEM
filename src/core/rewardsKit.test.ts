import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './ledger'
import { repeatBlocker, redeemBlocker, rewardEmoji, type Reward } from './shop'
import {
  affordChips,
  badgeStats,
  badges,
  benRewardLine,
  bestStreak,
  blocksFor,
  CHALLENGE_BONUS,
  challengeState,
  dayStreak,
  earnings,
  etaDay,
  etaLabel,
  flameLevel,
  FOCUS_BLOCK_POINTS,
  LUCKY,
  luckyRoll,
  mondayOf,
  pickChallenge,
  readyLine,
  soonerWith,
  sourceOf,
  streakBonus
} from './rewardsKit'

let nextId = 1
const e = (p: Partial<LedgerEntry>): LedgerEntry => ({ id: nextId++, ts: `${p.day ?? '2026-11-05'}T10:00:00Z`, day: '2026-11-05', module: 'focus', kind: 'earn', coins: 10, xp: 0, ruleId: null, ref: null, note: null, undoOf: null, ...p })
const reward = (p: Partial<Reward> = {}): Reward => ({ id: 1, title: 'Headphones', price: 300, tier: 'bronze', realCost: 0, pinned: false, archived: false, note: null, ...p })

describe('when a goal is ready (RG1)', () => {
  const today = '2026-11-05' // a Thursday
  it('finds the day at your pace', () => {
    expect(etaDay(today, 100, 40)).toBe('2026-11-08')
    expect(etaDay(today, 100, 0)).toBeNull()
    expect(etaDay(today, 0, 0)).toBe(today)
  })
  it('says it in plain words', () => {
    expect(etaLabel(today, today)).toBe('today')
    expect(etaLabel(today, '2026-11-06')).toBe('tomorrow')
    expect(etaLabel(today, '2026-11-09')).toBe('by Monday')
    expect(etaLabel(today, '2026-11-20')).toBe('by 20 Nov')
    expect(readyLine(today, 120, 40)).toBe('Ready by Sunday')
    expect(readyLine(today, -5, 40)).toBe('Ready now')
    expect(readyLine(today, 50, 0)).toBeNull()
  })
  it('works out how much sooner two focus blocks a day get you there', () => {
    expect(FOCUS_BLOCK_POINTS).toBe(15)
    // 300 left at 30 a day = 10 days; +30 a day = 5 days: 5 days sooner.
    expect(soonerWith(300, 30, 2)).toEqual({ blocks: 2, days: 5, alone: 10 })
    expect(soonerWith(0, 30).days).toBe(0)
    expect(blocksFor(31)).toBe(3)
  })
})

describe('what can I afford (RG4)', () => {
  it('counts now, in 3 days and next month, with jars', () => {
    const list = [reward({ id: 1, price: 100 }), reward({ id: 2, price: 200 }), reward({ id: 3, price: 2000, jar: 1000 })]
    const chips = affordChips(list, 120, 30)
    expect(chips.map((c) => c.items.map((r) => r.id))).toEqual([[1], [1, 2], [1, 2, 3]])
  })
})

describe('repeat rules (RF2)', () => {
  it('waits out a cooldown', () => {
    const r = reward({ cooldownDays: 3 })
    expect(repeatBlocker(r, [], '2026-11-05')).toBeNull()
    expect(repeatBlocker(r, ['2026-11-04'], '2026-11-05')).toBe('You can get it again in 2 days')
    expect(repeatBlocker(r, ['2026-11-03'], '2026-11-05')).toBe('You can get it again tomorrow')
    expect(repeatBlocker(r, ['2026-11-02'], '2026-11-05')).toBeNull()
  })
  it('keeps a monthly limit', () => {
    const r = reward({ monthLimit: 2 })
    expect(repeatBlocker(r, ['2026-10-30', '2026-11-01'], '2026-11-05')).toBeNull()
    expect(repeatBlocker(r, ['2026-11-01', '2026-11-03'], '2026-11-05')).toBe('Used 2 of 2 this month')
  })
  it('is enforced by redeemBlocker, and the jar counts toward the price', () => {
    const base = { balance: 1000, level: 1, monthSpent: 0, budget: 0, today: '2026-11-05' }
    expect(redeemBlocker({ ...base, reward: reward({ cooldownDays: 7 }), buys: ['2026-11-01'] })).toMatch(/again in 3 days/)
    expect(redeemBlocker({ ...base, balance: 100, reward: reward({ jar: 150 }) })).toBe('You need 50 more points')
    expect(redeemBlocker({ ...base, balance: 150, reward: reward({ jar: 150 }) })).toBeNull()
  })
  it('gives every reward a cover emoji', () => {
    expect(rewardEmoji({ emoji: '🎧', category: 'food' })).toBe('🎧')
    expect(rewardEmoji({ emoji: null, category: 'food' })).toBe('🍕')
    expect(rewardEmoji({})).toBe('🎁')
  })
})

describe('honest extras (RG6, RG7)', () => {
  it('a lucky gift is rare and capped a day', () => {
    expect(luckyRoll(0.05, 0)).toBe(LUCKY.coins)
    expect(luckyRoll(0.5, 0)).toBe(0)
    expect(luckyRoll(0.01, LUCKY.dailyCap)).toBe(0)
    // About 1 in 8 over many must-dos
    let hits = 0
    for (let i = 0; i < 800; i++) hits += luckyRoll(i / 800, 0) ? 1 : 0
    expect(hits).toBe(100)
  })
  it('the streak bonus starts at 7 days and stays small', () => {
    expect(streakBonus(15, 6)).toBe(0)
    expect(streakBonus(15, 7)).toBe(2)
    expect(streakBonus(80, 30)).toBe(3)
    expect(streakBonus(3, 7)).toBe(1)
    expect(streakBonus(0, 9)).toBe(0)
  })
  it('counts the streak and grows the flame', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
    expect(dayStreak(days, '2026-11-04')).toBe(4)
    expect(dayStreak(days, '2026-11-05')).toBe(4) // today not done yet
    expect(dayStreak(days, '2026-11-06')).toBe(0)
    expect([2, 3, 7, 14].map(flameLevel)).toEqual([0, 1, 2, 3])
    expect(bestStreak(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'])).toBe(3)
  })
})

describe('earnings graph (RG3)', () => {
  it('splits by source, skips jar moves and undone rows, compares weeks', () => {
    const today = '2026-11-05'
    const undone = e({ day: today, module: 'plan', coins: 10 })
    const rows = [
      e({ day: today, module: 'focus', coins: 15 }),
      e({ day: today, module: 'plan', coins: 10 }),
      undone,
      e({ day: today, kind: 'undo', coins: 0, undoOf: undone.id }),
      e({ day: today, module: 'plan', coins: 5, ref: 'extra:9:lucky' }),
      e({ day: '2026-11-02', module: 'sleep', coins: 2 }),
      e({ day: '2026-10-28', module: 'tasks', coins: 5 }),
      e({ day: today, module: 'shop', kind: 'spend', coins: -40 }),
      e({ day: today, module: 'shop', kind: 'spend', coins: -100, ref: 'goal:3' }),
      e({ day: today, module: 'quests', kind: 'adjust', coins: 500 })
    ]
    const r = earnings(rows, today)
    expect(r.days).toHaveLength(30)
    const t = r.days.at(-1)!
    expect(t.earned).toEqual({ focus: 15, mustdo: 10, tasks: 0, habits: 0, bonus: 5 })
    expect(t.spent).toBe(40)
    expect(r.today).toBe(30)
    expect(r.best).toEqual({ day: today, total: 30 })
    expect(r.thisWeek).toEqual({ earned: 32, spent: 40 })
    expect(r.lastWeek).toEqual({ earned: 5, spent: 0 })
    expect(mondayOf(today)).toBe('2026-11-02')
    expect(sourceOf({ module: 'discipline', ref: null, ruleId: null })).toBe('habits')
  })
})

describe('weekly challenge (RG5)', () => {
  it('picks your weakest area and counts only real logged actions this week', () => {
    const lastWeek = [e({ day: '2026-10-27', ruleId: 'focus.session', coins: 15 }), e({ day: '2026-10-27', module: 'plan', ruleId: 'plan.item_done' }), ...Array.from({ length: 15 }, () => e({ day: '2026-10-28', module: 'sleep', ruleId: 'sleep.up_on_time', coins: 2 })), ...Array.from({ length: 12 }, () => e({ day: '2026-10-28', module: 'tasks', coins: 5 }))]
    // focus 1/5 = 0.2, must-dos 1/10 = 0.1: must-dos are the weakest
    expect(pickChallenge(lastWeek)).toBe('mustdo')
    const week = '2026-11-02'
    const rows = [...Array.from({ length: 10 }, () => e({ day: '2026-11-03', module: 'plan', ruleId: 'plan.item_done' })), e({ day: '2026-11-01', module: 'plan', ruleId: 'plan.item_done' })]
    const c = challengeState('mustdo', week, rows, '2026-11-05')
    expect(c).toMatchObject({ progress: 10, goal: 10, done: true, paid: false, bonus: CHALLENGE_BONUS, daysLeft: 4 })
    const paid = challengeState('mustdo', week, [...rows, e({ module: 'goals', ref: `challenge:${week}`, coins: 40 })], '2026-11-05')
    expect(paid.paid).toBe(true)
    expect(challengeState('focus', week, rows, '2026-11-05').progress).toBe(0)
  })
})

describe('badges (RG8)', () => {
  it('are earned once from real numbers, with no points', () => {
    const rows = [e({ coins: 600 }), e({ coins: 500 }), e({ ref: 'chest:L2', module: 'shop', coins: 20 }), e({ ref: 'extra:1:lucky', module: 'plan', coins: 5 })]
    const s = badgeStats(rows, 1, ['2026-11-01', '2026-11-02'])
    expect(s).toMatchObject({ bought: 1, earnedAllTime: 1125, chests: 1, lucky: 1, bestFocusStreak: 2 })
    const b = badges(s)
    const got = b.filter((x) => x.earned).map((x) => x.id)
    expect(got).toEqual(['first_buy', 'k1', 'chest', 'lucky'])
    expect(b.find((x) => x.id === 'streak7')!.progress).toBeCloseTo(2 / 7)
  })
})

describe("Ben's line (RW9)", () => {
  const base = { perDay: 40, today: '2026-11-05', todayEarned: 20, readyCount: 0, streak: 0 }
  it('uses live numbers', () => {
    expect(benRewardLine({ ...base, goal: { title: 'headphones', left: 25 } })).toBe('Two focus blocks and the headphones is yours.')
    expect(benRewardLine({ ...base, goal: { title: 'trip', left: 400 } })).toBe('+20 today. 400 to go for the trip: ready by 15 Nov at your pace.')
    expect(benRewardLine({ ...base, justBought: 'Pizza night' })).toMatch(/^Pizza night: enjoy it/)
    expect(benRewardLine({ ...base, todayEarned: 0 })).toMatch(/Nothing earned yet today/)
    expect(benRewardLine({ ...base, readyCount: 2 })).toBe('Two rewards are ready. You did the work, take one.')
  })
})

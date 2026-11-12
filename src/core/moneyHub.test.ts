import { describe, expect, it } from 'vitest'
import { budgetEffect, budgetLevel, changePct, eveningMoneyAsk, goalPlan, lastDays, mainAccountId, mergeGoals, monthForecast, morningMoneyLine, quickMoneyShape, sameDayCompare, underStreak, warnLine, weekCompare, type HubTx } from './moneyHub'
import { commandPreview } from './islandCommands'

describe('quick-add shape (island previews)', () => {
  it('reads sums, income and "yesterday"', () => {
    expect(quickMoneyShape('120+45 groceries yesterday')).toEqual({ amount: 165, note: 'groceries', income: false, yesterday: true })
    expect(quickMoneyShape('+500 salary')).toEqual({ amount: 500, note: 'salary', income: true, yesterday: false })
    expect(quickMoneyShape('45 food maib')).toEqual({ amount: 45, note: 'food maib', income: false, yesterday: false })
    expect(quickMoneyShape('call mom at 5')).toBeNull()
  })
  it('the island command bar offers it as money for Finance Helper', () => {
    const c: any = { now: Date.now(), running: null, tasks: [], meet: null, chips: { water: [250], focus: [25] }, reps: [], subject: 'Focus' }
    const s = commandPreview('120+45 groceries yesterday', c)[0]
    expect(s).toMatchObject({ label: 'Spent 165 · groceries (yesterday)', hint: 'Finance Helper', action: { kind: 'chat' } })
  })
})

let n = 0
const ex = (date: string, lei: number, category = 'food', everyday = true): HubTx => ({ id: `t${n++}`, date, type: 'expense', amount: lei * 100, category, everyday })
const inc = (date: string, lei: number): HubTx => ({ id: `t${n++}`, date, type: 'income', amount: lei * 100, category: 'work', everyday: false })
const cats = [
  { id: 'food', name: 'Food' },
  { id: 'transport', name: 'Transport' },
  { id: 'fun', name: 'Fun' }
]

describe('same-day comparison', () => {
  it('compares 1–5 Nov with 1–5 Oct, not the whole of October', () => {
    const tx = [ex('2026-10-02', 100), ex('2026-10-20', 900), ex('2026-11-03', 150)]
    const c = sameDayCompare(tx, '2026-11-05', cats)
    expect(c.days).toBe(5)
    expect(c.thisTotal).toBe(15000)
    expect(c.lastTotal).toBe(10000)
    expect(c.pct).toBe(50)
  })

  it('never says -100% for a fresh month', () => {
    const c = sameDayCompare([ex('2026-10-01', 80)], '2026-11-01', cats)
    expect(c.thisTotal).toBe(0)
    expect(c.pct).toBeNull()
    expect(c.changes[0]).toBe('Food: nothing yet, 80\u00a0MDL by this day in October')
  })

  it('cuts last month at its own end (31 March vs February)', () => {
    const c = sameDayCompare([ex('2026-02-28', 50), ex('2026-03-31', 70)], '2026-03-31', cats)
    expect(c.days).toBe(28)
    expect(c.lastTotal).toBe(5000)
  })

  it('names the top 3 changes in plain words, biggest first', () => {
    const tx = [ex('2026-10-02', 100), ex('2026-11-02', 400), ex('2026-10-03', 200, 'transport'), ex('2026-11-03', 50, 'transport'), ex('2026-11-04', 60, 'fun'), ex('2026-11-04', 5, 'gifts')]
    const c = sameDayCompare(tx, '2026-11-05', cats)
    expect(c.changes).toEqual(['Food: 300\u00a0MDL more than by this day in October', 'Transport: 150\u00a0MDL less than by this day in October', 'Fun: 60\u00a0MDL, nothing by this day in October'])
    expect(c.byCat.map((r) => r.id)).toEqual(['food', 'fun', 'transport', 'gifts'])
  })

  it('a percent only when both sides have spending', () => {
    expect(changePct(0, 100)).toBeNull()
    expect(changePct(100, 0)).toBeNull()
    expect(changePct(80, 100)).toBe(-20)
  })
})

describe('week comparison', () => {
  it('Monday to today against the same days last week', () => {
    // 2026-11-05 is a Thursday: Mon 2 – Thu 5 against Mon 26 – Thu 29 Oct.
    const tx = [ex('2026-10-26', 100), ex('2026-10-30', 500), ex('2026-11-02', 60), ex('2026-11-05', 20)]
    const w = weekCompare(tx, '2026-11-05')
    expect(w.thisWeek).toBe(8000)
    expect(w.lastWeek).toBe(10000)
    expect(w.line).toBe('This week: 80\u00a0MDL, 20\u00a0MDL less than the same days last week.')
  })
})

describe('forecast to month end', () => {
  it('projects the pace over the days left, with income and bills still due', () => {
    // 10 days at 50 lei a day, 3000 salary in, rent 1000 due on the 25th.
    const tx = [inc('2026-11-01', 3000), ...Array.from({ length: 10 }, (_, i) => ex(`2026-11-${String(i + 1).padStart(2, '0')}`, 50))]
    const f = monthForecast(tx, '2026-11-10', [{ date: '2026-11-25', amount: 100000, type: 'expense', label: 'Rent' }])
    expect(f.pace).toBe(5000)
    // 3000 − 500 − 1000 − 20 days × 50 = 500 lei
    expect(f.endNet).toBe(50000)
    expect(f.line).toBe('At this pace you end November at +500\u00a0MDL')
    expect(f.actual).toHaveLength(10)
    expect(f.projected[0]).toEqual({ day: '2026-11-10', net: 250000 })
    expect(f.projected.at(-1)).toEqual({ day: '2026-11-30', net: 50000 })
    // (3000 − 500 − 1000 + 50 today) / 21 days = 73.8 → 73 lei (whole lei, rounded down)
    expect(f.safeDaily).toBe(7300)
  })

  it('early in the month uses the last 30 days as the pace', () => {
    const tx = Array.from({ length: 30 }, (_, i) => ex(`2026-10-${String(i + 2).padStart(2, '0')}`, 30))
    const f = monthForecast(tx, '2026-11-01')
    expect(f.pace).toBe(3000)
    expect(f.endNet).toBe(-29 * 3000)
    expect(f.line).toBe('At this pace you end November at −870\u00a0MDL')
  })

  it('leaves bills out of the pace but in the total', () => {
    const tx = [ex('2026-11-01', 2000, 'home', false), ex('2026-11-02', 30), ex('2026-11-03', 30), ex('2026-11-04', 30)]
    const f = monthForecast(tx, '2026-11-04')
    expect(f.pace).toBe(2250)
    expect(f.spentSoFar).toBe(209000)
  })
})

describe('budget thresholds', () => {
  it('amber at 80%, over past 100%', () => {
    expect(budgetLevel(100, 0)).toBe('none')
    expect(budgetLevel(7900, 10000)).toBe('ok')
    expect(budgetLevel(8000, 10000)).toBe('warn')
    expect(budgetLevel(10000, 10000)).toBe('warn')
    expect(budgetLevel(10001, 10000)).toBe('over')
  })

  it('one flash when crossing 80%, a shake when going over, nothing going back', () => {
    expect(budgetEffect('ok', 'warn')).toBe('flash')
    expect(budgetEffect('warn', 'warn')).toBeNull()
    expect(budgetEffect('warn', 'over')).toBe('shake')
    expect(budgetEffect('ok', 'over')).toBe('shake')
    expect(budgetEffect('over', 'ok')).toBeNull()
  })

  it('counts finished days under budget, back from yesterday', () => {
    const days = [
      { day: '2026-11-04', spent: 50, budget: 100 },
      { day: '2026-11-03', spent: 90, budget: 100 },
      { day: '2026-11-02', spent: 120, budget: 100 },
      { day: '2026-11-05', spent: 500, budget: 100 }
    ]
    expect(underStreak(days, '2026-11-05')).toBe(2)
  })

  it('the last 7 days, oldest first', () => {
    const d = lastDays([ex('2026-11-05', 10), ex('2026-11-05', 5, 'home', false), ex('2026-10-30', 20)], '2026-11-05')
    expect(d.map((x) => x.spent)).toEqual([2000, 0, 0, 0, 0, 0, 1000])
  })
})

describe('goals', () => {
  it('a ring with an ETA and a weekly amount to the deadline', () => {
    const g = goalPlan({ id: 'g', name: 'Laptop', target: 1200000, current: 300000, deadline: '2027-01-28', pacePerMonth: 150000, source: 'finance' }, '2026-11-05')
    expect(g.ratio).toBe(0.25)
    expect(g.eta).toBe('May 2027')
    // 9000 lei over 12 weeks = 750 lei a week
    expect(g.perWeek).toBe(75000)
    expect(g.line).toBe('Put 750\u00a0MDL a week to get there by 28 Jan')
  })

  it('without a deadline: a 12-week plan; reached goals say so', () => {
    expect(goalPlan({ id: 'b', name: 'Bike', target: 120000, current: 0, source: 'rewards' }, '2026-11-05').perWeek).toBe(10000)
    expect(goalPlan({ id: 'c', name: 'Shoes', target: 100, current: 200, source: 'finance' }, '2026-11-05').line).toBe('Reached')
  })

  it('one list: the same goal in Rewards shows once', () => {
    const m = mergeGoals([{ id: 'a', name: 'New laptop', target: 1, current: 0, source: 'finance' }], [{ id: 'b', name: 'new  Laptop!', target: 1, current: 0, source: 'rewards' }, { id: 'c', name: 'Concert', target: 1, current: 0, source: 'rewards' }])
    expect(m.map((g) => g.id)).toEqual(['a', 'c'])
  })
})

describe('quick add default account', () => {
  const accounts = [
    { id: 'safe', name: 'Safe', kind: 'savings', savings: true, currency: 'MDL' },
    { id: 'eur', name: 'Cash EUR', kind: 'cash', currency: 'EUR' },
    { id: 'card', name: 'Bank card', kind: 'card', currency: 'MDL' },
    { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL' }
  ]
  it('the main lei wallet, never savings or another currency', () => {
    expect(mainAccountId(accounts)).toBe('wallet')
    expect(mainAccountId(accounts.filter((a) => a.id !== 'wallet'))).toBe('card')
    expect(mainAccountId([accounts[0], accounts[1]])).toBeNull()
  })
})

describe("Ben's money lines", () => {
  const f = { perDay: 18000, leftToday: 18000, limit: { amount: 400000, spent: 330000, daysLeft: 26 }, loggedToday: false, bill: { name: 'Internet', amount: 15000, date: '2026-11-06' } }
  it('morning: safe to spend, what is left, the 80% warning', () => {
    expect(morningMoneyLine(f)).toBe('💸 Safe to spend today: 180\u00a0MDL · 700\u00a0MDL left for 26 days\n⚠️ 83% of this month\'s limit is used, 26 days to go. 📅 Internet (150\u00a0MDL) is due 6 Nov.')
    expect(morningMoneyLine({ ...f, perDay: null })).toBeNull()
  })
  it('warning: over the limit, a bill tomorrow', () => {
    expect(warnLine({ ...f, limit: { amount: 100000, spent: 120000, daysLeft: 3 } }, '2026-11-05')).toBe('⚠️ Over your monthly limit by 200\u00a0MDL. 📅 Internet (150\u00a0MDL) is due tomorrow.')
    expect(warnLine({ ...f, limit: null, bill: null })).toBeNull()
  })
  it('evening: asked only when nothing was logged', () => {
    expect(eveningMoneyAsk(f)).toBe('Nothing logged today — anything spent?')
    expect(eveningMoneyAsk({ ...f, loggedToday: true })).toBeNull()
  })
})

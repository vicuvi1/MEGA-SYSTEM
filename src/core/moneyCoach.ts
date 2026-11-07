// TL6: the money coach (pure, tested). "Can I afford headphones this month?"
// is answered from your real Finance Helper numbers: what's left of the
// month's budget, your savings rate, the fun budget, and how a buy moves your
// savings goal. Honest: a number that isn't known is said to be unknown, never
// guessed. Amounts are integer bani (1 lei = 100) like Finance Helper.

import { addDays } from './dates'

export interface AffordAsk {
  what: string
  /** Price in bani, or null when you didn't say. */
  price: number | null
}

/** "can I afford headphones this month?", "can I buy a 900 lei jacket", "should I get AirPods" → the ask. */
export function readAfford(text: string): AffordAsk | null {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  const m = /^(?:hey ben,? )?(?:can i (?:afford|buy|get)|could i afford|should i (?:buy|get)|is it ok to buy|do i have (?:the )?money for|pot să-mi permit|pot sa-mi permit|pot să cumpăr|pot sa cumpar|могу ли я (?:купить|позволить себе))\s+(.+?)\s*[?.!]*$/i.exec(t)
  if (!m) return null
  let rest = m[1].replace(/\b(this|the) (month|week)\b|\bluna asta\b|\bв этом месяце\b|\bright now\b|\btoday\b|\bnow\b/gi, ' ').replace(/\s+/g, ' ').trim()
  let price: number | null = null
  const p = /(?:for |at |pentru |за )?(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:lei|mdl|l\b|лей)?/i.exec(rest)
  if (p) {
    price = Math.round(Number(p[1].replace(',', '.')) * 100)
    rest = (rest.slice(0, p.index) + rest.slice(p.index + p[0].length)).replace(/\s+/g, ' ').trim()
  }
  const what = rest.replace(/^(a|an|the|some|new|un|o|niște|niste)\s+/i, '').replace(/\s+(for|at)$/i, '').trim()
  if (!what || what.length > 60) return null
  return { what, price: price && price > 0 ? price : null }
}

export interface MoneyFacts {
  today: string
  /** Spent this month (bani). */
  monthSpent: number
  /** This month's limit (bani) or null. */
  limit: number | null
  limitLeft: number | null
  /** Left per remaining day (today included), or null without a limit. */
  safeToday: number | null
  daysLeft: number
  /** Saved share of income over the last 3 months (0.18 = 18%), null without income. */
  savingsRate: number | null
  /** Average income a month over the last 3 months (bani), null without income. */
  incomePerMonth: number | null
  /** What you put aside a month on average (bani): income − spending, or explicit savings. */
  savedPerMonth: number | null
  /** The fun budget this month (bani) and what's left, null when you didn't set one. */
  fun: { budget: number; left: number } | null
  goals: { title: string; left: number; etaMonths: number | null }[]
}

const B = (t: any) => Math.abs(Number(t?.base ?? t?.amount) || 0)
const live = (t: any) => t && !t.deleted && typeof t.date === 'string'

/** The numbers from Finance Helper's state (and the fun budget, in lei, from Rewards). */
export function moneyFacts(finance: any, today: string, fun: { budgetLei: number | null; leftLei: number | null } | null = null): MoneyFacts {
  const tx: any[] = Array.isArray(finance?.tx) ? finance.tx.filter(live) : []
  const month = today.slice(0, 7)
  const exp = tx.filter((t) => t.type === 'expense' && !t.loan)
  const inc = tx.filter((t) => t.type === 'income' && !t.loan)
  const monthSpent = exp.filter((t) => t.date.startsWith(month)).reduce((s, t) => s + B(t), 0)
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const daysLeft = dim - Number(today.slice(8, 10)) + 1
  const lim = finance?.settings?.limit
  const limit = lim?.on && Number(lim.amount) > 0 ? Math.round(Number(lim.amount)) : null
  const limitLeft = limit != null ? limit - monthSpent : null
  const safeToday = limitLeft != null ? Math.max(0, Math.round(limitLeft / Math.max(1, daysLeft))) : null
  // The last 3 whole months (this one is only partly done).
  const first = new Date(`${month}-01T12:00:00Z`)
  const months = [1, 2, 3].map((k) => {
    const d = new Date(first)
    d.setUTCMonth(d.getUTCMonth() - k)
    return d.toISOString().slice(0, 7)
  })
  const inM = (t: any) => months.includes(t.date.slice(0, 7))
  const incSum = inc.filter(inM).reduce((s, t) => s + B(t), 0)
  const expSum = exp.filter(inM).reduce((s, t) => s + B(t), 0)
  const activeMonths = new Set([...inc, ...exp].filter(inM).map((t) => t.date.slice(0, 7))).size || 0
  const incomePerMonth = incSum && activeMonths ? Math.round(incSum / activeMonths) : null
  const savingsRate = incSum > 0 ? Math.round(((incSum - expSum) / incSum) * 100) / 100 : null
  const explicit = tx.filter((t) => t.type === 'saving' && inM(t)).reduce((s, t) => s + B(t), 0)
  const net = incSum - expSum
  const savedPerMonth = activeMonths ? Math.round(Math.max(explicit, net > 0 ? net : 0) / activeMonths) : null
  const funOn = fun && fun.budgetLei != null && fun.budgetLei > 0
  const goals = (Array.isArray(finance?.goals) ? finance.goals : [])
    .filter((g: any) => g && !g.deleted && Number(g.target) > 0)
    .map((g: any) => {
      const left = Math.max(0, Math.round(Number(g.target) - Number(g.saved ?? g.current ?? 0)))
      return { title: String(g.name ?? g.title ?? 'Goal').slice(0, 60), left, etaMonths: left === 0 ? 0 : savedPerMonth && savedPerMonth > 0 ? Math.round((left / savedPerMonth) * 10) / 10 : null }
    })
    .sort((a: any, b: any) => a.left - b.left)
  return {
    today,
    monthSpent,
    limit,
    limitLeft,
    safeToday,
    daysLeft,
    savingsRate,
    incomePerMonth,
    savedPerMonth,
    fun: funOn ? { budget: Math.round(fun!.budgetLei! * 100), left: Math.round((fun!.leftLei ?? 0) * 100) } : null,
    goals
  }
}

export interface AffordAnswer {
  verdict: 'yes' | 'tight' | 'no' | 'unknown'
  title: string
  lines: string[]
  /** Chips for the next step. */
  chips: string[]
}

export const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`
const pct = (r: number) => `${Math.round(r * 100)}%`
const months = (n: number) => (n < 1 ? `${Math.max(1, Math.round(n * 30))} days` : `${n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '')} month${n === 1 ? '' : 's'}`)

/** "When will I reach the goal?" for a goal after a buy (months). */
export function etaAfter(goal: { left: number }, savedPerMonth: number | null, price: number): number | null {
  if (!savedPerMonth || savedPerMonth <= 0) return null
  return Math.round(((goal.left + price) / savedPerMonth) * 10) / 10
}

/** The answer: verdict, numbers, and what it does to your goal. */
export function affordAnswer(ask: AffordAsk, f: MoneyFacts): AffordAnswer {
  const lines: string[] = []
  const chips: string[] = []
  const known = f.limit != null || f.fun != null || f.savingsRate != null
  if (f.limitLeft != null) lines.push(`Budget left this month: ${lei(Math.max(0, f.limitLeft))} of ${lei(f.limit!)} (${f.daysLeft} day${f.daysLeft === 1 ? '' : 's'} left, ${lei(f.safeToday ?? 0)} a day).`)
  else lines.push('No monthly budget is set in Money, so I can only use your income and spending.')
  if (f.fun) lines.push(`Fun budget: ${lei(Math.max(0, f.fun.left))} left of ${lei(f.fun.budget)}.`)
  if (f.savingsRate != null) lines.push(`Savings rate (last 3 months): ${pct(f.savingsRate)} of income${f.savedPerMonth ? `, about ${lei(f.savedPerMonth)} a month` : ''}.`)
  else lines.push('Savings rate: unknown (no income logged in the last 3 months).')
  const g = f.goals.find((x) => x.left > 0)
  if (!known && !g) return { verdict: 'unknown', title: `I can't tell yet: Money has no budget, income or goals for me to check ${ask.what} against.`, lines: ['Log your income and set a monthly budget in Money, and I will answer with real numbers.'], chips: ['Open Money'] }
  if (ask.price == null) {
    if (g) lines.push(`Goal "${g.title}": ${lei(g.left)} to go${g.etaMonths != null ? `, about ${months(g.etaMonths)} at your pace` : ''}.`)
    chips.push(`${ask.what} for 500 lei?`.slice(0, 40))
    return { verdict: 'unknown', title: `How much is ${ask.what}? Tell me the price and I'll check it against these:`, lines, chips }
  }
  const p = ask.price
  let score = 0
  const room = f.fun ? f.fun.left : f.limitLeft
  if (room != null) {
    if (p <= room * 0.5) score += 2
    else if (p <= room) score += 1
    else score -= 2
    lines.push(f.fun ? (p <= f.fun.left ? `It fits the fun budget: ${lei(f.fun.left - p)} would be left.` : `It's ${lei(p - Math.max(0, f.fun.left))} more than the fun budget has left.`) : p <= room ? `It leaves ${lei(room - p)} of the month's budget.` : `It's ${lei(p - Math.max(0, room))} over what's left of the month's budget.`)
  }
  if (f.limitLeft != null && f.fun && p > f.limitLeft) score -= 1
  if (f.savingsRate != null && f.savingsRate < 0.05) {
    score -= 1
    lines.push(f.savingsRate < 0 ? 'You spent more than you earned lately: every buy comes out of savings.' : 'You save under 5% of what you earn: a buy like this eats most of a month of saving.')
  }
  if (g) {
    const after = etaAfter(g, f.savedPerMonth, p)
    if (g.etaMonths != null && after != null) {
      const delay = after - g.etaMonths
      lines.push(`Goal "${g.title}": ${months(g.etaMonths)} away now${delay >= 0.05 ? `, ${months(after)} after this buy (+${months(delay)})` : ', no real change'}.`)
      if (delay >= 1) score -= 1
    } else lines.push(`Goal "${g.title}": ${lei(g.left)} to go; it would be ${lei(g.left + p)} after this buy.`)
  }
  const verdict: AffordAnswer['verdict'] = score >= 2 ? 'yes' : score >= 0 ? 'tight' : 'no'
  const title = verdict === 'yes' ? `Yes, ${ask.what} for ${lei(p)} fits.` : verdict === 'tight' ? `You can, but it's tight: ${ask.what} for ${lei(p)}.` : `Not this month: ${ask.what} for ${lei(p)} doesn't fit.`
  if (verdict !== 'yes') chips.push('Wait 48 hours', 'Save for it')
  else chips.push('Log it when I buy')
  return { verdict, title, lines, chips: chips.slice(0, 3) }
}

/** The answer as one chat reply (plain text, emoji verdict). */
export function affordReply(a: AffordAnswer): string {
  const face = a.verdict === 'yes' ? '🟢' : a.verdict === 'tight' ? '🟡' : a.verdict === 'no' ? '🔴' : '💬'
  return `${face} ${a.title}\n${a.lines.map((l) => `• ${l}`).join('\n')}`
}

/** For tests and the desk: the date `months` from today. */
export const etaDate = (today: string, m: number) => addDays(today, Math.round(m * 30.4))

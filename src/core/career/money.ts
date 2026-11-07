// Career money (CR5, CR13, CR14, CR19). Pure and tested.
//
// - Emergency fund: N months of your real costs (the average of your last
//   full months in Finance Helper), and how much of it you already have.
// - Pay yourself first: each income you log gets one question, "move X% to
//   savings first?", and the streak counts the times you said yes.
// - Career fund: a share of what you move to savings is for certificate
//   vouchers, courses and labs, with its own ring.
// - Income growth: a monthly target and this month's income by source.
// - Investing (educational only): what a fixed monthly amount could grow to
//   at an assumed yearly return. No products, not financial advice.
// Finance Helper keeps amounts in bani (1 lei = 100); this module answers in lei.
import { addDays } from '../dates'

export interface MoneyPlan {
  /** Months of costs the emergency fund should cover. */
  months: number
  /** Share of each income to move to savings first (%). */
  payPct: number
  /** Share of what you move to savings that goes to the career fund (%). */
  careerPct: number
  /** Career fund goal in lei (a certificate voucher, say), or null. */
  careerGoal: number | null
  careerGoalName: string
  /** Lei a month for the investing plan (after the emergency fund is full). */
  investMonthly: number
  /** Assumed yearly return for the projection (%), educational. */
  investRate: number
  investYears: number
  /** Monthly income target in lei, or null. */
  incomeTarget: number | null
  /** Moves that would close the income gap. */
  moves: { id: string; text: string; done: boolean }[]
  /** Already saved for the emergency fund when there's no savings account in Finance Helper (lei). */
  fundStart: number
}

export const DEFAULT_PLAN: MoneyPlan = { months: 3, payPct: 20, careerPct: 25, careerGoal: null, careerGoalName: 'Certificate voucher', investMonthly: 500, investRate: 5, investYears: 10, incomeTarget: null, moves: [], fundStart: 0 }

/** Your answer to one income's "pay yourself first" question. */
export interface PayAnswer {
  txId: string
  /** The income's day. */
  day: string
  /** Lei moved to savings (0 when you said not this time). */
  moved: number
  answered: string
}

export interface CareerSpend {
  id: string
  what: string
  lei: number
  day: string
}

const B = (t: any) => Math.abs(Number(t?.base ?? t?.amount) || 0)
const live = (t: any) => t && !t.deleted && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.date)
const lei = (bani: number) => Math.round(bani / 100)
const prevMonths = (today: string, n: number) => {
  const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(first)
    d.setUTCMonth(d.getUTCMonth() - (i + 1))
    return d.toISOString().slice(0, 7)
  })
}

/** Average spending a month (lei) over the last 3 full months that have records, or null. */
export function monthlyCosts(finance: any, today: string): { lei: number; months: number } | null {
  const tx: any[] = Array.isArray(finance?.tx) ? finance.tx.filter(live) : []
  const months = prevMonths(today, 3)
  const exp = tx.filter((t) => t.type === 'expense' && !t.loan && months.includes(t.date.slice(0, 7)))
  const active = new Set(exp.map((t) => t.date.slice(0, 7))).size
  if (!active) return null
  return { lei: Math.round(lei(exp.reduce((s, t) => s + B(t), 0)) / active), months: active }
}

/** What sits in your savings accounts in Finance Helper (lei), or null when there are none. */
export function savingsBalance(finance: any): number | null {
  const accounts: any[] = (finance?.settings?.accounts ?? []).filter((a: any) => a && !a.archived && (a.savings === true || a.kind === 'savings'))
  if (!accounts.length) return null
  const ids = new Set(accounts.map((a) => a.id))
  let bal = accounts.reduce((s, a) => s + (Number(a.start) || 0), 0)
  for (const t of Array.isArray(finance?.tx) ? finance.tx.filter(live) : []) {
    const a = Number(t.amount) || 0
    if (t.type === 'income' && ids.has(t.account)) bal += a
    else if (t.type === 'expense' && ids.has(t.account)) bal -= a
    else if (t.type === 'transfer') {
      if (ids.has(t.from)) bal -= a
      if (ids.has(t.to)) bal += Number(t.toAmount ?? t.amount) || 0
    }
  }
  return lei(bal)
}

export interface CareerFund {
  /** Put in so far (the career share of what you moved). */
  in: number
  spent: number
  left: number
  goal: number | null
  pct: number | null
}

export function careerFund(plan: MoneyPlan, answers: PayAnswer[], spends: CareerSpend[]): CareerFund {
  const put = Math.round(answers.reduce((s, a) => s + a.moved, 0) * (plan.careerPct / 100))
  const spent = spends.reduce((s, x) => s + x.lei, 0)
  const left = Math.max(0, put - spent)
  return { in: put, spent, left, goal: plan.careerGoal, pct: plan.careerGoal ? Math.min(100, Math.round((left / plan.careerGoal) * 100)) : null }
}

export interface EmergencyFund {
  /** Monthly costs (lei) or null without spending records. */
  costs: number | null
  target: number | null
  saved: number
  pct: number | null
  left: number | null
  /** How many months your savings would last. */
  monthsCovered: number | null
  /** Where "saved" comes from. */
  source: 'savings account' | 'your own number'
  full: boolean
}

/**
 * With a savings account in Finance Helper, "saved" is its balance minus the
 * career fund; without one, your own starting number plus what you moved
 * (minus the career share).
 */
export function emergencyFund(plan: MoneyPlan, finance: any, today: string, fund: CareerFund, moved = 0): EmergencyFund {
  const c = monthlyCosts(finance, today)
  const bal = savingsBalance(finance)
  const saved = Math.max(0, bal != null ? bal - fund.left : plan.fundStart + moved - fund.in)
  const target = c ? c.lei * plan.months : null
  return {
    costs: c?.lei ?? null,
    target,
    saved,
    pct: target ? Math.min(100, Math.round((saved / target) * 100)) : null,
    left: target != null ? Math.max(0, target - saved) : null,
    monthsCovered: c && c.lei > 0 ? Math.round((saved / c.lei) * 10) / 10 : null,
    source: bal == null ? 'your own number' : 'savings account',
    full: target != null && saved >= target
  }
}

export interface PayAsk {
  txId: string
  day: string
  income: number
  ask: number
  note: string
}

/** Incomes from the last 14 days you haven't answered yet, newest first. */
export function payAsks(finance: any, answers: PayAnswer[], today: string, payPct: number): PayAsk[] {
  const done = new Set(answers.map((a) => a.txId))
  const from = addDays(today, -14)
  const tx: any[] = Array.isArray(finance?.tx) ? finance.tx.filter(live) : []
  return tx
    .filter((t) => t.type === 'income' && !t.loan && t.date.slice(0, 10) >= from && t.date.slice(0, 10) <= today && !done.has(String(t.id)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ txId: String(t.id), day: t.date.slice(0, 10), income: lei(B(t)), ask: Math.round((lei(B(t)) * payPct) / 100), note: String(t.note || t.category || 'Income').slice(0, 40) }))
    .filter((a) => a.income > 0)
}

export function answerPay(answers: PayAnswer[], ask: { txId: string; day: string }, moved: number, today: string): PayAnswer[] {
  return [...answers.filter((a) => a.txId !== ask.txId), { txId: ask.txId, day: ask.day, moved: Math.max(0, Math.round(moved)), answered: today }].sort((a, b) => a.day.localeCompare(b.day)).slice(-200)
}

/** Paid yourself first this many incomes in a row (latest first), and the best run. */
export function payStreak(answers: PayAnswer[]): { now: number; best: number; total: number } {
  const list = [...answers].sort((a, b) => a.day.localeCompare(b.day) || a.answered.localeCompare(b.answered))
  let run = 0
  let best = 0
  for (const a of list) {
    run = a.moved > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  return { now: run, best, total: list.reduce((s, a) => s + a.moved, 0) }
}

export type IncomeSource = 'shift' | 'freelance' | 'scholarship' | 'other'
export const SOURCE_LABEL: Record<IncomeSource, string> = { shift: 'Shift pay', freelance: 'Freelance', scholarship: 'Scholarship', other: 'Other' }

export function incomeSource(t: { category?: string; note?: string; sub?: string }): IncomeSource {
  const s = `${t.category ?? ''} ${t.sub ?? ''} ${t.note ?? ''}`.toLowerCase()
  if (/scholar|bursa|bursă|stipend|grant|стипенд/.test(s)) return 'scholarship'
  if (/freelanc|gig|client|invoice|project|upwork|fiverr|factur|заказ/.test(s)) return 'freelance'
  if (/salar|shift|wage|work|job|pay|salariu|tura|tură|зарплат|смен/.test(s)) return 'shift'
  return 'other'
}

export interface IncomeView {
  month: string
  total: number
  bySource: Record<IncomeSource, number>
  target: number | null
  pct: number | null
  gap: number | null
  /** Average of the last 3 full months, null without income. */
  avg3: number | null
  /** The last 6 months, oldest first (this month last). */
  history: { month: string; total: number }[]
}

export function incomeView(finance: any, today: string, target: number | null): IncomeView {
  const tx: any[] = Array.isArray(finance?.tx) ? finance.tx.filter((t: any) => live(t) && t.type === 'income' && !t.loan) : []
  const month = today.slice(0, 7)
  const sum = (m: string) => lei(tx.filter((t) => t.date.startsWith(m)).reduce((s, t) => s + B(t), 0))
  const bySource: Record<IncomeSource, number> = { shift: 0, freelance: 0, scholarship: 0, other: 0 }
  for (const t of tx.filter((t) => t.date.startsWith(month))) bySource[incomeSource(t)] += lei(B(t))
  const total = sum(month)
  const past = prevMonths(today, 3).map(sum).filter((x) => x > 0)
  const history = [...prevMonths(today, 5).reverse(), month].map((m) => ({ month: m, total: sum(m) }))
  return { month, total, bySource, target, pct: target ? Math.min(100, Math.round((total / target) * 100)) : null, gap: target ? Math.max(0, target - total) : null, avg3: past.length ? Math.round(past.reduce((s, x) => s + x, 0) / past.length) : null, history }
}

export interface ProjectionPoint {
  year: number
  paid: number
  value: number
  low: number
  high: number
}

/**
 * A fixed monthly amount, compounded monthly at an assumed yearly rate (and
 * 2 points lower and higher, to show it isn't a promise). Lei, rounded.
 */
export function projection(monthly: number, ratePct: number, years: number): ProjectionPoint[] {
  const m = Math.max(0, monthly)
  const n = Math.max(1, Math.min(40, Math.round(years)))
  const grow = (r: number, months: number) => {
    const i = Math.max(-0.99, r) / 100 / 12
    return i === 0 ? m * months : m * ((Math.pow(1 + i, months) - 1) / i) * (1 + i)
  }
  return Array.from({ length: n + 1 }, (_, y) => ({ year: y, paid: Math.round(m * 12 * y), value: Math.round(grow(ratePct, 12 * y)), low: Math.round(grow(Math.max(0, ratePct - 2), 12 * y)), high: Math.round(grow(ratePct + 2, 12 * y)) }))
}

export const NOT_ADVICE = 'Educational only, not financial advice. Returns are not guaranteed and the value can go down. No specific products are shown.'

/** One line for Ben's context. */
export function moneyPlanLine(plan: MoneyPlan, ef: EmergencyFund, streak: { now: number }, income: IncomeView, fund: CareerFund, asks: number): string {
  const parts: string[] = []
  if (ef.target) parts.push(`emergency fund ${ef.saved.toLocaleString('en-US')} of ${ef.target.toLocaleString('en-US')} lei (${ef.pct}%, ${plan.months} months of costs)`)
  if (streak.now) parts.push(`paid himself first ${streak.now}× in a row`)
  if (asks) parts.push(`${asks} income${asks === 1 ? '' : 's'} waiting for "pay yourself first"`)
  if (income.target) parts.push(`income ${income.total.toLocaleString('en-US')} of ${income.target.toLocaleString('en-US')} lei this month`)
  if (fund.goal) parts.push(`career fund ${fund.left} of ${fund.goal} lei`)
  return parts.length ? `Money plan: ${parts.join(' · ')}` : ''
}

export function cleanPlan(raw: unknown): MoneyPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const n = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d)
  const opt = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.round(Math.min(x, 10_000_000)) : null)
  return {
    months: n(o.months, DEFAULT_PLAN.months, 1, 12),
    payPct: n(o.payPct, DEFAULT_PLAN.payPct, 1, 80),
    careerPct: n(o.careerPct, DEFAULT_PLAN.careerPct, 0, 100),
    careerGoal: opt(o.careerGoal),
    careerGoalName: typeof o.careerGoalName === 'string' && o.careerGoalName.trim() ? o.careerGoalName.slice(0, 60) : DEFAULT_PLAN.careerGoalName,
    investMonthly: n(o.investMonthly, DEFAULT_PLAN.investMonthly, 0, 1_000_000),
    investRate: typeof o.investRate === 'number' && Number.isFinite(o.investRate) ? Math.max(0, Math.min(12, Math.round(o.investRate * 10) / 10)) : DEFAULT_PLAN.investRate,
    investYears: n(o.investYears, DEFAULT_PLAN.investYears, 1, 40),
    incomeTarget: opt(o.incomeTarget),
    moves: (Array.isArray(o.moves) ? o.moves : []).filter((m: any) => m && typeof m.id === 'string' && typeof m.text === 'string').map((m: any) => ({ id: m.id.slice(0, 40), text: m.text.slice(0, 120), done: m.done === true })).slice(0, 20),
    fundStart: n(o.fundStart, 0, 0, 100_000_000)
  }
}

export function cleanAnswers(raw: unknown): PayAnswer[] {
  const day = /^\d{4}-\d{2}-\d{2}$/
  return (Array.isArray(raw) ? raw : []).filter((a: any) => a && typeof a.txId === 'string' && day.test(a.day) && day.test(a.answered) && Number.isFinite(a.moved)).map((a: any) => ({ txId: a.txId.slice(0, 60), day: a.day, moved: Math.max(0, Math.round(a.moved)), answered: a.answered })).slice(-200)
}

export function cleanSpends(raw: unknown): CareerSpend[] {
  const day = /^\d{4}-\d{2}-\d{2}$/
  return (Array.isArray(raw) ? raw : []).filter((s: any) => s && typeof s.id === 'string' && typeof s.what === 'string' && day.test(s.day) && Number.isFinite(s.lei)).map((s: any) => ({ id: s.id.slice(0, 40), what: s.what.slice(0, 80), lei: Math.max(0, Math.round(s.lei)), day: s.day })).slice(-100)
}

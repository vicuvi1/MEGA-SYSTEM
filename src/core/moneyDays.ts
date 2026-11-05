// Honest money days (pure), from what you logged (FX3):
// - a day counts as logged only when a record for it was made on the day
//   itself (until 04:00 the next morning): not back-dated, not imported;
// - no-spend: nothing spent except bills (rent, subscriptions…) AND you
//   either logged something that day or tapped "Nothing spent today". A day
//   you simply forgot to log pays nothing;
// - cooked at home: only when you confirm it. Groceries in the last 3 days
//   and no eating out only make it a guess (to ask you);
// - under budget: a judged (finished) day with a live log whose everyday
//   spending stayed at or under the daily budget.
const BILL = /bill|rent|chirie|utilit|subscript|abonament|internet|phone|telefon|insurance|asigur|loan|credit|\btax(es)?\b|impozit/i
const EAT_OUT = /restaurant|cafe|café|coffee|cafea|bar\b|delivery|glovo|wolt|fast ?food|takeaway|mcdonald|kfc|pizza|burger|eat(ing)? out|lunch out|dinner out/i
const GROCERY = /grocer|supermarket|market|alimente|linella|kaufland|metro|fourchette|nr ?1|food shop|produse/i

export interface DayTx {
  date: string
  type: string
  category: string
  note?: string
  /** bani (main currency) */
  amount: number
  /** Made on the day itself (see liveLog). Missing = not live. */
  live?: boolean
}

export const isBill = (t: { category: string; note?: string }) => BILL.test(`${t.category} ${t.note ?? ''}`)

/**
 * Was a record for `date` made on that day (or before 04:00 the next
 * morning)? `dayOf` turns a time (ms) into your local day. Imported records
 * (bank statements, sheets) never are.
 */
export function liveLog(date: string, createdAt: number | null | undefined, dayOf: (ms: number) => string, imported = false): boolean {
  if (imported || !Number.isFinite(Number(createdAt)) || !createdAt) return false
  const ms = Number(createdAt)
  return dayOf(ms) === date || dayOf(ms - 4 * 3600_000) === date
}

/** Imported from a bank statement or a sheet (not logged by hand). */
export const isImported = (t: { id?: unknown; source?: unknown }) => /^tg-life-bank-|^imp-|^bank-/.test(String(t.id ?? '')) || /^(bank|import|csv|sheet|xlsx)$/i.test(String(t.source ?? ''))

export interface MoneyDayMarks {
  /** You tapped "Nothing spent today" for this day. */
  nothingSpent?: boolean
  /** You confirmed you cooked at home. */
  cookedConfirmed?: boolean
}

export interface MoneyDay {
  /** A record made on the day itself. */
  logged: boolean
  everydayBani: number
  noSpend: boolean
  /** Confirmed only. */
  cooked: boolean
  /** Groceries lately and no eating out: worth asking "Did you cook at home?". */
  cookedGuess: boolean
}

export function moneyDay(tx: DayTx[], day: string, marks: MoneyDayMarks = {}): MoneyDay {
  const ofDay = tx.filter((t) => t.date.slice(0, 10) === day)
  const spent = ofDay.filter((t) => t.type === 'expense')
  const everyday = spent.filter((t) => !isBill(t))
  const eatOut = everyday.some((t) => EAT_OUT.test(`${t.category} ${t.note ?? ''}`))
  // Groceries in the 3 days up to this one: food at home to cook with.
  const from = new Date(`${day}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 3)
  const start = from.toISOString().slice(0, 10)
  const groceries = tx.some((t) => t.type === 'expense' && t.date.slice(0, 10) >= start && t.date.slice(0, 10) <= day && GROCERY.test(`${t.category} ${t.note ?? ''}`))
  const logged = ofDay.some((t) => t.live === true)
  return {
    logged,
    everydayBani: everyday.reduce((s, t) => s + Math.abs(t.amount || 0), 0),
    noSpend: everyday.length === 0 && (logged || !!marks.nothingSpent),
    cooked: !!marks.cookedConfirmed,
    cookedGuess: !eatOut && groceries
  }
}

/** Under the daily budget on a finished day with a live log (budget 0 = off). */
export function underBudget(d: MoneyDay, budgetBani: number): boolean {
  return budgetBani > 0 && d.logged && d.everydayBani <= budgetBani
}

export interface JudgedMoneyDay extends MoneyDay {
  day: string
  under: boolean
}

/** The finished days from `from` to yesterday, each judged. */
export function judgeMoneyDays(i: { tx: DayTx[]; from: string; today: string; budgetBani: number; nothingSpent?: string[]; cooked?: string[] }): JudgedMoneyDay[] {
  const out: JudgedMoneyDay[] = []
  const nothing = new Set(i.nothingSpent ?? [])
  const cooked = new Set(i.cooked ?? [])
  const d = new Date(`${i.from}T12:00:00Z`)
  for (let day = i.from; day < i.today; ) {
    const m = moneyDay(i.tx, day, { nothingSpent: nothing.has(day), cookedConfirmed: cooked.has(day) })
    out.push({ ...m, day, under: underBudget(m, i.budgetBani) })
    d.setUTCDate(d.getUTCDate() + 1)
    day = d.toISOString().slice(0, 10)
  }
  return out
}

/**
 * FX7: the Money page's Finance Helper numbers (bani, in lei): today, the
 * month and the last `n` days. Bills are not everyday spending; a day shows
 * as logged only with a record made on the day; it is judged once it's over.
 */
export function financeSummary(tx: DayTx[], today: string, n = 14) {
  const exp = tx.filter((t) => t.type === 'expense')
  const sum = (list: DayTx[]) => list.reduce((a, t) => a + Math.abs(t.amount || 0), 0)
  const month = today.slice(0, 7)
  const inMonth = (t: DayTx) => t.date.startsWith(month)
  const days: { day: string; logged: boolean; everydaySpent: number; judged: boolean }[] = []
  const d = new Date(`${today}T12:00:00Z`)
  for (let i = 0; i < n; i++) {
    const day = d.toISOString().slice(0, 10)
    const m = moneyDay(tx, day)
    days.push({ day, logged: m.logged, everydaySpent: m.everydayBani, judged: day < today })
    d.setUTCDate(d.getUTCDate() - 1)
  }
  const t = moneyDay(tx, today)
  return {
    today: { logged: t.logged, everydaySpent: t.everydayBani },
    month: { spent: sum(exp.filter(inMonth)), everyday: sum(exp.filter((x) => inMonth(x) && !isBill(x))), income: sum(tx.filter((x) => x.type === 'income' && inMonth(x))), days: new Set(exp.filter(inMonth).map((x) => x.date)).size },
    days
  }
}

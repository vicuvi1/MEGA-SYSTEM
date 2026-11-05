// No-spend and cooked-at-home days (pure), from Finance Helper's records:
// - no-spend: nothing spent that day except bills (rent, subscriptions…);
// - cooked at home: you bought groceries recently and spent nothing on
//   eating out (restaurants, cafés, delivery, fast food) that day.
const BILL = /bill|rent|chirie|utilit|subscript|abonament|internet|phone|telefon|insurance|asigur|loan|credit|\btax(es)?\b|impozit/i
const EAT_OUT = /restaurant|cafe|café|coffee|cafea|bar\b|delivery|glovo|wolt|fast ?food|takeaway|mcdonald|kfc|pizza|burger|eat(ing)? out|lunch out|dinner out/i
const GROCERY = /grocer|supermarket|market|alimente|linella|kaufland|metro|fourchette|nr ?1|food shop|produse/i

export interface DayTx { date: string; type: string; category: string; note?: string; amount: number }

export function moneyDay(tx: DayTx[], day: string): { noSpend: boolean; cooked: boolean } {
  const spent = tx.filter((t) => t.type === 'expense' && t.date.slice(0, 10) === day)
  const everyday = spent.filter((t) => !BILL.test(`${t.category} ${t.note ?? ''}`))
  const eatOut = everyday.some((t) => EAT_OUT.test(`${t.category} ${t.note ?? ''}`))
  // Groceries in the 3 days up to this one: food at home to cook with.
  const from = new Date(`${day}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 3)
  const start = from.toISOString().slice(0, 10)
  const groceries = tx.some((t) => t.type === 'expense' && t.date.slice(0, 10) >= start && t.date.slice(0, 10) <= day && GROCERY.test(`${t.category} ${t.note ?? ''}`))
  return { noSpend: everyday.length === 0, cooked: !eatOut && groceries }
}

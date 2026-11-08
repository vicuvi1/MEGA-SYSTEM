// Coach chat money fix (2026-11-08): simple money things answered in code, at
// once, with no model call (pure, tested). "spent 55 lei on food", "add 55 mdl
// food", "am cheltuit 55 lei pe mancare", "потратил 55 лей на еду" (a log);
// "what did I spend today?", "where did 70 come from?" (today's records, with
// their M-numbers and categories); "delete that one", "delete the gaming one"
// (a confirm chip with the exact record first); "how much is left this
// month?". Every number comes from the records handed in (benGround rule).
// Open advice ("should I cut food?") is left to the model.
import { notMoney } from './moneyGuess'

const fold = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const clean = (s: string) => fold(s).replace(/[!?.…]+$/g, '').replace(/\s+/g, ' ').trim()

/** Words for "money in your own currency" (lei); other currencies go to the model. */
const LEI = '(?:lei|leu|mdl|ron|лей|леи|леев|лея)' // ("лей" loses its breve when folded: "леи")
const NUM = '(\\d{1,6}(?:[.,]\\d{1,2})?)'
/** Not a spending day we can be sure of: the model decides. */
const OTHER_DAY = /\b(yesterday|ieri|alaltaieri|tomorrow|maine|last (week|month|night)|on (mon|tue|wed|thu|fri|sat|sun))\w*|вчера|завтра/
const OTHER_CUR = /(\$|€|£|\b(usd|eur|euro|dollars?|gbp|rub|рубл))/
const NOT_A_LOG = /\b(how|what|why|should|could|would|can|did|do i|budget|left|afford|plan|limit|income|earn(ed)?|salary|got paid|save|saving|owe|lend|lent|borrow)\b|\?/

export interface SpendLog {
  /** In lei (whole or with bani). */
  amount: number
  /** What it was for ("food"), as he said it. */
  note: string
}

/**
 * A spending he logs: "spent 55 lei on food", "add that I spent 55 mdl today for
 * food", "add 55 mdl food", "55 food", "food 55 lei", "am cheltuit 55 lei pe
 * mancare", "потратил 55 лей на еду". Null for anything else (a question,
 * another day, another currency, water, reps…).
 */
export function readSpend(text: string): SpendLog | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 90 || raw.startsWith('/')) return null
  const t = clean(raw).replace(/^(ok|okay|hey|ben|please|pls)[,\s]+/, '')
  if (NOT_A_LOG.test(t) || OTHER_DAY.test(t) || OTHER_CUR.test(t)) return null
  if ((t.match(/\d+(?:[.,]\d+)?/g) ?? []).length !== 1) return null
  if (/\d\s*(min|mins|minutes?|h|hrs?|hours?|ore|km|kg|g|ml|l|reps?|sets?|times|steps|pages|x)\b|\b(water|apa|protein|pushups?|squats?|plank|sleep|slept|focus|study|studied)\b|вод|минут|час/.test(t)) return null
  const today = /\s*\b(today|azi|astazi)\b|\s*сегодня/g
  const s = t.replace(today, ' ').replace(/\s+/g, ' ').trim()
  if (notMoney(s)) return null
  const forWord = '(?:on|for|at|pe|la|pentru|на|за)'
  const lead = "(?:(?:please |pls )?(?:add|log|note|put|write|record|track)(?: (?:down|in))?(?: (?:that|it))?(?: i)? )?"
  const spent = "(?:i )?(?:spent|spend|paid|pay|bought|am cheltuit|cheltuit|am dat|am platit|platit|am luat|потратил[аи]?|трата|заплатил[аи]?|купил[аи]?)"
  const pats = [
    // "(add that) i spent 55 (lei) (on|for) food"
    new RegExp(`^${lead}${spent} ${NUM}(?: ?${LEI})? (?:${forWord} )?(.{2,40})$`),
    // "add 55 mdl food", "add 55 lei for food"
    new RegExp(`^(?:add|log|track|put|note|record) ${NUM}(?: ?${LEI})? (?:${forWord} )?(.{2,40})$`),
    // "55 lei on food", "55 lei food", "55 food" (a short note only)
    new RegExp(`^${NUM}(?: ?${LEI})? (?:${forWord} )?([\\p{L}][\\p{L} '-]{1,24})$`, 'u'),
    // "food 55", "food 55 lei", "spent on food 55"
    new RegExp(`^(?:${spent} )?(?:${forWord} )?([\\p{L}][\\p{L} '-]{1,24}?) ${NUM}(?: ?${LEI})?$`, 'u')
  ]
  for (let i = 0; i < pats.length; i++) {
    const m = pats[i].exec(s)
    if (!m) continue
    const [num, what] = i === 3 ? [m[2], m[1]] : [m[1], m[2]]
    const amount = Math.round(Number(num.replace(',', '.')) * 100) / 100
    const note = what.replace(new RegExp(`\\b${LEI}\\b|^${LEI}\\s|\\s${LEI}$`, 'g'), ' ').replace(/^(the|a|an|some)\s+/, '').replace(/\s+/g, ' ').trim()
    if (!(amount > 0) || amount > 200_000 || !note || note.split(' ').length > 4) return null
    // A bare "55 food" must not read a time, a count or a log of something else.
    if (i >= 2 && /\b(min|mins|minutes|h|hours?|km|kg|g|ml|l|reps?|pushups?|squats?|times|steps|pages|lei)\b/.test(note)) return null
    return { amount, note }
  }
  return null
}

export type MoneyAsk =
  /** "what did I spend today", "where did 70 come from" (`mentioned`: the 70). */
  | { kind: 'today'; mentioned: number | null }
  /** "how much is left this month", "how much can I spend". */
  | { kind: 'left' }
  /** "how much did I spend this month" (the chip under "how much have I earned"). */
  | { kind: 'month' }
  /** "delete that one", "delete the last one", "delete the gaming one", "remove the 15 lei one". */
  | { kind: 'delete'; hint: string; amount: number | null }

/** A simple money question or delete Ben answers in code; null for anything else. */
export function moneyAsk(text: string): MoneyAsk | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 90) return null
  const t = clean(raw).replace(/^(ok|okay|hey|ben|wait|hm+|so|and)[,\s]+/, '').replace(/^(ok|okay|wait)[,\s]+/, '')
  if (t.split(' ').length > 14) return null
  if (/\b(why|should|could|would|tips?|advice|improve|cut|reduce|plan|week|yesterday|ieri|вчера|last month)\b/.test(t)) return null
  // Delete one record (never "undo": that takes back Ben's last action).
  const del = /^(?:please |pls )?(?:delete|remove|erase|sterge|șterge|удали(?:ть)?)(?: it| that| this)?(?: (?:one|record|entry|expense|spending))?(?: (.*))?$/.exec(t)
  if (del) {
    let hint = (del[1] ?? '').replace(/^(the|that|this)\s+/, '').replace(/\b(one|record|entry|expense|spending|from (finance|money)( helper)?|please)\b/g, ' ').replace(/\s+/g, ' ').trim()
    if (/^(last|latest|newest)$|^(last|latest) (one|record)$/.test(hint)) hint = 'last'
    if (/\b(task|event|habit|reminder|note|block|goal|reward|todo|meeting|alarm|memory)\b/.test(hint)) return null
    const am = /^m\d{1,2}$/.test(hint.replace(/\s+/g, '')) ? null : /(\d{1,6})(?:\s?(?:lei|mdl|leu))?/.exec(hint)
    return { kind: 'delete', hint: am ? hint.replace(am[0], '').trim() : hint, amount: am ? Number(am[1]) : null }
  }
  if (/\b(left|remaining|ramas|can i (still )?spend|safe to spend)\b|осталось/.test(t) && /\b(month|budget|spend|money|lei|luna|limit)\b|месяц|бюджет/.test(t) && !/\b(water|protein|habits?|tasks?|focus|points?)\b/.test(t)) return { kind: 'left' }
  if (/^(?:how much|what) (?:did|have) i (?:spend|spent)(?: so far)? this month$|^(?:my )?spending this month$|^(?:cat|ce) am cheltuit (?:luna asta|in luna asta)$|^сколько (?:я )?потратил[аи]? (?:в этом месяце|за месяц)$/.test(t)) return { kind: 'month' }
  // "where did 70 come from", "where you got 70 from", "what is the 70 lei"
  const from = /\bwhere\b.*?(\d{1,6})(?:\s?(?:lei|mdl))?\b.*\bfrom\b|\bwhat(?:'s| is| are)? (?:the|that|those) (\d{1,6})(?:\s?(?:lei|mdl))?\b/.exec(t)
  if (from) return { kind: 'today', mentioned: Number(from[1] ?? from[2]) }
  if (/^(?:what|how much|show|list|which)\b.*\b(spen[dt]|spending|expenses?|bought|records?|paid)\b.*\btoday\b|^(?:my |today'?s? )(spending|expenses)( today)?$|^(?:ce|cat) am cheltuit azi|^сколько (?:я )?потратил[аи]? сегодня/.test(t)) return { kind: 'today', mentioned: null }
  return null
}

/** One money record for an answer (amounts in bani; ref = the M-number in Ben's list). */
export interface MoneyRow {
  id: string
  ref: string
  date: string
  amount: number
  currency: string
  category: string
  note: string
  type: 'expense' | 'income'
  /** Bought with points in Rewards (life-reward-…): not real money. */
  fromRewards?: boolean
}

export interface MoneyAnswer {
  reply: string
  chips: string[]
  read: string
  buttons?: { label: string; do: string }[]
}

const money = (bani: number, cur = 'MDL') => {
  const v = Math.round(Math.abs(bani)) / 100
  const s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2)
  return `${s} ${cur === 'MDL' ? 'lei' : cur}`
}
export const rowLine = (r: MoneyRow) => `${r.ref} ${money(r.amount, r.currency)} · ${r.category}${r.note && r.note.toLowerCase() !== r.category.toLowerCase() ? ` "${r.note.slice(0, 40)}"` : ''}${r.fromRewards ? ' (from Rewards, points)' : ''}`

/** "Today: 70 lei in 2 records: M1 55 lei · Food, M2 15 lei · Reward." */
export function todayAnswer(rows: MoneyRow[] | null, today: string, mentioned: number | null): MoneyAnswer {
  if (!rows) return { reply: "I can't see your Finance Helper data on this device, so I can't list today's spending.", chips: ['What now?'], read: 'Finance Helper data not available' }
  const list = rows.filter((r) => r.date === today && r.type === 'expense')
  if (!list.length) return { reply: 'You have no spending recorded today.', chips: ['How much is left this month?'], read: 'Read Finance Helper (no records today)' }
  const total = list.reduce((t, r) => t + Math.abs(r.amount), 0)
  const lines = [
    mentioned != null && Math.round(total / 100) === mentioned ? `Today's ${money(total)} is ${list.length === 1 ? 'one record' : `${list.length} records`}:` : `Today you spent ${money(total)} in ${list.length === 1 ? 'one record' : `${list.length} records`}:`,
    ...list.map((r) => `• ${rowLine(r)}`)
  ]
  if (mentioned != null && Math.round(total / 100) !== mentioned) {
    const hit = list.find((r) => Math.round(Math.abs(r.amount) / 100) === mentioned)
    lines.push(hit ? `The ${mentioned} lei is ${hit.ref}.` : `None of today's records add up to ${mentioned} lei.`)
  }
  const pts = list.filter((r) => r.fromRewards)
  if (pts.length) lines.push(`${pts.map((r) => r.ref).join(', ')} came from a Rewards buy with points, not real money. Say "delete ${pts[0].ref}" to take it out.`)
  return { reply: lines.join('\n'), chips: [`Delete ${list[0].ref}`, 'How much is left this month?'], read: `Read Finance Helper (${list.length} record${list.length === 1 ? '' : 's'} today)` }
}

/** Which record "delete the gaming one" / "delete that one" / "delete M2" means: one row, or null with a reason. */
export function pickToDelete(rows: MoneyRow[], ask: Extract<MoneyAsk, { kind: 'delete' }>): { row: MoneyRow | null; why?: string } {
  if (!rows.length) return { row: null, why: 'I see no money records from the last few days to delete.' }
  const ref = /^m(\d{1,2})$/.exec(ask.hint.replace(/\s+/g, ''))
  if (ref) {
    const r = rows.find((x) => x.ref.toLowerCase() === `m${ref[1]}`)
    return r ? { row: r } : { row: null, why: `There is no ${ask.hint.toUpperCase()} in your recent records.` }
  }
  let list = rows
  if (ask.amount != null) list = list.filter((r) => Math.round(Math.abs(r.amount) / 100) === ask.amount)
  const words = fold(ask.hint).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !['last', 'that', 'this', 'the', 'one'].includes(w))
  if (words.length) {
    const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '')
    list = list.filter((r) => {
      const hay = fold(`${r.note} ${r.category}${r.fromRewards ? ' reward rewards points' : ''}`)
      return words.some((w) => hay.includes(stem(w)) || hay.split(/[^\p{L}\p{N}]+/u).some((h) => h.length >= 3 && stem(w).startsWith(stem(h))))
    })
  }
  if (!list.length) return { row: null, why: `I can't find a record like "${[ask.amount != null ? `${ask.amount} lei` : '', ask.hint].filter(Boolean).join(' ')}" in the last few days.` }
  // "that one" / "the last one" / several matches: the newest (rows are newest first).
  return { row: list[0] }
}

/** The confirm card before a delete: the exact record, and one tap to delete it. */
export function deleteAsk(row: MoneyRow, tapId: string): MoneyAnswer {
  const what = `${money(row.amount, row.currency)} · ${row.category}${row.note && row.note.toLowerCase() !== row.category.toLowerCase() ? ` "${row.note.slice(0, 30)}"` : ''}`
  return {
    reply: `Delete this record from Finance Helper?\n• ${row.ref} ${what} (${row.date})${row.fromRewards ? '\nIt came from a Rewards buy with points, so it is not real spending.' : ''}`,
    chips: ['No, keep it'],
    read: 'Read Finance Helper (found the record)',
    buttons: [{ label: `🗑 Yes, delete ${row.ref}`.slice(0, 40), do: `say:✓${tapId} Yes, delete ${row.ref} ${what}`.slice(0, 120) }]
  }
}

/** "How much is left this month": Finance Helper's monthly limit, spent so far, safe per day. Amounts in bani. */
export function leftAnswer(d: { spentMonth: number; limit: number | null; limitLeft: number | null; safeToday: number | null } | null): MoneyAnswer {
  if (!d) return { reply: "I can't see your Finance Helper data on this device, so I don't know what is left.", chips: ['What now?'], read: 'Finance Helper data not available' }
  if (d.limit == null || d.limitLeft == null) return { reply: `You spent ${money(d.spentMonth)} this month. You have no monthly limit set in Finance Helper, so I can't say what is left.\nSet one in Finance Helper → Plan and I'll count down from it.`, chips: ['What did I spend today?'], read: 'Read Finance Helper (no monthly limit)' }
  const lines = d.limitLeft >= 0
    ? [`You have ${money(d.limitLeft)} left this month (spent ${money(d.spentMonth)} of ${money(d.limit)}).`, ...(d.safeToday != null ? [`That is about ${money(d.safeToday)} a day until the month ends.`] : [])]
    : [`You are ${money(-d.limitLeft)} over this month's limit (spent ${money(d.spentMonth)} of ${money(d.limit)}).`, 'Try a no-spend day tomorrow.']
  return { reply: lines.join('\n'), chips: ['What did I spend today?'], read: 'Read Finance Helper (this month)' }
}

/** "You spent 1,900 lei this month: Food 1,200 lei, Transport 400 lei…" Amounts in bani. */
export function monthAnswer(d: { spentMonth: number; limit: number | null; byCategory: { name: string; amount: number }[]; records: number } | null): MoneyAnswer {
  if (!d) return { reply: "I can't see your Finance Helper data on this device, so I can't add up this month.", chips: ['What now?'], read: 'Finance Helper data not available' }
  if (!d.records) return { reply: 'You have no spending recorded this month yet.', chips: ['What did I spend today?'], read: 'Read Finance Helper (no records this month)' }
  const top = [...d.byCategory].sort((a, b) => b.amount - a.amount).slice(0, 3).map((c) => `${c.name} ${money(c.amount)}`)
  const lines = [`You spent ${money(d.spentMonth)} this month (${d.records} record${d.records === 1 ? '' : 's'}).`, ...(top.length ? [`Most of it: ${top.join(', ')}.`] : [])]
  if (d.limit != null) lines.push(d.spentMonth <= d.limit ? `That leaves ${money(d.limit - d.spentMonth)} of your ${money(d.limit)} limit.` : `That is ${money(d.spentMonth - d.limit)} over your ${money(d.limit)} limit.`)
  return { reply: lines.join('\n'), chips: ['What did I spend today?', 'How much is left this month?'], read: `Read Finance Helper (${d.records} record${d.records === 1 ? '' : 's'} this month)` }
}

// Bank statement CSV → money records. Pure: works on the text in memory
// (the file itself is never stored). Reads the date, amount and description
// columns of most bank exports (comma, semicolon or tab; decimal comma or
// point; one signed amount column or separate debit/credit columns).

export interface BankRow {
  date: string // YYYY-MM-DD
  amount: number // lei; negative = money out
  description: string
}

export interface BankParse {
  rows: BankRow[]
  /** Lines that looked like data but couldn't be read. */
  bad: number
  /** True when every amount was positive in one column (read as spending). */
  allPositive: boolean
}

/** Splits one CSV line (quotes may hold the delimiter and "" is a quote). */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

/** "-1.234,56 MDL", "(12.50)", "1 234.56" → a number, or null. */
export function parseAmount(raw: string): number | null {
  let s = String(raw ?? '').replace(/[\s ']/g, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[^\d.,+-]/g, '')
  if (s.startsWith('-')) neg = !neg
  s = s.replace(/^[+-]/, '').replace(/[+-]$/, (m) => {
    if (m === '-') neg = !neg
    return ''
  })
  if (!/\d/.test(s) || /[+-]/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    s = s.split(dec === '.' ? ',' : '.').join('').replace(',', '.')
  } else if (lastComma >= 0) {
    // "12,50" is a decimal comma; "1,234" is a thousands comma.
    s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.split(',').join('')
  } else if (s.split('.').length > 2) s = s.split('.').join('')
  const n = Number(s)
  return Number.isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null
}

/** "05.11.2026", "2026-11-05 14:02", "5/11/26" → "2026-11-05" (day first, like European banks). */
export function parseDate(raw: string): string | null {
  const s = String(raw ?? '').trim()
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s)
  let y: number, mo: number, d: number
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else {
    m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})\b/.exec(s)
    if (!m) return null
    ;[d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (y < 100) y += 2000
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const H = {
  date: /^(date|data|дата)|booking|posted|transaction ?date|operat|value ?date/i,
  amount: /amount|^sum|suma|sumă|сумма|valoare|^value$/i,
  debit: /debit|withdraw|paid ?out|cheltuiel|расход|^out$|spent/i,
  credit: /credit|deposit|paid ?in|incas|încas|приход|^in$|received/i,
  desc: /desc|detail|detalii|merchant|payee|narrat|beneficiar|описан|info|comment|purpose|destina|reference|partner/i
}

function pickDelim(lines: string[]): string {
  const counts = [';', ',', '\t'].map((d) => ({ d, n: lines.slice(0, 10).reduce((t, l) => t + splitLine(l, d).length - 1, 0) }))
  return counts.sort((a, b) => b.n - a.n)[0].d
}

/** Reads a bank CSV. */
export function parseBankCsv(text: string): BankParse {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], bad: 0, allPositive: false }
  const delim = pickDelim(lines)
  const table = lines.map((l) => splitLine(l, delim))
  // The header: the first of the top lines that names a date and an amount (or debit/credit).
  let head = -1
  let col = { date: -1, amount: -1, debit: -1, credit: -1, desc: -1 }
  for (let i = 0; i < Math.min(20, table.length); i++) {
    const cells = table[i]
    const find = (re: RegExp, not: number[] = []) => cells.findIndex((c, k) => re.test(c) && !not.includes(k))
    const date = find(H.date)
    const amount = find(H.amount, [date])
    const debit = find(H.debit, [date])
    const credit = find(H.credit, [date, debit])
    if (date >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      head = i
      col = { date, amount, debit, credit, desc: find(H.desc, [date, amount, debit, credit]) }
      break
    }
  }
  const body = head >= 0 ? table.slice(head + 1) : table
  if (head < 0) {
    // No header: the first date column, the last number column, the longest text column.
    const sample = body.slice(0, 10)
    const n = Math.max(...sample.map((r) => r.length))
    const share = (k: number, f: (s: string) => boolean) => sample.filter((r) => f(r[k] ?? '')).length / sample.length
    const isNum = (s: string) => /\d/.test(s) && parseAmount(s) != null && parseDate(s) == null
    for (let k = 0; k < n; k++) if (col.date < 0 && share(k, (s) => parseDate(s) != null) >= 0.6) col.date = k
    for (let k = n - 1; k >= 0; k--) if (col.amount < 0 && k !== col.date && share(k, isNum) >= 0.6) col.amount = k
    let best = 0
    for (let k = 0; k < n; k++) {
      if (k === col.date || k === col.amount) continue
      const len = sample.reduce((t, r) => t + (isNum(r[k] ?? '') ? 0 : (r[k] ?? '').length), 0)
      if (len > best) [best, col.desc] = [len, k]
    }
  }
  const rows: BankRow[] = []
  let bad = 0
  for (const r of body) {
    const date = parseDate(r[col.date] ?? '')
    let amount: number | null = null
    if (col.amount >= 0) amount = parseAmount(r[col.amount] ?? '')
    else {
      const d = parseAmount(r[col.debit] ?? '')
      const c = parseAmount(r[col.credit] ?? '')
      if (d) amount = -Math.abs(d)
      else if (c) amount = Math.abs(c)
    }
    if (!date || amount == null || amount === 0) {
      // Totals and empty lines at the end aren't errors; a line with a date is.
      if (date) bad++
      continue
    }
    const description = (col.desc >= 0 ? r[col.desc] : r.filter((_, k) => k !== col.date && k !== col.amount).join(' ')) ?? ''
    rows.push({ date, amount, description: description.replace(/\s+/g, ' ').trim().slice(0, 120) })
  }
  const allPositive = col.amount >= 0 && rows.length > 0 && rows.every((x) => x.amount > 0)
  return { rows, bad, allPositive }
}

/** FNV-1a: a short, stable fingerprint (no crypto needed: it only spots repeats). */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The same date + amount + description is the same payment (even from another export). */
export const rowHash = (r: BankRow) => fingerprint(`${r.date}|${r.amount.toFixed(2)}|${r.description.toLowerCase().replace(/\s+/g, ' ').trim()}`)

/** Drops repeats inside one file. */
export function uniqueRows(rows: BankRow[]): BankRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const h = rowHash(r)
    if (seen.has(h)) return false
    seen.add(h)
    return true
  })
}

const CATS: [string, RegExp][] = [
  ['bills', /\b(orange|moldcell|starnet|premier energy|moldovagaz|apa.?canal|internet|utility|utilit|electric|netflix|spotify|youtube|icloud|subscription|abonament)\b/i],
  ['health', /\b(farm|pharm|clinic|medical|dental|dent|spital|hospital)\w*/i],
  ['transit', /\b(bolt(?! food)|uber|yandex|taxi|petrom|lukoil|rompetrol|fuel|benzin|parking|bus|train|cfm)\b/i],
  ['food', /\b(cafe|caf[eé]|restaurant|pizza|kfc|mcdonald|burger|starbucks|coffee|bolt food|glovo|wolt|straus|andy)\w*/i],
  ['groceries', /\b(linella|kaufland|fidesco|nr ?1|green hills|supermarket|market|grocery|lidl|metro cash)\b/i],
  ['shopping', /\b(amazon|emag|aliexpress|temu|zara|h&m|shop|store|mall|darwin|enter)\b/i]
]

/** A guess at the category from the description (Finance Helper's own rules can change it). */
export function guessCategory(description: string): string {
  return CATS.find(([, re]) => re.test(description))?.[0] ?? 'other'
}

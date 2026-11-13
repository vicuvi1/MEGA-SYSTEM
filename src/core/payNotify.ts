// Phone payment notifications → one payment (pure, no I/O). The owner pays by
// NFC; MacroDroid on his Android phone sends each bank / wallet notification
// ({app, title, text, time}) to /api/cron?job=pay, and the same text can be
// pasted to the finance bot. This file reads it:
//   maib (Romanian and Russian wording), Google Wallet, Revolut, Paynet, and a
//   generic fallback for any other app.
// Rules: an amount is read only from a number next to a currency, never
// guessed; a balance or a fee is never the amount; a declined payment, money
// in (a transfer received, a top-up) and codes are not payments. Every "no"
// carries a reason, so nothing is dropped silently.
// Made-up examples for each source: payNotify.fixtures.ts (with the spot to
// paste the shape of real ones).

export type PaySource = 'maib' | 'gwallet' | 'revolut' | 'paynet' | 'generic'

export interface PayNotice {
  /** The app's name (MacroDroid's app name), e.g. "maib", "Google Wallet". */
  app?: string
  title?: string
  text?: string
}

export interface PayOk {
  ok: true
  /** Cents (bani) of `currency`, always > 0. */
  amount: number
  /** ISO code: MDL, EUR, USD… */
  currency: string
  /** The shop, as the notification wrote it ('' when it names none). */
  merchant: string
  /** When it happened (ms). */
  at: number
  source: PaySource
  /** The card's last 4 digits, when the text shows them. */
  last4?: string
  /** Money back (a refund or a reversal), not spending. */
  refund?: boolean
  /** The notification as it came (title and text, at most 1 000 characters). */
  raw: string
}

export interface PayNo {
  ok: false
  /** declined: the bank refused it · not-payment: money in, a code, a promo · unreadable: no amount or currency. */
  kind: 'declined' | 'not-payment' | 'unreadable'
  /** Plain words for Settings → Phone payments. */
  reason: string
  source: PaySource
  raw: string
}

export type PayResult = PayOk | PayNo

/** Currencies a payment may be in (Finance Helper's list). */
export const PAY_CURRENCIES = ['MDL', 'EUR', 'USD', 'RON', 'GBP', 'UAH', 'CHF', 'PLN', 'TRY', 'CAD'] as const

/** Two notifications of one payment (maib and Google Wallet) arrive within this window. */
export const TWIN_WINDOW_MS = 5 * 60_000

const SOURCE_TESTS: [PaySource, RegExp][] = [
  ['gwallet', /google\s*(wallet|pay)|walletnfcrel|com\.google\.android\.apps\.wallet|\bgpay\b/i],
  ['revolut', /revolut/i],
  ['paynet', /paynet/i],
  ['maib', /\bmaib\b|md\.maib|moldova\s*agroindbank|maibank/i]
]

/** Which app sent it: the app name first, then the title, then the text. */
export function paySource(n: PayNotice): PaySource {
  for (const part of [n.app, n.title, n.text]) {
    const s = String(part ?? '')
    if (!s) continue
    for (const [src, re] of SOURCE_TESTS) if (re.test(s)) return src
  }
  return 'generic'
}

// ---- amounts ---------------------------------------------------------------

const CODES = 'MDL|EUR|USD|RON|GBP|UAH|CHF|PLN|TRY|CAD'
const SYMBOLS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '₴': 'UAH' }
const WORDS: [RegExp, string][] = [
  [/^(lei|leu|лей|леев|лея)$/i, 'MDL'],
  [/^(euro|eur|евро)$/i, 'EUR'],
  [/^(usd|dollars?|долл?\.?)$/i, 'USD']
]
// A number: 1 234,56 · 1.234,56 · 1,234.56 · 12,5 · 1234. Never the middle of a longer number.
const NUM = String.raw`(?<![\d.,:*•·])(\d{1,3}(?:[ \u00a0\u202f.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])`
const SIGN = String.raw`([+\-−–]?)\s?`
const AFTER_WORD = String.raw`(?![\p{L}])`
const AMOUNT_RES: { re: RegExp; num: number; cur: number; sign: number }[] = [
  // €12.50 · -€12.50 · MDL 123.45
  { re: new RegExp(String.raw`${SIGN}(€|\$|£|₴|(?<![\p{L}])(?:${CODES})${AFTER_WORD})\s?${SIGN}${NUM}`, 'giu'), sign: 1, cur: 2, num: 4 },
  // 123,45 MDL · -35.00 lei · 12,50 €
  { re: new RegExp(String.raw`${SIGN}${NUM}\s?(€|\$|£|₴|(?:${CODES}|lei|leu|лей|леев|лея|euro|евро)${AFTER_WORD})`, 'giu'), sign: 1, num: 2, cur: 3 }
]

/** "1 234,56" → 123456 cents; null when it isn't a plain amount. */
export function parseAmount(s: string): number | null {
  let t = String(s ?? '').replace(/[\s\u00a0\u202f]/g, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','))
  let int = t
  let frac = ''
  if (last >= 0) {
    const tail = t.slice(last + 1)
    if (tail.length === 1 || tail.length === 2) {
      int = t.slice(0, last)
      frac = tail
    } else if (tail.length !== 3) return null
  }
  // What is left of the separators groups thousands (three digits each).
  const groups = int.split(/[.,]/)
  if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3)) return null
  int = groups.join('')
  if (!/^\d+$/.test(int)) return null
  t = `${int}.${frac.padEnd(2, '0')}`
  const cents = Math.round(Number(t) * 100)
  return Number.isFinite(cents) ? cents : null
}

function currencyOf(token: string): string | null {
  const t = token.trim()
  if (SYMBOLS[t]) return SYMBOLS[t]
  const up = t.toUpperCase()
  if ((PAY_CURRENCIES as readonly string[]).includes(up)) return up
  for (const [re, code] of WORDS) if (re.test(t)) return code
  return null
}

interface AmountHit {
  amount: number
  currency: string
  sign: '' | '+' | '-'
  index: number
  end: number
}

// A balance, a limit, a fee or a cashback is never the payment's amount.
const NOT_AMOUNT_BEFORE = /(sold|balan[tț]|disponibil|limit|comision|tax[aă]|остаток|баланс|доступно|лимит|комисси|balance|available|fee|cashback|кешбэк|кэшбэк)[^\d\n]{0,25}$/iu

/** Every amount next to a currency, in text order (balances and fees left out). */
export function payAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = []
  for (const { re, num, cur, sign } of AMOUNT_RES) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const amount = parseAmount(m[num])
      const currency = currencyOf(m[cur])
      if (amount == null || !currency) continue
      if (NOT_AMOUNT_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue
      const sg = (m[sign] || (AMOUNT_RES[0].re === re ? m[3] : '') || '').trim()
      hits.push({ amount, currency, sign: sg === '+' ? '+' : sg ? '-' : '', index: m.index, end: m.index + m[0].length })
    }
  }
  // The same spot can match both ways ("MDL 12 EUR"): keep the first, earliest one.
  hits.sort((a, b) => a.index - b.index)
  return hits.filter((h, i) => !hits.slice(0, i).some((o) => h.index < o.end && o.index < h.end))
}

// ---- what kind of notification ----------------------------------------------

const DECLINED = /(declin|respins|refuz|neaprobat|nu a fost aprobat|e[sș]uat|nereu[sș]it|insuficient|blocat|отклон|отказ|недостаточно|не\s*прошл|не\s*выполнен|failed|unsuccessful|not approved|was not completed|insufficient)/iu
const REFUND = /(refund|rambursa|returnare|stornare|anulare|reversal|reversed|returned|возврат|отмена\s+операции|сторно)/iu
const MONEY_IN = /(ai primit|a[țt]i primit|primit[aă]?\b|received|you got|incoming|alimentare|suplinire|transfer primit|intrare|зачислен|поступлени|пополнени|получен|top[\s-]?up|added to your|salary|salariu|зарплат)/iu
const CODE = /((?:cod(?:ul)?|code|код|parol[aă]|password|пароль)(?![\p{L}])[^\n]{0,40}(?:confirm|verific|подтвержд|одноразов|otp|3-?d)|\botp\b|3-?d\s*secure)/iu
const PAYMENT = /(plat[aă]|plăți|achit|tranzac[tț]i|cump[aă]r|pay|paid|payment|purchase|spent|charged|debit|card\s*\*|оплат|покупк|списан|транзакц|платеж|платёж)/iu

// ---- merchant ----------------------------------------------------------------

const LABEL = /(?:comerciant|merchant|magazin|loca[tț]ie|beneficiar|destinatar|место|торговец|получатель|магазин)\s*[:\-–]\s*([^\n;]+)/iu
const BEFORE_SHOP = String.raw`(?:de\s+la|c[aă]tre|catre|la|at|to|în|in|pe|в|во|у|от|from)`
const SHOP_END = String.raw`(?=\s+(?:cu|with|using|card|карт|on|via|prin|pe\s+card|\d{1,2}[.:/]\d{2})|\s*[\n;(]|[,.]\s|\.?$)`
const AFTER_AMOUNT = new RegExp(String.raw`^\s*[,.:]?\s*${BEFORE_SHOP}\s+(.+?)${SHOP_END}`, 'iu')
const PHRASE = new RegExp(String.raw`(?:payment to|paid to|paid at|spent at|purchase at|you paid|plat[aă]\s+(?:la|c[aă]tre)|achitare\s+la|cump[aă]r[aă]tur[aă]\s+la|оплата\s+в|покупка\s+в|оплата\s+у)\s+(.+?)${SHOP_END}`, 'iu')
// Words that are never a shop (a title like "Plată" or "Payment").
const NOT_SHOP = /^(plat[aă]|plăți|tranzac[tț]i[ea]?(\s+reu[sș]it[aă])?|payment|paid|purchase|оплата|покупка|транзакция|списание|notification|notificare|card|google\s*(wallet|pay)|wallet|revolut|maib|paynet|you paid|refund|возврат|rambursare|\d+)$/iu
const CARD_ONLY = /^(?:card|карта|visa|mastercard|mc|debit)?\s*(?:\*+|•+|x+|nr\.?)?\s*\d{4}$/iu

function cleanShop(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim()
  t = t.replace(/^[-–:,.\s"'«]+|[-–:,.\s"'»!]+$/g, '')
  for (let i = 0; i < 2; i++) t = t.replace(/\s+(?:md|mda|moldova|chi[sș]in[aă]u|кишин[её]в)$/iu, '').trim()
  if (!/\p{L}/u.test(t) || NOT_SHOP.test(t) || CARD_ONLY.test(t)) return ''
  return t.slice(0, 60)
}

function merchantOf(text: string, title: string, hit: AmountHit, source: PaySource, app: string): string {
  const label = LABEL.exec(text)
  if (label) {
    const s = cleanShop(label[1].split(/[,;]|\s{2,}/)[0])
    if (s) return s
  }
  const after = AFTER_AMOUNT.exec(text.slice(hit.end))
  if (after) {
    const s = cleanShop(after[1])
    if (s) return s
  }
  const phrase = PHRASE.exec(text) ?? PHRASE.exec(title)
  if (phrase) {
    const s = cleanShop(phrase[1].replace(new RegExp(`${NUM}.*$`, 'u'), '').replace(/[€$£₴]\s*$/u, ''))
    if (s) return s
  }
  // Google Wallet (and some apps) put the shop in the title.
  const t = cleanShop(title)
  if (t && !(app && t.toLowerCase() === app.trim().toLowerCase()) && !PAYMENT.test(t) && !DECLINED.test(t)) return t
  // A line of its own with letters and no amount (maib writes the shop on its own line).
  for (const line of text.split(/\n|\s{2,}/)) {
    if (payAmounts(line).length || PAYMENT.test(line) || /\d{2}[.:/]\d{2}/.test(line)) continue
    const s = cleanShop(line)
    if (s && s.length >= 2) return s
  }
  void source
  return ''
}

const LAST4 = /(?:\*{1,6}|•{2,}|·{2,}|x{2,}|card\s*(?:nr\.?\s*)?|карт[аыу]?\s*(?:№\s*)?)\s?(\d{4})(?!\d)/iu

/**
 * Reads one notification. `at`: when it came (ms). Returns the payment, or
 * why it isn't one (never a guessed amount).
 */
export function parsePayNotification(n: PayNotice, opts: { at: number }): PayResult {
  const app = String(n.app ?? '').trim()
  const title = String(n.title ?? '').trim()
  const body = String(n.text ?? '').trim()
  const raw = [title, body].filter(Boolean).join('\n').slice(0, 1000)
  const source = paySource(n)
  const all = `${title}\n${body}`
  const no = (kind: PayNo['kind'], reason: string): PayNo => ({ ok: false, kind, reason, source, raw })
  if (!body && !title) return no('unreadable', 'The notification was empty')
  if (/\[(?:notification|not_title|notification_title|app_name)[^\]]*\]/i.test(all)) return no('unreadable', 'MacroDroid sent the placeholder, not the text: insert it with the magic text button')
  if (DECLINED.test(all)) return no('declined', 'A declined payment: nothing was spent')
  if (CODE.test(all)) return no('not-payment', 'A code or a security message, not a payment')
  const refundWords = REFUND.test(all)
  // Read the amount from the text first, then from the title (Google Wallet may put it there).
  const fromBody = payAmounts(body)
  const fromTitle = payAmounts(title)
  const hit = fromBody[0] ?? fromTitle[0]
  if (!hit) return no('unreadable', 'No amount with a currency in it')
  const inText = fromBody[0] ? body : title
  if (!(hit.amount > 0)) return no('unreadable', 'The amount is zero')
  if (hit.amount > 100_000_000) return no('unreadable', 'The amount is too big to be a card payment')
  if (!refundWords && MONEY_IN.test(all)) return no('not-payment', 'Money in (a transfer or a top-up), not a payment')
  if (source === 'generic' && !refundWords && !PAYMENT.test(all)) return no('not-payment', 'No payment words in it (paid, payment, plată, оплата…)')
  const refund = refundWords || hit.sign === '+'
  const card = LAST4.exec(all)
  const merchant = merchantOf(inText, inText === title ? '' : title, hit, source, app)
  return {
    ok: true,
    amount: hit.amount,
    currency: hit.currency,
    merchant,
    at: opts.at,
    source,
    ...(card ? { last4: card[1] } : {}),
    ...(refund ? { refund: true } : {}),
    raw
  }
}

// ---- time --------------------------------------------------------------------

/**
 * When the payment happened, from MacroDroid's `time`: ms or seconds since
 * 1970, an ISO date, or "HH:MM" (your local time, the last such minute). Falls
 * back to `now` when missing, odd, in the future or over 7 days old.
 */
export function payTime(time: unknown, now: number, timeZone = 'Europe/Chisinau'): number {
  const ok = (ms: number) => Number.isFinite(ms) && ms <= now + 10 * 60_000 && ms >= now - 7 * 86400_000
  if (typeof time === 'number' || (typeof time === 'string' && /^\d{9,13}$/.test(time.trim()))) {
    const n = Number(time)
    const ms = n > 1e12 ? n : n * 1000
    return ok(ms) ? ms : now
  }
  const s = String(time ?? '').trim()
  if (!s) return now
  const hm = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(s)
  if (hm) {
    const h = Number(hm[1])
    const m = Number(hm[2])
    if (h > 23 || m > 59) return now
    // Local wall time now, then step back to the last time the clock read HH:MM.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]))
    const nowMin = Number(parts.hour) * 60 + Number(parts.minute)
    let diff = nowMin - (h * 60 + m)
    if (diff < -10) diff += 1440
    const ms = now - diff * 60_000
    return ok(ms) ? Math.floor(ms / 60_000) * 60_000 : now
  }
  const ms = Date.parse(s)
  return ok(ms) ? ms : now
}

// ---- one payment, two notifications --------------------------------------------

export interface PayTwinLike {
  amount: number
  currency?: string
  at: number
  sources?: string[]
  raw?: string[]
  remove?: boolean
}

/**
 * The entry a new notification belongs to, or -1: the same amount and
 * currency within ±5 minutes, from another app (maib and Google Wallet both
 * telling about one tap), or the very same text again (a re-sent
 * notification). Two real payments of the same sum from the same app, with
 * different texts, stay two.
 */
export function findTwin(list: PayTwinLike[], p: { amount: number; currency: string; at: number; source: string; raw: string }, windowMs = TWIN_WINDOW_MS): number {
  let best = -1
  let bestGap = Infinity
  list.forEach((e, i) => {
    if (e.remove || e.amount !== p.amount || (e.currency ?? '') !== p.currency) return
    const gap = Math.abs(e.at - p.at)
    if (gap > windowMs) return
    const sources = e.sources ?? []
    const sameText = (e.raw ?? []).includes(p.raw)
    if (!sameText && sources.includes(p.source)) return
    if (gap < bestGap) {
      best = i
      bestGap = gap
    }
  })
  return best
}

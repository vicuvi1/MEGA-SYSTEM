// The life wheel (LF18): once a quarter you rate 8 areas of life from 1 to
// 10 in two minutes. Past quarters are overlaid on the same wheel, and the
// weakest area suggests the next season's theme. It measures how life feels,
// which the weekly review's numbers can't. Pure; stored in `saga_wheel`.
import { SEASON_THEMES, type SeasonTheme } from './season'

export type WheelArea = 'faith' | 'family' | 'friends' | 'body' | 'mind' | 'career' | 'money' | 'fun'

export const WHEEL_AREAS: { id: WheelArea; label: string; icon: string; color: string; ask: string }[] = [
  { id: 'faith', label: 'Faith', icon: '🕌', color: '#7fd8c4', ask: 'Do you feel close to what you believe?' },
  { id: 'family', label: 'Family', icon: '🏠', color: '#ec8db0', ask: 'Are you there for your family?' },
  { id: 'friends', label: 'Friends', icon: '🤝', color: '#ff9a6a', ask: 'Do you have people to laugh with?' },
  { id: 'body', label: 'Body', icon: '💪', color: '#ff9f43', ask: 'Strong, rested, moving?' },
  { id: 'mind', label: 'Mind', icon: '🧠', color: '#b892ff', ask: 'Calm, curious, learning?' },
  { id: 'career', label: 'Career', icon: '🛡️', color: '#5aa8ff', ask: 'Moving toward the work you want?' },
  { id: 'money', label: 'Money', icon: '🪙', color: '#f5c84b', ask: 'In control of your money?' },
  { id: 'fun', label: 'Fun', icon: '🎈', color: '#c8f135', ask: 'Enjoying life, not only grinding?' }
]
export const AREA_IDS = WHEEL_AREAS.map((a) => a.id)

export type Ratings = Partial<Record<WheelArea, number>>

export interface WheelBook {
  /** "2026-Q4" → the ratings you gave that quarter. */
  quarters: Record<string, Ratings>
  /** When each quarter was rated (the last save). */
  at: Record<string, string>
}

export const EMPTY_WHEEL: WheelBook = { quarters: {}, at: {} }
const QKEY = /^\d{4}-Q[1-4]$/

/** "2026-Q4" for a day. */
export function quarterOf(day: string): string {
  const m = Number(day.slice(5, 7))
  return `${day.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`
}

/** "Oct–Dec 2026". */
export function quarterLabel(q: string): string {
  const n = Number(q.slice(-1))
  const names = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec']
  return `${names[n - 1] ?? q} ${q.slice(0, 4)}`
}

export function prevQuarter(q: string): string {
  const y = Number(q.slice(0, 4))
  const n = Number(q.slice(-1))
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`
}

const rating = (v: unknown): number | null => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null
}

export function cleanRatings(raw: unknown): Ratings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Ratings = {}
  for (const a of AREA_IDS) {
    const v = rating(r[a])
    if (v != null) out[a] = v
  }
  return out
}

export function cleanWheel(raw: unknown): WheelBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const quarters: Record<string, Ratings> = {}
  const at: Record<string, string> = {}
  const keys = Object.keys(r.quarters && typeof r.quarters === 'object' ? r.quarters : {})
    .filter((k) => QKEY.test(k))
    .sort()
    .slice(-16)
  for (const k of keys) {
    const rt = cleanRatings(r.quarters[k])
    if (Object.keys(rt).length) quarters[k] = rt
    if (typeof r.at?.[k] === 'string') at[k] = String(r.at[k]).slice(0, 30)
  }
  return { quarters, at }
}

/** Saves this quarter's ratings (a full set replaces the old one). */
export function rateQuarter(book: WheelBook, q: string, ratings: Ratings, nowIso: string): WheelBook {
  if (!QKEY.test(q)) throw new Error('Not a quarter')
  const clean = cleanRatings(ratings)
  return cleanWheel({ quarters: { ...book.quarters, [q]: clean }, at: { ...book.at, [q]: nowIso } })
}

/** Every rated quarter, oldest first. */
export function wheelHistory(book: WheelBook): { q: string; ratings: Ratings; avg: number }[] {
  return Object.keys(book.quarters)
    .sort()
    .map((q) => ({ q, ratings: book.quarters[q], avg: average(book.quarters[q]) }))
}

export function average(r: Ratings): number {
  const v = AREA_IDS.map((a) => r[a]).filter((x): x is number => typeof x === 'number')
  return v.length ? Math.round((v.reduce((t, x) => t + x, 0) / v.length) * 10) / 10 : 0
}

/** Is this quarter still to rate? (and how many days of it are left) */
export function wheelDue(book: WheelBook, today: string): { due: boolean; quarter: string; daysLeft: number } {
  const q = quarterOf(today)
  const y = Number(q.slice(0, 4))
  const n = Number(q.slice(-1))
  const end = n === 4 ? `${y}-12-31` : new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10)
  const daysLeft = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5) + 1
  const rated = Object.keys(book.quarters[q] ?? {}).length === AREA_IDS.length
  return { due: !rated, quarter: q, daysLeft }
}

/** The area changes since the quarter before (+2, −1 …), only where both have a number. */
export function wheelChange(cur: Ratings, prev: Ratings | null | undefined): Partial<Record<WheelArea, number>> {
  const out: Partial<Record<WheelArea, number>> = {}
  if (!prev) return out
  for (const a of AREA_IDS) if (cur[a] != null && prev[a] != null) out[a] = (cur[a] as number) - (prev[a] as number)
  return out
}

/**
 * The weakest areas, lowest first. Ties go to the one that dropped the most
 * since last quarter, then to the wheel's order.
 */
export function weakestAreas(cur: Ratings, prev?: Ratings | null): WheelArea[] {
  const ch = wheelChange(cur, prev)
  return AREA_IDS.filter((a) => cur[a] != null).sort((a, b) => (cur[a] as number) - (cur[b] as number) || (ch[a] ?? 0) - (ch[b] ?? 0) || AREA_IDS.indexOf(a) - AREA_IDS.indexOf(b))
}

/** The next season's theme from the weakest area, with the reason in plain words. */
export function suggestTheme(cur: Ratings, prev?: Ratings | null): { theme: SeasonTheme; area: WheelArea; why: string } | null {
  const weak = weakestAreas(cur, prev)
  if (!weak.length) return null
  const area = weak[0]
  const theme = SEASON_THEMES.find((t) => t.area === area) ?? SEASON_THEMES[0]
  const label = WHEEL_AREAS.find((a) => a.id === area)!.label
  const drop = wheelChange(cur, prev)[area]
  const why = `${label} is your lowest area (${cur[area]}/10${drop && drop < 0 ? `, down ${-drop} since last quarter` : ''}). A season about it moves the whole wheel.`
  return { theme, area, why }
}

/** The polygon of a set of ratings on a wheel (SVG points), area i at angle i·45° from the top. */
export function wheelPoints(r: Ratings, cx: number, cy: number, radius: number): [number, number][] {
  return AREA_IDS.map((a, i) => {
    const v = (r[a] ?? 0) / 10
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / AREA_IDS.length
    return [Math.round((cx + Math.cos(ang) * radius * v) * 10) / 10, Math.round((cy + Math.sin(ang) * radius * v) * 10) / 10]
  })
}

/** One line for Ben (empty before the first rating). */
export function wheelLine(book: WheelBook, today: string): string {
  const hist = wheelHistory(book)
  if (!hist.length) return ''
  const last = hist[hist.length - 1]
  const prev = hist.length > 1 ? hist[hist.length - 2].ratings : null
  const weak = weakestAreas(last.ratings, prev).slice(0, 2)
  const s = suggestTheme(last.ratings, prev)
  const due = wheelDue(book, today)
  return `Life wheel (${quarterLabel(last.q)}, his own 1–10): ${AREA_IDS.filter((a) => last.ratings[a] != null).map((a) => `${a} ${last.ratings[a]}`).join(', ')}. Weakest: ${weak.join(', ')}${s ? `; suggested next season: "${s.theme.name}"` : ''}.${due.due ? ` This quarter isn't rated yet (${due.daysLeft} days left).` : ''}`
}

// Readers for the other apps' data files. Pure: they take file contents and
// return plain facts; the main process decides what pays out.
import { addDays, daysBetween } from './dates'

// ---------------- Waky (wake-up app): data/waky.json ----------------

export interface WakyMorning {
  day: string
  time: string
  target: string
  onTime: boolean
}

export interface WakyData {
  grace: number
  sleepGoal: number
  weekday: string
  weekend: string
  mornings: WakyMorning[]
  /** Bedtimes, keyed by the morning they lead to. */
  nights: WakyMorning[]
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
// Bedtimes compare from noon, so 00:30 counts as later than 23:30.
const sinceNoon = (hhmm: string) => (toMin(hhmm) - 12 * 60 + 24 * 60) % (24 * 60)

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const isTime = (s: unknown): s is string => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s)

export function parseWaky(text: string): WakyData {
  const j = JSON.parse(text)
  if (!j || typeof j !== 'object' || typeof j.days !== 'object') throw new Error('Not a Waky data file')
  const s = j.settings ?? {}
  const grace = Number.isFinite(s.grace) ? Number(s.grace) : 10
  const mornings: WakyMorning[] = Object.entries(j.days as Record<string, { time?: unknown; target?: unknown }>)
    .filter(([d, r]) => isDay(d) && isTime(r?.time) && isTime(r?.target))
    .map(([day, r]) => ({ day, time: r.time as string, target: r.target as string, onTime: toMin(r.time as string) <= toMin(r.target as string) + grace }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const nights: WakyMorning[] = Object.entries((j.nights ?? {}) as Record<string, { time?: unknown; target?: unknown }>)
    .filter(([d, r]) => isDay(d) && isTime(r?.time) && isTime(r?.target))
    .map(([day, r]) => ({ day, time: r.time as string, target: r.target as string, onTime: sinceNoon(r.time as string) <= sinceNoon(r.target as string) + grace }))
    .sort((a, b) => a.day.localeCompare(b.day))
  return {
    grace,
    sleepGoal: Number.isFinite(s.sleepGoal) ? Number(s.sleepGoal) : 420,
    weekday: isTime(s.weekday) ? s.weekday : '07:00',
    weekend: isTime(s.weekend) ? s.weekend : '08:00',
    mornings,
    nights
  }
}

/** Minutes slept for a night, if it looks real (1 to 16 hours). */
export function sleptMinutes(night: WakyMorning | undefined, morning: WakyMorning | undefined): number | null {
  if (!night || !morning) return null
  const m = sinceNoon(morning.time) - sinceNoon(night.time)
  return m >= 60 && m <= 16 * 60 ? m : null
}

// ---------------- MAN (the old discipline app): Chrome localStorage ----------------

export interface ManData {
  streakDays: number
  longestStreak: number
  totalVictories: number
  lastCheckin: string | null
  urgesCrushed: number
  oathsSworn: number
}

/**
 * Finds the newest saved MAN record in the raw bytes of its LevelDB log.
 * Chrome writes each localStorage update as a new record, so the last JSON
 * object is the current one.
 */
export function parseManLog(raw: Buffer): ManData | null {
  const text = raw.toString('latin1')
  const found = text.match(/\{"streakDays":\d+[^\x00\x01]*/g)
  if (!found) return null
  for (let i = found.length - 1; i >= 0; i--) {
    const chunk = found[i]
    // Try shorter and shorter endings until it parses.
    for (let end = chunk.lastIndexOf('}'); end > 0; end = chunk.lastIndexOf('}', end - 1)) {
      try {
        const o = JSON.parse(chunk.slice(0, end + 1))
        return {
          streakDays: Number(o.streakDays) || 0,
          longestStreak: Number(o.longestStreak) || 0,
          totalVictories: Number(o.totalVictories) || 0,
          lastCheckin: typeof o.lastCheckin === 'string' && isDay(o.lastCheckin) ? o.lastCheckin : null,
          urgesCrushed: Number(o.urgesCrushedCount) || 0,
          oathsSworn: Number(o.oathsSwornCount) || 0
        }
      } catch {
        // keep trimming
      }
    }
  }
  return null
}

/**
 * The start date that gives the same day count MAN shows. MAN counted daily
 * "victory" taps, so a streak of N with the last tap on day L started N days
 * before L.
 */
export function manStartSuggestion(man: ManData, today: string): { start: string; showsDays: number; lastTapDaysAgo: number | null; note: string | null } | null {
  if (!man.lastCheckin || man.streakDays <= 0) return null
  const start = addDays(man.lastCheckin, -man.streakDays)
  const ago = daysBetween(man.lastCheckin, today)
  let note: string | null = null
  if (ago > 1) note = `MAN's last check-in was ${ago} days ago, so this streak may already be broken. Pick the date that is true.`
  else if (man.totalVictories < man.streakDays) note = `MAN once added a day to fix a bug (${man.totalVictories} check-ins for a ${man.streakDays}-day streak). If that's not right, start one day later.`
  return { start: start > today ? today : start, showsDays: daysBetween(start, today), lastTapDaysAgo: ago, note }
}

// ---------------- Finance Helper: <Drive>/Finance Helper/finance-helper-sync.json ----------------

export interface FinanceTx {
  date: string
  type: string
  amount: number // in the base currency's smallest unit (bani)
  everyday: boolean
}

export interface FinanceData {
  savedAt: number
  currency: string
  tx: FinanceTx[]
}

const BILLISH = /bill|rent|chiri|apart|utilit|factur|comunal|internet|subscript|abonam|insur|asigur|mortgage|ipotec|credit/i

/**
 * Finance Helper's own saved state (its localStorage "finance-helper.state"),
 * read from the copy inside Life System. Same shape as the sync file's data.
 */
export function parseFinanceState(text: string, readAt: number): FinanceData {
  const data = JSON.parse(text)
  if (!data || !Array.isArray(data.tx)) throw new Error('Not Finance Helper data')
  return parseFinance(JSON.stringify({ app: 'finance-helper', savedAt: readAt, data }))
}

export function parseFinance(text: string): FinanceData {
  const j = JSON.parse(text)
  if (j?.app !== 'finance-helper' || !j.data || !Array.isArray(j.data.tx)) throw new Error('Not a Finance Helper sync file')
  const cats: { id: string; name?: string; bill?: boolean; work?: boolean }[] = j.data.settings?.categories ?? []
  const cat = (id: string) => cats.find((c) => c.id === id)
  const isBill = (id: string) => {
    const c = cat(id)
    if (!c) return false
    return typeof c.bill === 'boolean' ? c.bill : c.id === 'home' || c.id === 'subscriptions' || BILLISH.test(c.name ?? '')
  }
  const deleted = new Set(Object.keys(j.data.deleted ?? {}))
  const tx: FinanceTx[] = (j.data.tx as Record<string, unknown>[])
    .filter((t) => typeof t.date === 'string' && isDay(t.date) && !deleted.has(String(t.id)))
    .map((t) => {
      const amount = Number.isInteger(t.base) ? (t.base as number) : Number(t.amount) || 0
      const type = String(t.type)
      return { date: t.date as string, type, amount, everyday: type === 'expense' && !t.loan && !t.recurring && !isBill(String(t.category)) && !cat(String(t.category))?.work }
    })
  return { savedAt: Number(j.savedAt) || 0, currency: String(j.data.settings?.currency ?? 'MDL'), tx }
}

export function financeDay(f: FinanceData, day: string): { logged: boolean; everydaySpent: number } {
  const list = f.tx.filter((t) => t.date === day)
  return { logged: list.length > 0, everydaySpent: list.filter((t) => t.everyday).reduce((s, t) => s + t.amount, 0) }
}

export function financeMonth(f: FinanceData, day: string): { spent: number; everyday: number; income: number; days: number } {
  const key = day.slice(0, 7)
  const list = f.tx.filter((t) => t.date.startsWith(key) && t.date <= day)
  return {
    spent: list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    everyday: list.filter((t) => t.everyday).reduce((s, t) => s + t.amount, 0),
    income: list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    days: new Set(list.map((t) => t.date)).size
  }
}

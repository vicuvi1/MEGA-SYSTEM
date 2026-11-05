// Ben's long-term memory as typed records (pure): each fact gets a type
// (person, exam, preference, goal, routine, other), a confidence that grows
// when it comes up again, and an expiry for things that end (an exam is
// stale a week after its date). The weekly clean-up drops expired facts and
// unconfirmed guesses older than 90 days.
export type FactType = 'person' | 'exam' | 'preference' | 'goal' | 'routine' | 'other'
/** pin: you pinned it (Settings → Ben): never dropped, changed or tidied away. */
export interface Fact { t: string; at: string; type?: FactType; conf?: number; until?: string | null; seen?: number; pin?: boolean }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

/** A date written in the fact ("exam on 12 Dec", "2026-12-12", "12.12"), as YYYY-MM-DD after `today`. */
export function dateIn(text: string, today: string): string | null {
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(text)
  if (iso) return iso[0]
  const y = Number(today.slice(0, 4))
  const pick = (m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    const cand = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return cand < addDays(today, -60) ? `${y + 1}${cand.slice(4)}` : cand
  }
  const dm = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(text) ?? null
  if (dm) return pick(MONTHS[dm[2].toLowerCase().slice(0, 3)], Number(dm[1]))
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i.exec(text)
  if (md) return pick(MONTHS[md[1].toLowerCase().slice(0, 3)], Number(md[2]))
  const num = /\b(\d{1,2})[./](\d{1,2})\b/.exec(text)
  if (num) return pick(Number(num[2]), Number(num[1]))
  return null
}

export function factType(text: string): FactType {
  const t = text.toLowerCase()
  if (/\b(exam|test|colloquium|deadline|due|presentation|defen[cs]e|interview)\b/.test(t)) return 'exam'
  if (/\b(friend|girlfriend|boyfriend|mom|mother|dad|father|brother|sister|teacher|professor|colleague|partner|roommate)\b/.test(t)) return 'person'
  if (/\b(likes?|loves?|hates?|prefers?|enjoys?|can'?t stand|favou?rite)\b/.test(t)) return 'preference'
  if (/\b(wants? to|goal|plans? to|dreams?|aims?|trying to)\b/.test(t)) return 'goal'
  if (/\b(every|usually|always|wakes?|trains?|gym on|works? on)\b/.test(t)) return 'routine'
  return 'other'
}

/** A fact as a record: type, confidence, expiry. */
export function toRecord(text: string, today: string, prev?: Fact): Fact {
  const type = factType(text)
  const d = type === 'exam' ? dateIn(text, today) : null
  const seen = (prev?.seen ?? (prev ? 1 : 0)) + 1
  return { t: text, at: today, type, conf: Math.min(1, 0.6 + 0.15 * (seen - 1)), until: d ? addDays(d, 7) : prev?.until ?? null, seen, ...(prev?.pin ? { pin: true } : {}) }
}

/** The weekly clean-up: expired facts go, and guesses never confirmed after 90 days. */
export function cleanFacts(facts: Fact[], today: string): Fact[] {
  return facts.filter((f) => f.pin || !(f.until && f.until < today) && !((f.conf ?? 0.7) < 0.65 && f.at < addDays(today, -90)))
}

/** For the prompt: "[exam until 2026-12-19] Etica exam on 12 Dec". */
export const factLine = (f: Fact) => `${f.type && f.type !== 'other' ? `[${f.type}${f.until ? ` until ${f.until}` : ''}] ` : ''}${f.t} (noted ${f.at}${f.seen && f.seen > 1 ? `, said ${f.seen}×` : ''})`

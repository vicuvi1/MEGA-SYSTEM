// The wins wall and confidence bank (LF15): a wall of real proof. Most of it
// is collected by itself from what you logged (CTF sessions, workout
// milestones, runs of nights on time, goal milestones, bosses beaten,
// adventures); kind deeds and nice messages people sent are added by hand.
// Ben pulls one out on a low day, and the island offers "Open your wins".
// Pure; your own wins live in `saga_wins`.
import { addDays } from './dates'
import { effective, type LedgerEntry } from './ledger'

export type WinKind = 'ctf' | 'record' | 'workout' | 'sleep' | 'focus' | 'goal' | 'season' | 'adventure' | 'kind' | 'message' | 'other'

export const WIN_KINDS: { id: WinKind; label: string; icon: string; color: string; manual: boolean }[] = [
  { id: 'ctf', label: 'Flag captured', icon: '🚩', color: '#ff3ea5', manual: true },
  { id: 'record', label: 'Personal record', icon: '🏆', color: '#f5c84b', manual: true },
  { id: 'kind', label: 'Kind deed', icon: '🤍', color: '#ec8db0', manual: true },
  { id: 'message', label: 'Nice message', icon: '💌', color: '#b892ff', manual: true },
  { id: 'other', label: 'Other win', icon: '✨', color: '#c8f135', manual: true },
  { id: 'workout', label: 'Training', icon: '💪', color: '#ff9f43', manual: false },
  { id: 'sleep', label: 'Nights on time', icon: '🌙', color: '#6ee7d8', manual: false },
  { id: 'focus', label: 'Deep work', icon: '🎯', color: '#5aa8ff', manual: false },
  { id: 'goal', label: 'Goal milestone', icon: '🏔️', color: '#c8f135', manual: false },
  { id: 'season', label: 'Season', icon: '⚔️', color: '#f4c27c', manual: false },
  { id: 'adventure', label: 'Adventure', icon: '🧭', color: '#3b8fe8', manual: false }
]
const MANUAL = WIN_KINDS.filter((k) => k.manual).map((k) => k.id)

export interface Win {
  id: string
  day: string
  kind: WinKind
  title: string
  /** "— Ana", "after 3 tries", the message's words… */
  detail: string
  auto: boolean
  /** How big it is (1 small … 3 big), for the wall's sizes and low-day picks. */
  weight: 1 | 2 | 3
}

export interface WinsBook {
  /** Wins you added by hand. */
  mine: Win[]
  /** Auto wins you took off the wall (their ids). */
  hidden: string[]
}

export const EMPTY_WINS: WinsBook = { mine: [], hidden: [] }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function cleanWins(raw: unknown): WinsBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const mine: Win[] = (Array.isArray(r.mine) ? r.mine : [])
    .filter((w: any) => w && str(w.title, 120) && DAY.test(String(w.day)))
    .map((w: any, i: number) => ({ id: str(w.id, 24) || `w${i + 1}`, day: String(w.day), kind: MANUAL.includes(w.kind) ? w.kind : 'other', title: str(w.title, 120), detail: str(w.detail, 280), auto: false, weight: ([1, 2, 3].includes(w.weight) ? w.weight : 2) as Win['weight'] }))
    .slice(-400)
  const hidden = (Array.isArray(r.hidden) ? r.hidden : []).map((x: unknown) => str(x, 60)).filter(Boolean).slice(-400)
  return { mine, hidden }
}

export interface WinSources {
  entries: LedgerEntry[]
  book: WinsBook
  /** Bosses you beat and seasons you finished. */
  seasons?: { id: string; name: string; boss: string; won: boolean; day: string }[]
  adventures?: { id: string; title: string; emoji: string; day: string; place: string }[]
}

const CTF = /\b(ctf|flag|htb|hack ?the ?box|tryhackme|thm|pwn|exploit|writeup)\b/i
const MILESTONES = [10, 25, 50, 100, 150, 200, 300, 500]

/** Every win on the wall, newest first (auto ones you hid are left out). */
export function collectWins(src: WinSources): Win[] {
  const out: Win[] = []
  const live = effective(src.entries).filter((e) => e.kind === 'earn')
  const byDay = [...live].sort((a, b) => (a.ts < b.ts ? -1 : 1))
  // Workouts: the 10th, 25th, 50th… you ever logged.
  let n = 0
  for (const e of byDay) {
    if (e.ruleId !== 'body.workout_done') continue
    n++
    if (MILESTONES.includes(n)) out.push({ id: `auto:workouts:${n}`, day: e.day, kind: 'workout', title: `${n} workouts done`, detail: e.note ? `The ${n}th: ${e.note}` : 'Every one of them logged', auto: true, weight: n >= 50 ? 3 : 2 })
  }
  // Nights on time: each run of 5+ nights in a row, at its end.
  const beds = [...new Set(live.filter((e) => e.ruleId === 'sleep.bed_on_time').map((e) => e.day))].sort()
  let runStart = 0
  for (let i = 1; i <= beds.length; i++) {
    if (i < beds.length && addDays(beds[i - 1], 1) === beds[i]) continue
    const len = i - runStart
    if (len >= 5) out.push({ id: `auto:sleep:${beds[runStart]}`, day: beds[i - 1], kind: 'sleep', title: `${len} nights on time in a row`, detail: `${beds[runStart].slice(5)} to ${beds[i - 1].slice(5)}`, auto: true, weight: len >= 14 ? 3 : 2 })
    runStart = i
  }
  // CTF and hacking sessions you logged (focus sessions and blocks with those words).
  // One tile per week, so a busy week doesn't flood the wall.
  const ctfWeeks = new Map<string, LedgerEntry[]>()
  for (const e of live) {
    if (!(e.ruleId?.startsWith('focus.') || e.ruleId?.startsWith('study.') || e.module === 'focus')) continue
    if (!CTF.test(`${e.note ?? ''}`)) continue
    const wd = new Date(`${e.day}T12:00:00Z`).getUTCDay()
    const mon = addDays(e.day, -((wd + 6) % 7))
    ctfWeeks.set(mon, [...(ctfWeeks.get(mon) ?? []), e])
  }
  for (const [mon, list] of ctfWeeks) {
    const last = list[list.length - 1]
    const name = (e: LedgerEntry) => (e.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'CTF session'
    out.push(list.length === 1
      ? { id: `auto:ctf:${last.id}`, day: last.day, kind: 'ctf', title: name(last), detail: 'Logged as a focus session', auto: true, weight: 1 }
      : { id: `auto:ctf:w${mon}`, day: last.day, kind: 'ctf', title: `${list.length} CTF sessions in one week`, detail: [...new Set(list.map(name))].slice(0, 3).join(' · '), auto: true, weight: list.length >= 4 ? 2 : 1 })
  }
  // Big focus days: 4+ sessions in one day.
  const focusDays = new Map<string, number>()
  for (const e of live) if (e.ruleId === 'focus.session' || e.ruleId === 'study.block_done') focusDays.set(e.day, (focusDays.get(e.day) ?? 0) + 1)
  for (const [day, k] of focusDays) if (k >= 4) out.push({ id: `auto:focus:${day}`, day, kind: 'focus', title: `${k} deep-work sessions in one day`, detail: 'A full day of real work', auto: true, weight: k >= 6 ? 3 : 2 })
  // Goal milestones.
  for (const e of live) if (e.ruleId === 'goal.milestone') out.push({ id: `auto:goal:${e.id}`, day: e.day, kind: 'goal', title: (e.note || 'Goal milestone').slice(0, 90), detail: 'Reached with your own check-ins', auto: true, weight: 2 })
  for (const s of src.seasons ?? []) out.push({ id: `auto:season:${s.id}`, day: s.day, kind: 'season', title: s.won ? `Boss defeated: ${s.boss}` : `Season finished: ${s.name}`, detail: s.won ? s.name : 'Eight weeks, start to finish', auto: true, weight: s.won ? 3 : 2 })
  for (const a of src.adventures ?? []) out.push({ id: `auto:adv:${a.id}`, day: a.day, kind: 'adventure', title: a.title, detail: a.place, auto: true, weight: 1 })
  const hidden = new Set(src.book.hidden)
  return [...out.filter((w) => !hidden.has(w.id)), ...src.book.mine].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.id < b.id ? 1 : -1))
}

/** Counts per kind (the wall's filter chips). */
export function winCounts(wins: Win[]): Partial<Record<WinKind, number>> {
  const out: Partial<Record<WinKind, number>> = {}
  for (const w of wins) out[w.kind] = (out[w.kind] ?? 0) + 1
  return out
}

export interface DaySignals {
  /** Your mood check-in today, 1–5 (null: none). */
  mood: number | null
  /** Points earned yesterday and the day before. */
  yesterday: number
  /** Week score now and last week (0–100). */
  score: number | null
  prevScore: number | null
  /** A reset or a missed must-do day yesterday. */
  slipped: boolean
}

/** A low day: a sad mood check-in, a slip, an empty yesterday, or a week score that fell hard. */
export function isLowDay(s: DaySignals): boolean {
  if (s.mood != null && s.mood <= 2) return true
  if (s.slipped) return true
  if (s.yesterday <= 0) return true
  if (s.score != null && s.prevScore != null && s.prevScore - s.score >= 15) return true
  return false
}

/** The win to bring back on a low day: big and personal first, never the same one two days running. */
export function pickWin(wins: Win[], day: string): Win | null {
  if (!wins.length) return null
  const score = (w: Win) => w.weight * 2 + (w.auto ? 0 : 2) + (w.kind === 'message' || w.kind === 'kind' ? 1 : 0)
  const best = [...wins].sort((a, b) => score(b) - score(a) || (a.day < b.day ? 1 : -1)).slice(0, 7)
  const n = Math.round(Date.parse(`${day}T12:00:00Z`) / 864e5)
  return best[((n % best.length) + best.length) % best.length]
}

/** Ben's line: the size of the bank always; one real win to recall on a low day. */
export function winsLine(wins: Win[], low: boolean, day: string): string {
  if (!wins.length) return ''
  const w = low ? pickWin(wins, day) : null
  const recent = wins.filter((x) => x.day >= addDays(day, -30)).length
  return `Wins wall (his proof, ${wins.length} wins, ${recent} in the last 30 days).${w ? ` TODAY LOOKS LIKE A LOW DAY: remind him once, warmly, of a real win: "${w.title}"${w.detail ? ` (${w.detail})` : ''} on ${w.day}. Never invent one.` : ''}`
}

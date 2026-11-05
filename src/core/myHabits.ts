// Your own habits (pure, FT1): "Read 10 pages", "Stretch". Tap one to log it
// for the day; it pays a small, honest amount only for that tap (the
// habit.own rule, with a daily cap), keeps a streak, and when you miss a day
// Today says "never miss twice" once.
import { addDays } from './dates'
import { bestDayStreak, dayStreak } from './streaks'

export const MY_HABITS = 'my_habits'
/** The rule that pays a tap (+2, at most 6 a day across all your habits). */
export const HABIT_RULE = 'habit.own'
export const MAX_HABITS = 12

export interface MyHabit {
  id: string
  name: string
  at: string
}
export interface HabitBook {
  habits: MyHabit[]
  /** Day → ids of the habits logged that day. */
  log: Record<string, string[]>
}
export const EMPTY_BOOK: HabitBook = { habits: [], log: {} }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function cleanBook(v: any): HabitBook {
  const habits: MyHabit[] = Array.isArray(v?.habits)
    ? v.habits.filter((h: any) => h && typeof h.id === 'string' && clip(h.name, 60)).map((h: any) => ({ id: clip(h.id, 40), name: clip(h.name, 60), at: String(h.at ?? '') }))
    : []
  const log: Record<string, string[]> = {}
  if (v?.log && typeof v.log === 'object') {
    const days = Object.keys(v.log).filter((d) => DAY.test(d)).sort().slice(-400)
    for (const d of days) if (Array.isArray(v.log[d])) log[d] = [...new Set(v.log[d].map(String))]
  }
  return { habits: habits.slice(0, MAX_HABITS), log }
}

export function addHabit(b: HabitBook, name: string, now = new Date()): HabitBook {
  const n = clip(name, 60)
  if (!n) throw new Error('Name the habit, e.g. "Read 10 pages"')
  if (b.habits.some((h) => h.name.toLowerCase() === n.toLowerCase())) throw new Error(`"${n}" is already on your list`)
  if (b.habits.length >= MAX_HABITS) throw new Error(`${MAX_HABITS} habits at most: remove one first`)
  const id = `h${now.getTime().toString(36)}${b.habits.length}`
  return { ...b, habits: [...b.habits, { id, name: n, at: now.toISOString() }] }
}

export function renameHabit(b: HabitBook, id: string, name: string): HabitBook {
  const n = clip(name, 60)
  if (!n) throw new Error('A habit needs a name')
  if (!b.habits.some((h) => h.id === id)) throw new Error('That habit is gone')
  return { ...b, habits: b.habits.map((h) => (h.id === id ? { ...h, name: n } : h)) }
}

/** Removes it from the list (its past days stay in the log, they did happen). */
export function removeHabit(b: HabitBook, id: string): HabitBook {
  return { ...b, habits: b.habits.filter((h) => h.id !== id) }
}

export function isLogged(b: HabitBook, id: string, day: string): boolean {
  return (b.log[day] ?? []).includes(id)
}

export function logHabit(b: HabitBook, id: string, day: string): HabitBook {
  if (!b.habits.some((h) => h.id === id)) throw new Error('That habit is gone')
  if (isLogged(b, id, day)) return b
  return { ...b, log: { ...b.log, [day]: [...(b.log[day] ?? []), id] } }
}

export function unlogHabit(b: HabitBook, id: string, day: string): HabitBook {
  if (!isLogged(b, id, day)) return b
  return { ...b, log: { ...b.log, [day]: (b.log[day] ?? []).filter((x) => x !== id) } }
}

/** The ledger ref of one tap: paid at most once per habit and day. */
export const habitRef = (id: string, day: string) => `habit:${id}:${day}`

export function doneDays(b: HabitBook, id: string): string[] {
  return Object.keys(b.log).filter((d) => b.log[d].includes(id))
}

export interface HabitRow {
  id: string
  name: string
  done: boolean
  streak: number
  best: number
  /** Done in the last 7 days (today included). */
  week: number
}

/** Each habit for today: done, its streak (rest days keep it alive), best and this week. */
export function habitRows(b: HabitBook, today: string, restDays: string[] = []): HabitRow[] {
  return b.habits.map((h) => {
    const days = doneDays(b, h.id)
    const from = addDays(today, -6)
    return { id: h.id, name: h.name, done: isLogged(b, h.id, today), streak: dayStreak(days, today, restDays), best: bestDayStreak(days, restDays), week: days.filter((d) => d >= from && d <= today).length }
  })
}

/**
 * Never miss twice: habits you kept in the week before but missed yesterday
 * (not a rest day) and haven't done today yet.
 */
export function missedYesterday(b: HabitBook, today: string, restDays: string[] = []): MyHabit[] {
  const y = addDays(today, -1)
  if (restDays.includes(y)) return []
  return b.habits.filter((h) => {
    if (isLogged(b, h.id, y) || isLogged(b, h.id, today)) return false
    return Array.from({ length: 7 }, (_, k) => addDays(y, -1 - k)).some((d) => isLogged(b, h.id, d))
  })
}

/** Ben's line about your own habits (or ''). */
export function habitsLine(b: HabitBook, today: string, restDays: string[] = []): string {
  if (!b.habits.length) return ''
  const rows = habitRows(b, today, restDays)
  const miss = missedYesterday(b, today, restDays)
  return `His own habits today: ${rows.map((r) => `${r.done ? '[done]' : '[open]'} ${r.name}${r.streak ? ` (${r.streak}-day streak)` : ''}`).join('; ')}.${miss.length ? ` Missed yesterday (never miss twice): ${miss.map((h) => h.name).join(', ')}.` : ''}`
}

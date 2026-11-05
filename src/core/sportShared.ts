// One shared log for water and reps: Sport Track's data in Life System
// (settings.sport_tracker_json) is the single source; the app, the Mega
// coach and Sporty (the Python bot, through /api/cron?job=sport) all read
// and write it here. Pure helpers; Sport Track's day is the UTC date.

import { dayKey } from './dates'
export interface SharedSport {
  date: string
  water: { ml: number; target: number; glass: number }
  exercises: { id: string; name: string; target: number; done: number }[]
}

/** The calendar day in local time (Sport Track and Sporty use the same; never UTC). */
export const sportToday = (now = new Date()) => dayKey(now, undefined, 0)

/** A new day starts a fresh checklist (reps and water back to 0). */
export function sportForDay(st: any, today: string): any {
  const s = st && typeof st === 'object' ? JSON.parse(JSON.stringify(st)) : {}
  if (!Array.isArray(s.exercises)) s.exercises = []
  if (!s.water || typeof s.water !== 'object') s.water = { currentMl: 0, targetMl: 2700, glassSizeMl: 250 }
  if (s.lastDate !== today) {
    s.lastDate = today
    s.exercises.forEach((e: any) => (e.doneToday = 0))
    s.water.currentMl = 0
  }
  return s
}

export function sharedView(st: any, today: string): SharedSport {
  const s = sportForDay(st, today)
  return {
    date: today,
    water: { ml: Math.max(0, Math.round(Number(s.water.currentMl) || 0)), target: Number(s.water.targetMl) || 2700, glass: Number(s.water.glassSizeMl) || 250 },
    exercises: s.exercises.map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name ?? e.id), target: Number(e.target) || 0, done: Number(e.doneToday) || 0 }))
  }
}

/** Adds (or with a negative amount, removes) water; never below 0. */
export function addWater(st: any, ml: number, today: string): any {
  const s = sportForDay(st, today)
  s.water.currentMl = Math.max(0, Math.round((Number(s.water.currentMl) || 0) + ml))
  return s
}

const key = (x: string) => String(x ?? '').toLowerCase().replace(/[^a-z]/g, '')

/** The exercise "pushups", "Push-ups" or "push up" means. */
export function findSharedExercise(s: any, name: string): any | null {
  const k = key(name).replace(/s$/, '')
  if (!k) return null
  return (s.exercises ?? []).find((e: any) => {
    const id = key(e.id).replace(/s$/, '')
    const n = key(e.name).replace(/s$/, '')
    return id === k || n === k || id.includes(k) || n.includes(k) || (n.length > 3 && k.includes(n))
  }) ?? null
}

/** Adds reps to an exercise (removes with a negative amount, never below 0); null if it doesn't exist. */
export function addReps(st: any, name: string, amount: number, today: string): { st: any; exercise: { name: string; done: number; target: number } } | null {
  const s = sportForDay(st, today)
  const ex = findSharedExercise(s, name)
  if (!ex) return null
  ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) + Math.round(amount))
  return { st: s, exercise: { name: String(ex.name ?? ex.id), done: ex.doneToday, target: Number(ex.target) || 0 } }
}

/**
 * "water 500", "500 ml", "+250ml", "apă 0.5 l", "2 glasses of water", "вода 300":
 * how much water a short message means (ml), or null. A small number with
 * "water" and no unit ("water 15") is a bottle bought (money), not drunk.
 */
/** Edit distance, for typos like "eawster", "watr", "wtaer". */
const near = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export function parseWater(text: string, glass = 250): number | null {
  // "eawster 250", "watr 500": a typo of "water" before or after the amount counts too.
  const typo = /^([a-z]{4,8})\s*\+?(\d{2,4})$|^\+?(\d{2,4})\s*([a-z]{4,8})$/i.exec(text.trim())
  if (typo) {
    const w = (typo[1] ?? typo[4]).toLowerCase()
    if (w !== 'water' && w.includes('w') && w.includes('t') && near(w, 'water') <= 3) text = `water ${typo[2] ?? typo[3]}`
  }
  const t = text.trim().toLowerCase()
  if (t.length > 40 || /\b(lei|mdl|ron|leu|\$|€|usd|eur)\b/.test(t)) return null
  const word = /(water|apa|apă|вод[аыу]|drank|drink)/.test(t)
  const glasses = /(\d{1,2})\s*(glass(es)?|pahar(e)?|стакан\w*|cups?)/.exec(t)
  if (glasses && (word || /^\+?\s*\d/.test(t))) return Math.min(3000, Number(glasses[1]) * glass)
  const unit = /([+-]?\d+(?:[.,]\d+)?)\s*(ml|l|л|мл)\b/.exec(t)
  if (unit) {
    const n = Number(unit[1].replace(',', '.'))
    const ml = /^(l|л)$/.test(unit[2]) ? n * 1000 : n
    if (Math.abs(ml) >= 50 && Math.abs(ml) <= 3000 && (word || t.replace(unit[0], '').trim().replace(/^\+/, '') === '')) return Math.round(ml)
    return null
  }
  const bare = /^(?:\+?\s*)?(?:water|apa|apă|вода)\s*\+?(\d{2,4})$|^\+?(\d{2,4})\s*(?:water|apa|apă|вода)$/.exec(t)
  const n = Number(bare?.[1] ?? bare?.[2])
  return bare && n >= 100 && n <= 3000 ? n : null
}

/** Your water target: about 35 ml per kg of body weight, +500 ml on a training day (1.5–4.5 L, in 50 ml steps). */
export function waterTargetFor(weightKg: number | null | undefined, trained = false): number | null {
  if (!weightKg || weightKg < 30 || weightKg > 250) return null
  const ml = weightKg * 35 + (trained ? 500 : 0)
  return Math.round(Math.max(1500, Math.min(4500, ml)) / 50) * 50
}

// One shared log for water and reps: Sport Track's data in Life System
// (settings.sport_tracker_json) is the single source; the app, the Mega
// coach and Sporty (the Python bot, through /api/cron?job=sport) all read
// and write it here. Pure helpers; Sport Track's day is the UTC date.

export interface SharedSport {
  date: string
  water: { ml: number; target: number; glass: number }
  exercises: { id: string; name: string; target: number; done: number }[]
}

export const sportToday = (now = new Date()) => now.toISOString().slice(0, 10)

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

// The island's notice when a meal is logged (pure, tested): "Lunch logged:
// 42 g protein, 680 kcal" with Undo, once per meal, for meals logged in the
// last 10 minutes on any device (Telegram, the app, the island). It goes
// through the usual island alert path (alertGate: quiet hours, calls, the gap
// between pop-ups). Undo is the food counter's own remove (toggle), so the meal
// can be put back from Body → Food. No points.
import type { IslandAlert } from './islandModel'

export const FOOD_NOTICE_MS = 10 * 60_000
const WORD: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export interface LoggedMealIn {
  id: string
  name: string
  type: string
  kcal: number
  protein: number
  at: string
}

/** The notice for a meal just logged, or null (too old, seen, or dismissed). */
export function foodLoggedAlert(m: LoggedMealIn | null, now: number, dismissed: Record<string, number>, seen: string[] = []): IslandAlert | null {
  if (!m || !/^fd-[a-z0-9]{1,24}$/.test(m.id)) return null
  const t = Date.parse(m.at)
  if (!Number.isFinite(t) || now - t > FOOD_NOTICE_MS || t - now > 60_000) return null
  const id = `food:${m.id}`
  if ((dismissed[id] ?? 0) > now || seen.includes(m.id)) return null
  const word = WORD[m.type] ?? 'Meal'
  return {
    id,
    kind: 'food',
    title: `${word} logged`,
    text: `${word} logged: ${fmt(m.protein)} g protein, ${fmt(m.kcal)} kcal`,
    face: '🍽',
    actions: [
      { label: 'OK', action: { kind: 'dismiss', id }, primary: true },
      { label: '↩ Undo', action: { kind: 'foodUndo', mealId: m.id, alertId: id } }
    ]
  }
}

/** The meals already noticed, newest kept (at most 20). */
export const rememberSeen = (seen: string[], id: string): string[] => [id, ...seen.filter((x) => x !== id)].slice(0, 20)

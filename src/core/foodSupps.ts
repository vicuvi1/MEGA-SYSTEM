// Quick buttons for water and supplements in the food day log. Water is NOT a
// second counter: a tap adds to the one water log (body_log `water`, shared with
// Sport Track and the island). A supplement is a small entry in the day log with
// its macros if it has any (a shake has protein); creatine also ticks the
// existing supplement streak. No points.
import type { FoodItem } from './food'

export const WATER_BUTTONS = [
  { id: 'glass', label: 'Glass', ml: 250 },
  { id: 'bottle', label: 'Bottle', ml: 500 }
] as const

export interface SuppPreset {
  id: 'creatine' | 'shake' | 'vitamins'
  label: string
  /** The existing supplement checklist id this also ticks (creatine streak). */
  tick?: string
  items: FoodItem[]
}

const it = (name: string, grams: number, protein: number, carbs: number, fat: number, kcal: number): FoodItem => ({ name, grams, protein, carbs, fat, kcal, confidence: 'sure' })

export const SUPP_PRESETS: SuppPreset[] = [
  { id: 'creatine', label: 'Creatine 5 g', tick: 'creatine', items: [it('creatine', 5, 0, 0, 0, 0)] },
  { id: 'shake', label: 'Shake (1 scoop)', items: [it('whey protein shake', 30, 24, 3, 2, 120)] },
  { id: 'vitamins', label: 'Vitamins', items: [it('vitamins', 1, 0, 0, 0, 0)] }
]

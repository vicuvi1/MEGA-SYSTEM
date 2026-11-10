// Barcodes and nutrition labels in a meal photo (pure, tested).
// - The photo read gives the digits of a barcode it can see (`barcode`); the
//   server checks them (cleanBarcode: EAN-8, UPC-A, EAN-13, GTIN-14 with a
//   valid check digit) and looks the product up in Open Food Facts (free, no
//   key; api/_vision.mjs lookupBarcode). The product comes back with the
//   answer and is checked again here (cleanProduct) before it is trusted.
// - A found product's numbers per 100 g × the grams eaten replace the AI's
//   estimate for that food (src 'barcode', sure). When Open Food Facts can't be
//   reached (offline, blocked, slow) or doesn't know the code, the AI's
//   numbers stay and the review says so in one line.
// - A food whose numbers come from a label or a barcode is saved as one of
//   your saved foods when you save the meal (labelFoods), so next time it is
//   one tap in Log food → My meals. Saved foods read from a label are marked
//   by their name; a food you already saved (same name) is not added twice.
import type { FoodSaved, SavedFood } from './foodSaved'
import { FOODS_MAX } from './foodSaved'

/** A barcode's digits when the check digit is right (8, 12, 13 or 14 digits), else null. */
export function cleanBarcode(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/[\s-]/g, '')
  if (!/^\d{8}$|^\d{12,14}$/.test(d)) return null
  if (/^0+$/.test(d)) return null
  const body = d.slice(0, -1)
  let sum = 0
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]) ? d : null
}

export interface Product {
  code: string
  name: string
  brand: string
  /** Per 100 g (or 100 ml). */
  per100: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null }
  /** One serving in grams, when the package says. */
  servingG: number | null
}

/** Why a barcode gave no numbers: Open Food Facts doesn't know it, or couldn't be reached. */
export type ProductMiss = 'notFound' | 'offline'

const num = (v: unknown, hi: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= 0 && n <= hi ? Math.round(n * 10) / 10 : null
}
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** A product as the server sends it (or straight from Open Food Facts' JSON), checked; null when it has no usable numbers. */
export function cleanProduct(raw: unknown): Product | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null
  if (!o) return null
  const code = cleanBarcode(o.code)
  const p = o.per100 && typeof o.per100 === 'object' ? o.per100 : null
  if (!code || !p) return null
  const kcal = num(p.kcal, 900)
  const protein = num(p.protein, 100)
  const carbs = num(p.carbs, 100)
  const fat = num(p.fat, 100)
  if (kcal == null || protein == null) return null
  const name = txt(o.name, 60) || `Product ${code}`
  return { code, name, brand: txt(o.brand, 40), per100: { kcal, protein, carbs: carbs ?? 0, fat: fat ?? 0, fiber: num(p.fiber, 100) }, servingG: num(o.servingG, 2000) || null }
}

/** Open Food Facts' product JSON → a product (the server's lookup uses the same reading). */
export function productFromOff(code: string, json: unknown): Product | null {
  const j = (json && typeof json === 'object' ? json : null) as Record<string, any> | null
  if (!j || j.status === 0 || !j.product) return null
  const p = j.product
  const n = p.nutriments ?? {}
  const kcal = n['energy-kcal_100g'] ?? (Number.isFinite(Number(n.energy_100g)) ? Number(n.energy_100g) / 4.184 : undefined)
  return cleanProduct({ code, name: p.product_name, brand: String(p.brands ?? '').split(',')[0], servingG: p.serving_quantity, per100: { kcal, protein: n.proteins_100g, carbs: n.carbohydrates_100g, fat: n.fat_100g, fiber: n.fiber_100g } })
}

/** The numbers of `grams` of the product (per 100 g × grams). */
export function productAt(p: Product, grams: number) {
  const f = Math.max(0, grams) / 100
  const r1 = (n: number) => Math.round(n * 10) / 10
  return { kcal: Math.round(p.per100.kcal * f), protein: r1(p.per100.protein * f), carbs: r1(p.per100.carbs * f), fat: r1(p.per100.fat * f), ...(p.per100.fiber != null ? { fiber: r1(p.per100.fiber * f) } : {}) }
}

/** The product's name for the list ("Brand Name", no repeat when the name already has the brand). */
export const productName = (p: Product) => (p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name).slice(0, 60)

/** "Barcode 5941234567890: …" when the lookup gave nothing, for the review and the Telegram preview. */
export function missLine(code: string, why: ProductMiss): string {
  return why === 'offline' ? `Barcode ${code} seen, but Open Food Facts couldn't be reached: the numbers are the AI's estimate.` : `Barcode ${code} is not in Open Food Facts yet: the numbers are the AI's estimate.`
}

/** Lower-case words of a name, for "is this food already saved?". */
const key = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** A food read from a label or a barcode, as one of your saved foods (one portion = what you ate). */
export function labelFood(it: { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number }, id: string): SavedFood | null {
  const name = txt(it.name, 40)
  const g = Math.round(Number(it.grams) || 0)
  if (!name || g < 1 || !(it.kcal > 0)) return null
  return { id, name, portionLabel: `1 portion (${g} g)`, grams: g, kcal: Math.round(it.kcal), protein: Math.round(it.protein * 10) / 10, carbs: Math.round(it.carbs * 10) / 10, fat: Math.round(it.fat * 10) / 10 }
}

/**
 * Adds every label or barcode food of a saved meal to your saved foods (not
 * twice: a saved food with the same name stays as it is). Returns the new set
 * and the names it added.
 */
export function labelFoods(saved: FoodSaved, items: { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; src?: string }[], newId: () => string): { saved: FoodSaved; added: string[] } {
  const have = new Set(saved.foods.map((f) => key(f.name)))
  const foods = [...saved.foods]
  const added: string[] = []
  for (const it of items) {
    if (it.src !== 'label' && it.src !== 'barcode') continue
    if (foods.length >= FOODS_MAX || have.has(key(String(it.name ?? '').slice(0, 40)))) continue
    const f = labelFood(it, newId())
    if (!f) continue
    foods.push(f)
    have.add(key(f.name))
    added.push(f.name)
  }
  return { saved: added.length ? { ...saved, foods } : saved, added }
}

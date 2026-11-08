// Cheap protein: grams of protein per leu (MDL) for common Moldovan foods, from
// the built-in table with made-up default prices (MDL per kg) that the owner can
// edit, plus the owner's own foods once they set a price. "What to eat next"
// uses it as a tie-breaker. Pure and tested.
import { FOOD_TABLE, normFood, type OwnFood } from './foodTable'

export interface CheapRow {
  name: string
  /** Protein per 100 g. */
  p: number
  /** MDL per kg now (your price, or the default). */
  mdlKg: number
  /** Your own price (not the default). */
  edited: boolean
  /** Grams of protein per leu. */
  gPerLei: number
  /** From your own logged foods. */
  own: boolean
}

/** Grams of protein per leu for a food with `p` g protein per 100 g at `mdlKg` MDL per kg. */
export const proteinPerLei = (p: number, mdlKg: number) => (mdlKg > 0 ? Math.round(((p * 10) / mdlKg) * 10) / 10 : 0)

/**
 * The list, best value first. Table foods flagged as protein foods (or with at
 * least 10 g protein per 100 g) are always in; own foods are in once they have a
 * price in `prices` (keyed by food name) or a table match.
 */
export function cheapProtein(prices: Record<string, number> = {}, own: OwnFood[] = []): CheapRow[] {
  const price = (name: string) => {
    const k = normFood(name)
    for (const [key, v] of Object.entries(prices)) if (normFood(key) === k && v > 0) return v
    return 0
  }
  const rows: CheapRow[] = []
  for (const t of FOOD_TABLE) {
    if (!t.protein && t.p < 10) continue
    const mine = price(t.name)
    const mdlKg = mine || t.mdlKg || 0
    if (!mdlKg) continue
    rows.push({ name: t.name, p: t.p, mdlKg, edited: !!mine, gPerLei: proteinPerLei(t.p, mdlKg), own: false })
  }
  for (const o of own) {
    if (o.p < 10 || rows.some((r) => normFood(r.name) === normFood(o.name))) continue
    const mine = price(o.name)
    if (!mine) continue
    rows.push({ name: o.name, p: o.p, mdlKg: mine, edited: true, gPerLei: proteinPerLei(o.p, mine), own: true })
  }
  return rows.sort((a, b) => b.gPerLei - a.gPerLei || (a.name < b.name ? -1 : 1))
}

/** Own foods that have no price yet (to offer "set a price"), high-protein first. */
export function unpricedOwn(prices: Record<string, number>, own: OwnFood[], max = 4): OwnFood[] {
  return own
    .filter((o) => o.p >= 10 && !FOOD_TABLE.some((t) => normFood(t.name) === normFood(o.name)) && !Object.keys(prices).some((k) => normFood(k) === normFood(o.name)))
    .slice(0, max)
}

/** name → grams of protein per leu, for the tie-breaker in "What to eat next". */
export function cheapMap(rows: CheapRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[normFood(r.name)] = r.gPerLei
  return out
}

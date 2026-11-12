// Backup before risk (2026-11-12): which changes to an app's data are big
// enough to save a "before" backup first (an import, a bulk delete, a
// Finance re-price, a module's data replaced). Pure and tested.

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const keyOf = (x: unknown, i: number): string => (isRecord(x) && (typeof x.id === 'string' || typeof x.id === 'number') ? `id:${x.id}` : `at:${i}`)

/** The records of an app's data: every item of each top-level list and each entry of each top-level map, keyed. */
export function recordsOf(data: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!isRecord(data)) return out
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.set(`${k}/${keyOf(x, i)}`, JSON.stringify(x)))
    else if (isRecord(v) && Object.values(v).some((x) => isRecord(x) || Array.isArray(x))) for (const [kk, x] of Object.entries(v)) out.set(`${k}.${kk}`, JSON.stringify(x))
  }
  return out
}

export interface ChangeSize {
  removed: number
  changed: number
  added: number
  before: number
}

export function changeSize(before: unknown, after: unknown): ChangeSize {
  const a = recordsOf(before)
  const b = recordsOf(after)
  let removed = 0
  let changed = 0
  let added = 0
  for (const [k, v] of a) {
    if (!b.has(k)) removed++
    else if (b.get(k) !== v) changed++
  }
  for (const k of b.keys()) if (!a.has(k)) added++
  return { removed, changed, added, before: a.size }
}

/** Big: 5 or more records removed, 20 or more changed or added at once, or a quarter of 12+ records touched. */
export function isBigChange(before: unknown, after: unknown): boolean {
  const c = changeSize(before, after)
  if (c.removed >= 5) return true
  if (c.changed + c.added >= 20) return true
  return c.before >= 12 && (c.removed + c.changed) / c.before >= 0.25
}

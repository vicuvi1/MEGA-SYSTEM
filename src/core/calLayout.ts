// How a day's events sit in the calendar grid, pure and tested:
// - long "window" events (2½ h+, with 2+ shorter ones on top) become a faint
//   band behind the column, so what happens inside them stays readable;
// - overlapping events share the width, each one widening to the right
//   where nothing overlaps it;
// - at most `maxCols` side by side: the rest fold into a "+N more" chip.

export interface Placed<T> {
  it: T
  /** Percent of the column. */
  left: number
  width: number
  backdrop: boolean
}

export interface More<T> {
  start: number
  end: number
  /** Percent of the column. */
  left: number
  width: number
  items: T[]
}

export function layoutDay<T extends { start: number; end: number }>(items: T[], maxCols = 3): { placed: Placed<T>[]; more: More<T>[] } {
  const overlaps = (a: T, b: T) => a.start < b.end && b.start < a.end
  const len = (a: T) => a.end - a.start
  const backdrop = new Set(items.filter((a) => len(a) >= 150 && items.filter((b) => b !== a && overlaps(a, b) && len(b) < len(a)).length >= 2))
  const placed: Placed<T>[] = [...backdrop].map((it) => ({ it, left: 0, width: 100, backdrop: true }))
  const more: More<T>[] = []

  const rest = items.filter((a) => !backdrop.has(a)).sort((a, b) => a.start - b.start || b.end - a.end)
  // Clusters of events that overlap each other (directly or through a chain).
  const clusters: T[][] = []
  let cur: T[] = []
  let curEnd = -1
  for (const it of rest) {
    if (cur.length && it.start >= curEnd) {
      clusters.push(cur)
      cur = []
    }
    cur.push(it)
    curEnd = Math.max(curEnd, it.end)
  }
  if (cur.length) clusters.push(cur)

  for (const group of clusters) {
    const colOf = new Map<T, number>()
    for (const it of group) {
      const used = new Set(group.filter((g) => colOf.has(g) && overlaps(g, it)).map((g) => colOf.get(g)!))
      let c = 0
      while (used.has(c)) c++
      colOf.set(it, c)
    }
    const cols = Math.max(...colOf.values()) + 1
    // Too many side by side: the last visible column becomes "+N more".
    const shown = cols > maxCols ? maxCols - 1 : cols
    const slots = cols > maxCols ? maxCols : cols
    const w = 100 / slots
    const hidden = group.filter((it) => colOf.get(it)! >= shown)
    for (const it of group) {
      const c = colOf.get(it)!
      if (c >= shown) continue
      // Widen to the right while no visible event there overlaps it.
      let span = 1
      while (c + span < shown && !group.some((g) => colOf.get(g) === c + span && overlaps(g, it))) span++
      if (c + span === shown && shown < slots && !hidden.some((g) => overlaps(g, it))) span++
      placed.push({ it, left: c * w, width: span * w, backdrop: false })
    }
    if (hidden.length) {
      // One chip per run of hidden events that overlap each other.
      const runs: T[][] = []
      for (const h of [...hidden].sort((a, b) => a.start - b.start)) {
        const last = runs[runs.length - 1]
        if (last && last.some((x) => overlaps(x, h))) last.push(h)
        else runs.push([h])
      }
      for (const r of runs) more.push({ start: Math.min(...r.map((x) => x.start)), end: Math.max(...r.map((x) => x.end)), left: shown * w, width: w, items: r })
    }
  }
  return { placed, more }
}

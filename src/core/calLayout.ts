// How a day's events sit in a calendar column, pure and tested. One engine
// for Today's "Your day" and the Calendar page's day and week views:
// - all-day items are kept apart (they go in the row above the hours);
// - long "window" events (2½ h+, with 2+ shorter ones on top) become a faint
//   band behind the column, so what happens inside them stays readable;
// - events that overlap (directly or through a chain) form a cluster and get
//   columns side by side, equal widths, each one widening to the right where
//   nothing overlaps it;
// - a short event is drawn at least `minLen` minutes tall (so its title can be
//   read), and that drawn height counts as its length for the columns: a
//   15-minute event right before another never sits on top of it;
// - at most `maxCols` side by side: the rest fold into a "+N more" chip.

export interface Placed<T> {
  it: T
  /** Percent of the column. */
  left: number
  width: number
  backdrop: boolean
  /** Column index inside its cluster, and how many columns the cluster has. */
  col: number
  cols: number
}

export interface More<T> {
  start: number
  end: number
  /** Percent of the column. */
  left: number
  width: number
  items: T[]
}

export interface LayoutOptions {
  /** Most events side by side before "+N more" (default 3). */
  maxCols?: number
  /** The shortest an event is drawn, in minutes (default 0: as long as it is). */
  minLen?: number
}

/** % of the width a backdrop band keeps for its name (written up its left edge). */
export const BAND_STRIP = 9

type Timed = { start: number; end: number; allDay?: boolean }

/** Minutes an event must be drawn so it is at least `px` tall at `hourPx` pixels an hour. */
export function minLenFor(px: number, hourPx: number): number {
  return hourPx > 0 ? Math.ceil((px / hourPx) * 60) : 0
}

export function layoutDay<T extends Timed>(all: T[], opts: number | LayoutOptions = {}): { placed: Placed<T>[]; more: More<T>[]; allDay: T[] } {
  const { maxCols = 3, minLen = 0 } = typeof opts === 'number' ? { maxCols: opts } : opts
  const allDay = all.filter((a) => a.allDay)
  const items = all.filter((a) => !a.allDay)
  // Where an event ends on screen (a short one is drawn taller than it lasts).
  const vEnd = (a: T) => Math.max(a.end, a.start + minLen)
  const overlaps = (a: T, b: T) => a.start < vEnd(b) && b.start < vEnd(a)
  const realOverlap = (a: T, b: T) => a.start < b.end && b.start < a.end
  const len = (a: T) => a.end - a.start
  const backdrop = new Set(items.filter((a) => len(a) >= 150 && items.filter((b) => b !== a && realOverlap(a, b) && len(b) < len(a)).length >= 2))
  const placed: Placed<T>[] = [...backdrop].map((it) => ({ it, left: 0, width: 100, backdrop: true, col: 0, cols: 1 }))
  const more: More<T>[] = []

  const rest = items.filter((a) => !backdrop.has(a)).sort((a, b) => a.start - b.start || b.end - a.end)
  // Clusters of events that overlap each other (directly or through a chain).
  const clusters: T[][] = []
  let cur: T[] = []
  let curEnd = -Infinity
  for (const it of rest) {
    if (cur.length && it.start >= curEnd) {
      clusters.push(cur)
      cur = []
    }
    cur.push(it)
    curEnd = Math.max(curEnd, vEnd(it))
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
    // Inside a long "window" (a backdrop band), events keep a strip on the left
    // free so the band's name stays readable instead of being covered (U8).
    const bandK = (xs: T[]) => ([...backdrop].some((b) => xs.some((x) => realOverlap(b, x))) ? 1 - BAND_STRIP / 100 : 1)
    for (const it of group) {
      const c = colOf.get(it)!
      if (c >= shown) continue
      // Widen to the right while no visible event there overlaps it.
      let span = 1
      while (c + span < shown && !group.some((g) => colOf.get(g) === c + span && overlaps(g, it))) span++
      if (c + span === shown && shown < slots && !hidden.some((g) => overlaps(g, it))) span++
      const k = bandK([it])
      placed.push({ it, left: (k < 1 ? BAND_STRIP : 0) + c * w * k, width: span * w * k, backdrop: false, col: c, cols: slots })
    }
    if (hidden.length) {
      // One chip per run of hidden events that overlap each other.
      const runs: T[][] = []
      for (const h of [...hidden].sort((a, b) => a.start - b.start)) {
        const last = runs[runs.length - 1]
        if (last && last.some((x) => overlaps(x, h))) last.push(h)
        else runs.push([h])
      }
      for (const r of runs) {
        const k = bandK(r)
        more.push({ start: Math.min(...r.map((x) => x.start)), end: Math.max(...r.map((x) => x.end)), left: (k < 1 ? BAND_STRIP : 0) + shown * w * k, width: w * k, items: r })
      }
    }
  }
  return { placed, more, allDay }
}

/** True when two placed boxes would cover each other on screen (for tests and checks). */
export function boxesOverlap<T extends Timed>(a: Placed<T>, b: Placed<T>, minLen = 0): boolean {
  const end = (p: Placed<T>) => Math.max(p.it.end, p.it.start + minLen)
  const sameTime = a.it.start < end(b) && b.it.start < end(a)
  const sameSpace = a.left < b.left + b.width - 0.001 && b.left < a.left + a.width - 0.001
  return sameTime && sameSpace
}

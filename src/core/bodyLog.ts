// The one log of water and reps (table body_log): every glass and every set,
// from any device or bot, is one row with its own id. Nothing is ever changed
// or deleted: a take-back is a row with a negative amount, and removing a
// wrong entry is a row that cancels it (and cancelling that row brings the
// entry back). Today's water and reps are the sum of the day's rows, so two
// devices that were offline merge by simply keeping every row once.
// Pure helpers only; the database side is src/main/bodyLog.ts.

export const WATER_KIND = 'water'
/** The kind for an exercise's reps (by Sport Track's exercise id). */
export const repsKind = (exerciseId: string) => `reps:${exerciseId}`

export interface BodyEvent {
  id: string
  /** ISO time it was logged. */
  at: string
  /** The app's day (turns at 04:00) it counts on. */
  day: string
  /** 'water' or 'reps:<exercise id>'. */
  kind: string
  /** ml or reps; negative takes some back. A cancel row has 0. */
  amount: number
  /** Where it came from: pc, phone, web, telegram, island, ben, sport, sporty, automation, earlier… */
  source: string
  /** The row this one cancels (removing a wrong entry, or undoing that removal). */
  undoes: string | null
}

export const SOURCE_LABEL: Record<string, string> = {
  pc: 'PC',
  phone: 'Phone',
  web: 'Website',
  telegram: 'Telegram',
  island: 'Island',
  ben: 'Ben',
  sport: 'Sport Track',
  sporty: 'Sporty',
  automation: 'Automation',
  mcp: 'AI app',
  voice: 'Voice',
  earlier: 'Logged earlier',
  fix: 'Fix'
}

export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : 'Unknown')

/** The same rows from two places, each once (by id), in time order. */
export function mergeEvents(...lists: BodyEvent[][]): BodyEvent[] {
  const byId = new Map<string, BodyEvent>()
  for (const list of lists) for (const e of list ?? []) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1))
}

/**
 * Which rows still count: a row is cancelled while a row that still counts
 * cancels it. Cancels form a chain (entry ← remove ← undo remove ← …), so the
 * newest link decides. Works on any order of rows.
 */
export function liveIds(events: BodyEvent[]): Set<string> {
  const cancelers = new Map<string, BodyEvent[]>()
  for (const e of events) if (e.undoes) (cancelers.get(e.undoes) ?? cancelers.set(e.undoes, []).get(e.undoes)!).push(e)
  const memo = new Map<string, boolean>()
  const live = (e: BodyEvent, depth = 0): boolean => {
    const known = memo.get(e.id)
    if (known != null) return known
    if (depth > 200) return true
    const v = !(cancelers.get(e.id) ?? []).some((c) => c.id !== e.id && live(c, depth + 1))
    memo.set(e.id, v)
    return v
  }
  return new Set(events.filter((e) => live(e)).map((e) => e.id))
}

/** The day's total per kind (never below 0). Cancel rows add nothing themselves. */
export function totalsOf(events: BodyEvent[], day: string): Record<string, number> {
  const mine = events.filter((e) => e.day === day)
  const live = liveIds(mine)
  const out: Record<string, number> = {}
  for (const e of mine) {
    if (e.undoes) {
      out[e.kind] ??= 0
      continue
    }
    out[e.kind] = (out[e.kind] ?? 0) + (live.has(e.id) ? Math.round(Number(e.amount) || 0) : 0)
  }
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k])
  return out
}

export interface LogEntry {
  id: string
  at: string
  amount: number
  source: string
  /** Removed (a cancel row counts); "Undo" brings it back. */
  removed: boolean
}

/** The day's entries of one kind, oldest first, for the history list (cancel rows are folded into "removed"). */
export function entriesOf(events: BodyEvent[], day: string, kind: string): LogEntry[] {
  const mine = events.filter((e) => e.day === day && e.kind === kind)
  const live = liveIds(mine)
  return mergeEvents(mine)
    .filter((e) => !e.undoes)
    .map((e) => ({ id: e.id, at: e.at, amount: Math.round(Number(e.amount) || 0), source: e.source, removed: !live.has(e.id) }))
}

/** The id of the row that flips an entry (remove ↔ bring back): the next link of its cancel chain. Same on every device, so two taps on two devices count once. */
export function toggleId(events: BodyEvent[], entryId: string): { id: string; undoes: string } {
  let tail = entryId
  const ids = new Set(events.map((e) => e.id))
  while (ids.has(`x-${tail}`)) tail = `x-${tail}`
  return { id: `x-${tail}`, undoes: tail }
}

/** Today's numbers a Sport Track copy shows: water and each exercise's reps. */
export function sportNumbers(st: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (!st || typeof st !== 'object') return out
  if (st.water && typeof st.water === 'object') out[WATER_KIND] = Math.max(0, Math.round(Number(st.water.currentMl) || 0))
  for (const e of Array.isArray(st.exercises) ? st.exercises : []) {
    const id = String(e?.id ?? e?.name ?? '')
    if (id) out[repsKind(id)] = Math.max(0, Math.round(Number(e.doneToday) || 0))
  }
  return out
}

/** What changed between two copies of the same day (kinds missing on either side don't count: a new or removed exercise is no reps). */
export function numberDeltas(before: any, after: any): { kind: string; amount: number }[] {
  if (!before || !after || String(before.lastDate ?? '') !== String(after.lastDate ?? '')) return []
  const a = sportNumbers(before)
  const b = sportNumbers(after)
  const out: { kind: string; amount: number }[] = []
  for (const [k, v] of Object.entries(b)) {
    if (!(k in a)) continue
    const d = v - a[k]
    if (d) out.push({ kind: k, amount: d })
  }
  return out
}

/** A copy with today's numbers from the log (water, every exercise's reps and the day log). Kinds the log doesn't know keep their value. */
export function withTotals(st: any, day: string, totals: Record<string, number>): any {
  if (!st || typeof st !== 'object' || String(st.lastDate ?? '') !== day) return st
  const s = JSON.parse(JSON.stringify(st))
  if (s.water && typeof s.water === 'object') {
    if (WATER_KIND in totals) s.water.currentMl = totals[WATER_KIND]
    delete s.water.fixedAt
  }
  const dayMap: Record<string, number> = {}
  for (const e of Array.isArray(s.exercises) ? s.exercises : []) {
    const k = repsKind(String(e?.id ?? e?.name ?? ''))
    if (k in totals) e.doneToday = totals[k]
    delete e.fixedAt
    if ((Number(e.doneToday) || 0) > 0) dayMap[String(e.id ?? e.name)] = Number(e.doneToday)
  }
  if (s.days && typeof s.days === 'object') {
    if (Object.keys(dayMap).length) s.days[day] = dayMap
    else delete s.days[day]
  }
  return s
}

/** Is this phone, a PC (the desktop app) or the website in a desktop browser? */
export function deviceSource(nav: { userAgent?: string } | undefined, desktop: boolean): 'pc' | 'phone' | 'web' {
  if (desktop) return 'pc'
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav?.userAgent ?? '') ? 'phone' : 'web'
}

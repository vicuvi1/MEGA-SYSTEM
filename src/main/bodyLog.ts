// The water and reps log (body_log) on any database with the better-sqlite3
// API: the web app's copy, the desktop app's, the bot server's. The shared
// Sport Track copy (settings.sport_tracker_json) is only a view of it: every
// write here logs rows first, then rewrites that copy's today numbers from
// the log, so Sporty, Telegram cards and every screen read the same sum.
import type { DB } from './db'
import { readSetting, writeSetting } from './settings'
import { addDays } from '../core/dates'
import { addReps, addWater, sportForDay, sportToday, sharedView } from '../core/sportShared'
import { defaultSport } from '../core/sportCards'
import { WATER_KIND, entriesOf, numberDeltas, sportNumbers, toggleId, totalsOf, withTotals, type BodyEvent, type LogEntry } from '../core/bodyLog'

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** The shared Sport Track copy (null when there is none yet). */
export function sportBlob(db: DB): any | null {
  try {
    return (readSetting(db, 'sport_tracker_json') as any)?.data ?? null
  } catch {
    return null
  }
}

/** The log's rows for a day (or a range of days). */
export function bodyEvents(db: DB, from: string, to = from): BodyEvent[] {
  try {
    return (db.prepare('SELECT id, at, day, kind, amount, source, undoes FROM body_log WHERE day >= ? AND day <= ? ORDER BY at, id').all(from, to) as any[]).map((r) => ({
      id: String(r.id),
      at: String(r.at),
      day: String(r.day),
      kind: String(r.kind),
      amount: Number(r.amount) || 0,
      source: String(r.source ?? ''),
      undoes: r.undoes == null ? null : String(r.undoes)
    }))
  } catch {
    return []
  }
}

/** Adds one row; false when that id is already there (the same tap sent twice counts once). */
function insert(db: DB, e: BodyEvent): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO body_log (id, at, day, kind, amount, source, undoes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(e.id, e.at, e.day, e.kind, Math.round(e.amount), e.source.slice(0, 20), e.undoes) as any
  return r?.changes == null ? true : Number(r.changes) > 0
}

/**
 * The day's numbers: the log's sums, and for a kind it has no rows of yet
 * (the day the log started), the shared copy's number from before.
 */
export function bodyTotals(db: DB, day: string, blob: any = sportBlob(db)): Record<string, number> {
  const t = totalsOf(bodyEvents(db, day), day)
  if (blob && String(blob.lastDate ?? '') === day) for (const [k, v] of Object.entries(sportNumbers(blob))) if (!(k in t)) t[k] = v
  return t
}

const dayStart = (day: string, now: Date) => {
  const t = new Date(`${day}T04:00:00`)
  return Number.isFinite(t.getTime()) && t <= now ? t.toISOString() : now.toISOString()
}

/** First write of a day the log has no rows for a kind yet: what the copy already had becomes one "logged earlier" row (same id on every device). */
function seed(db: DB, day: string, from: any, now: Date): void {
  if (!from || String(from.lastDate ?? '') !== day) return
  const have = new Set(bodyEvents(db, day).map((e) => e.kind))
  for (const [kind, v] of Object.entries(sportNumbers(from))) {
    // Dated at the day's start, so it lists first ("before").
    if (v > 0 && !have.has(kind)) insert(db, { id: `seed:${day}:${kind}`, at: dayStart(day, now), day, kind, amount: v, source: 'earlier', undoes: null })
  }
}

/**
 * A Sport Track copy (this device's, or a merge of two) with today's water and
 * reps from the log. `canWrite` (inside a change): the day the log starts, the
 * copy's numbers first become "logged earlier" rows.
 */
export function sportFromLog(db: DB, st: any, canWrite: boolean, now = new Date()): any {
  const day = sportToday(now)
  if (!st || typeof st !== 'object' || String(st.lastDate ?? '') !== day) return st
  if (canWrite) seed(db, day, st, now)
  return withTotals(st, day, bodyTotals(db, day, st))
}

/** Rewrites the shared copy's today numbers from the log (nothing when they already match). */
function writeView(db: DB, st: any, day: string, base: any = st): any {
  const final = withTotals(st, day, bodyTotals(db, day, st))
  const numbersOnly = shape(base, day) === shape(final, day)
  const now = Date.now()
  // `editedAt` says when the copy itself last changed. Only today's numbers changing keeps it: they come from the
  // log, so a glass of water or a logged set must not make this copy "newer" than an exercise added on a device
  // that hasn't synced yet (the sync keeps the newer copy's exercise list, so that exercise and its sets were lost).
  let prevEdited = 0
  if (numbersOnly) {
    try {
      const prev = readSetting(db, 'sport_tracker_json') as any
      prevEdited = Number(prev?.editedAt ?? prev?.savedAt) || 0
    } catch {
      prevEdited = 0
    }
  }
  const value = { savedAt: now, editedAt: numbersOnly && prevEdited ? prevEdited : now, data: final }
  // Only today's numbers changed: written without the "still as I read it"
  // check, so a glass logged offline is never refused later because another
  // device logged one too (the numbers come from the log anyway). A change to
  // the exercises themselves keeps the check (it must not undo another edit).
  if (numbersOnly) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('sport_tracker_json', JSON.stringify(value))
  else writeSetting(db, 'sport_tracker_json', value)
  return final
}

/** A copy without today's numbers (to tell a number change from an edit of the exercises). */
function shape(st: any, day: string): string {
  if (!st || typeof st !== 'object') return JSON.stringify(st)
  const s = JSON.parse(JSON.stringify(st))
  if (s.water && typeof s.water === 'object') (delete s.water.currentMl, delete s.water.fixedAt)
  for (const e of Array.isArray(s.exercises) ? s.exercises : []) if (e && typeof e === 'object') (delete e.doneToday, delete e.fixedAt)
  if (s.days && typeof s.days === 'object') delete s.days[day]
  delete s.lastDate
  return JSON.stringify(s)
}

/**
 * Saves a changed Sport Track copy through the log: what changed today
 * (water, reps) becomes rows, then the copy is written with the log's sums.
 * Every place that used to write sport_tracker_json goes through here.
 * `id`: a fixed id for the row (a tap from the island or Telegram sent twice counts once).
 */
export function saveSport(db: DB, next: any, source: string, opts: { id?: string; now?: Date } = {}): any {
  const now = opts.now ?? new Date()
  const day = sportToday(now)
  const raw = sportBlob(db)
  const forDay = raw ? sportForDay(raw, day) : null
  if (forDay) seed(db, day, forDay, now)
  // What the caller started from: the copy with the log's numbers (sportNow), so the change is exact.
  const prev = forDay ? withTotals(forDay, day, bodyTotals(db, day, forDay)) : next ? sportForDay({ ...next, lastDate: '' }, day) : null
  if (prev && next && String(next.lastDate ?? '') === day) {
    const deltas = numberDeltas(prev, next)
    const totals = bodyTotals(db, day, prev)
    deltas.forEach((d, i) => {
      // A take-back never goes below 0 (the log's sum, not the copy's number).
      const amount = d.amount < 0 ? Math.max(d.amount, -(totals[d.kind] ?? 0)) : d.amount
      if (!amount) return
      const id = opts.id ? (deltas.length > 1 ? `${opts.id}-${i}` : opts.id) : rid()
      if (insert(db, { id, at: now.toISOString(), day, kind: d.kind, amount, source, undoes: null })) totals[d.kind] = (totals[d.kind] ?? 0) + amount
    })
  }
  return next ? writeView(db, next, day, forDay) : next
}

/** The shared copy for today with the log's numbers (null when there is none yet). Start every change from this. */
export function sportNow(db: DB, now = new Date()): any | null {
  const raw = sportBlob(db)
  if (!raw) return null
  const day = sportToday(now)
  const st = sportForDay(raw, day)
  return withTotals(st, day, bodyTotals(db, day, st))
}

/** Adds (or with a negative number takes back) water; today's water and goal after it. */
export function logWater(db: DB, ml: number, source: string, opts: { id?: string; now?: Date } = {}): { ml: number; target: number; glass: number } {
  const day = sportToday(opts.now ?? new Date())
  const st = saveSport(db, addWater(sportNow(db, opts.now) ?? defaultSport(day), ml, day), source, opts)
  return sharedView(st, day).water
}

/** Adds reps to an exercise on today's checklist (null when it isn't there). */
export function logReps(db: DB, name: string, amount: number, source: string, opts: { id?: string; now?: Date } = {}): { st: any; exercise: { name: string; done: number; target: number } } | null {
  const day = sportToday(opts.now ?? new Date())
  const st = sportNow(db, opts.now)
  if (!st) return null
  const r = addReps(st, name, amount, day)
  if (!r) return null
  const saved = saveSport(db, r.st, source, opts)
  const view = sharedView(saved, day).exercises.find((e) => e.name === r.exercise.name)
  return { st: saved, exercise: { ...r.exercise, done: view?.done ?? r.exercise.done } }
}

/** Several changes at once (from an embedded app or this device's copy): rows with their own ids. */
export function logChanges(db: DB, list: { kind: string; amount: number; id?: string }[], source: string, now = new Date()): any {
  const day = sportToday(now)
  const raw = sportBlob(db)
  if (!raw) return null
  const prev = sportForDay(raw, day)
  seed(db, day, prev, now)
  const totals = bodyTotals(db, day, prev)
  for (const c of list) {
    if (!c || typeof c.kind !== 'string' || !Number.isFinite(c.amount)) continue
    const amount = c.amount < 0 ? Math.max(Math.round(c.amount), -(totals[c.kind] ?? 0)) : Math.round(c.amount)
    if (!amount || Math.abs(amount) > 5000) continue
    if (insert(db, { id: c.id ? String(c.id).slice(0, 60) : rid(), at: now.toISOString(), day, kind: c.kind, amount, source, undoes: null })) totals[c.kind] = (totals[c.kind] ?? 0) + amount
  }
  return writeView(db, prev, day)
}

/** Today's (or a day's) entries of one kind, for the history list. */
export function logEntries(db: DB, day: string, kind = WATER_KIND): LogEntry[] {
  const events = bodyEvents(db, day)
  const list = entriesOf(events, day, kind)
  // The day the log started: what was there before shows as one "logged earlier" line.
  if (!events.some((e) => e.kind === kind)) {
    const v = bodyTotals(db, day)[kind] ?? 0
    if (v > 0) return [{ id: `seed:${day}:${kind}`, at: `${day}T00:00:00.000Z`, amount: v, source: 'earlier', removed: false }]
  }
  return list
}

/** Removes a wrong entry, or brings a removed one back (a row each time, nothing deleted). Returns whether it is removed now. */
export function toggleEntry(db: DB, entryId: string, source: string, now = new Date()): { removed: boolean; day: string } | null {
  const today = sportToday(now)
  let row = db.prepare('SELECT id, day, kind FROM body_log WHERE id = ?').get(entryId) as any
  // The "logged earlier" line before it was a row: make it one first.
  if (!row && /^seed:/.test(entryId)) {
    const raw = sportBlob(db)
    if (raw) seed(db, today, sportForDay(raw, today), now)
    row = db.prepare('SELECT id, day, kind FROM body_log WHERE id = ?').get(entryId) as any
  }
  if (!row) return null
  const day = String(row.day)
  const events = bodyEvents(db, day)
  const t = toggleId(events, entryId)
  insert(db, { id: t.id, at: now.toISOString(), day, kind: String(row.kind), amount: 0, source, undoes: t.undoes })
  const after = entriesOf(bodyEvents(db, day), day, String(row.kind)).find((e) => e.id === entryId)
  const raw = sportBlob(db)
  if (day === today && raw) writeView(db, sportForDay(raw, today), today)
  return { removed: !!after?.removed, day }
}

export interface RepairChange { day: string; what: string; from: number; to: number }

/**
 * One-time check on start: today's shared copy and the last 7 days' numbers
 * (the training calendar, the island's water per day) rebuilt from the log
 * where the log has rows. Returns what changed (numbers only, no text you wrote).
 */
export function repairFromLog(db: DB, now = new Date(), days = 7): RepairChange[] {
  const today = sportToday(now)
  const from = addDays(today, -(days - 1))
  const events = bodyEvents(db, from, today)
  const changes: RepairChange[] = []
  const raw = sportBlob(db)
  if (raw) {
    const st = JSON.parse(JSON.stringify(raw))
    let dirty = false
    // Today: the copy's water and reps.
    if (String(st.lastDate ?? '') === today) {
      const totals = totalsOf(events, today)
      const before = sportNumbers(st)
      for (const [k, v] of Object.entries(totals)) if (k in before && before[k] !== v) changes.push({ day: today, what: k, from: before[k], to: v })
      const fixed = withTotals(st, today, { ...before, ...totals })
      if (JSON.stringify(fixed) !== JSON.stringify(st)) (Object.assign(st, fixed), (dirty = true))
    }
    // Past days: the training calendar's reps per exercise.
    for (let d = from; d < today; d = addDays(d, 1)) {
      const totals = totalsOf(events, d)
      const reps = Object.entries(totals).filter(([k]) => k.startsWith('reps:'))
      if (!reps.length) continue
      st.days = st.days && typeof st.days === 'object' ? st.days : {}
      const cur: Record<string, number> = { ...(st.days[d] ?? {}) }
      for (const [k, v] of reps) {
        const id = k.slice(5)
        if ((Number(cur[id]) || 0) !== v) {
          changes.push({ day: d, what: k, from: Number(cur[id]) || 0, to: v })
          if (v > 0) cur[id] = v
          else delete cur[id]
          dirty = true
        }
      }
      if (Object.keys(cur).length) st.days[d] = cur
      else delete st.days[d]
    }
    if (dirty) writeSetting(db, 'sport_tracker_json', { savedAt: Date.now(), data: st })
  }
  // The island's water per day (the weekly card, the healthy-day streak).
  try {
    const nudges = readSetting(db, 'island_nudges') as any
    if (nudges && nudges.days && typeof nudges.days === 'object') {
      let dirty = false
      const out = { ...nudges, days: { ...nudges.days } }
      for (let d = from; d <= today; d = addDays(d, 1)) {
        if (!events.some((e) => e.day === d && e.kind === WATER_KIND)) continue
        const v = totalsOf(events, d)[WATER_KIND] ?? 0
        const cur = out.days[d]
        if (cur && typeof cur === 'object' && Number(cur.water ?? 0) !== v) {
          changes.push({ day: d, what: 'island water', from: Number(cur.water) || 0, to: v })
          out.days[d] = { ...cur, water: v }
          dirty = true
        }
      }
      if (dirty) writeSetting(db, 'island_nudges', out)
    }
  } catch {
    /* no island data */
  }
  return changes
}

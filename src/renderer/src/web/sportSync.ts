// Sport Track keeps its data in this browser (localStorage). This copies it
// to Turso (settings.sport_tracker_json) and back, so the phone and the PC
// see the same reps, water and workout history. When both changed, they are
// merged: history from both; today's water and reps come from the one log
// (body_log, see main/bodyLog.ts), never from the higher of two copies.
import { createAppSync, type AppSyncSpec } from './appSync'
import type { Mirror } from './mirror'
import { sportFromLog } from '../../../main/bodyLog'

export const SPORT_KEY = 'life_sport_tracker_v1'
const SETTING = 'sport_tracker_json'
const day = (s: any) => String(s?.lastDate ?? '')

/** The same day's count from two devices: the later correction wins, else the higher number. */
const pick = (a: number, aFix: number, b: number, bFix: number) => (aFix || bFix ? (aFix >= bFix ? a : b) : Math.max(a, b))

/** Both versions in one; `newer` wins where they disagree. */
export function mergeSport(a: any, b: any, aIsNewer: boolean): any {
  const newer = aIsNewer ? a : b
  const older = aIsNewer ? b : a
  const out: any = { ...older, ...newer }
  // Today's numbers come from the later day (yesterday's reps don't count today).
  const later = day(a) >= day(b) ? a : b
  const sameDay = day(a) === day(b)
  out.lastDate = later.lastDate
  const byId = (list: any) => new Map((Array.isArray(list) ? list : []).map((e: any) => [String(e.id ?? e.name), e]))
  const fromLater = byId(later.exercises)
  const fromOther = byId((later === a ? b : a).exercises)
  out.exercises = (Array.isArray(newer.exercises) ? newer.exercises : later.exercises ?? []).map((e: any) => {
    const k = String(e.id ?? e.name)
    const x = fromLater.get(k)
    const y = fromOther.get(k)
    const done = sameDay ? pick(Number(x?.doneToday) || 0, Number(x?.fixedAt) || 0, Number(y?.doneToday) || 0, Number(y?.fixedAt) || 0) : Number(x?.doneToday) || 0
    const fixedAt = Math.max(Number(x?.fixedAt) || 0, sameDay ? Number(y?.fixedAt) || 0 : 0)
    return { ...e, doneToday: done, ...(fixedAt ? { fixedAt } : {}) }
  })
  if (newer.water || later.water) {
    const ml = sameDay ? pick(Number(a.water?.currentMl) || 0, Number(a.water?.fixedAt) || 0, Number(b.water?.currentMl) || 0, Number(b.water?.fixedAt) || 0) : Number(later.water?.currentMl) || 0
    const fixedAt = Math.max(Number(a.water?.fixedAt) || 0, Number(b.water?.fixedAt) || 0)
    out.water = { ...(older.water ?? {}), ...(newer.water ?? {}), currentMl: ml, ...(fixedAt ? { fixedAt } : {}) }
  }
  const seen = new Set<string>()
  out.history = [...(Array.isArray(newer.history) ? newer.history : []), ...(Array.isArray(older.history) ? older.history : [])]
    .filter((h: any) => {
      const k = JSON.stringify([h?.id, h?.title])
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((x: any, y: any) => (Number(y?.id) || 0) - (Number(x?.id) || 0))
  if (typeof a.xp === 'number' || typeof b.xp === 'number') out.xp = Math.max(Number(a.xp) || 0, Number(b.xp) || 0)
  // The day log (the calendar): every day from both; a day changed on the
  // newer device wins, and today keeps the higher count per exercise.
  if (a.days || b.days) {
    const days: Record<string, Record<string, number>> = { ...(older.days ?? {}), ...(newer.days ?? {}) }
    const today = out.lastDate
    if (sameDay && today) {
      const m: Record<string, number> = { ...(older.days?.[today] ?? {}) }
      for (const [k, v] of Object.entries(newer.days?.[today] ?? {})) m[k] = Math.max(Number(m[k]) || 0, Number(v) || 0)
      if (Object.keys(m).length) days[today] = m
    }
    out.days = days
  }
  if (a.daysBackfilled || b.daysBackfilled) out.daysBackfilled = true
  return out
}

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const SPORT: AppSyncSpec = {
  localKey: SPORT_KEY,
  setting: SETTING,
  event: 'life-sport-changed',
  merge: mergeSport,
  // Today's water and reps are never decided by comparing two copies: they
  // are the sum of the one log (body_log), so every device shows the same.
  finalize: (db, merged, canWrite) => sportFromLog(db, merged, canWrite),
  lists: [{ path: 'history', key: (h) => JSON.stringify([h?.id, h?.title]) }]
}

export function createSportSync(mirror: Mirror, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
  return createAppSync(mirror, SPORT, store)
}

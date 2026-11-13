// Sport Track keeps its data in this browser (localStorage). This copies it
// to Turso (settings.sport_tracker_json) and back, so the phone and the PC
// see the same reps, water and workout history. When both changed, they are
// merged: history from both; today's water and reps come from the one log
// (body_log, see main/bodyLog.ts), never from the higher of two copies.
import { createAppSync, type AppSyncSpec } from './appSync'
import type { Mirror } from './mirror'
import { sportFromLog } from '../../../main/bodyLog'
import { mergeSets } from '../../../core/sportSets'
import { mergeTrain } from '../../../core/trainLog'

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
  // Every exercise from both devices (the newer device's order first, then
  // ones only the older device has, e.g. added there while offline). An
  // exercise deleted on either device stays deleted: `exercises` is in the
  // spec's `lists`, so the sync drops what left the last synced copy.
  const exKey = (e: any) => String(e?.id ?? e?.name)
  const fromNewer = Array.isArray(newer.exercises) ? newer.exercises : []
  const newerKeys = new Set(fromNewer.map(exKey))
  const onlyOlder = (Array.isArray(older.exercises) ? older.exercises : []).filter((e: any) => !newerKeys.has(exKey(e)))
  out.exercises = [...fromNewer, ...onlyOlder].map((e: any) => {
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
  // The day log (the calendar): every day from both; on a day changed on
  // both, each exercise from both (the newer device's count where both have
  // one), and today keeps the higher count per exercise.
  if (a.days || b.days) {
    // A past day changed on both devices keeps both: each exercise's count, the newer device's where both have one.
    const days: Record<string, Record<string, number>> = { ...(older.days ?? {}) }
    for (const [d, v] of Object.entries<any>(newer.days ?? {})) days[d] = older.days?.[d] && typeof older.days[d] === 'object' && v && typeof v === 'object' ? { ...older.days[d], ...v } : v
    const today = out.lastDate
    if (sameDay && today) {
      const m: Record<string, number> = { ...(older.days?.[today] ?? {}) }
      for (const [k, v] of Object.entries(newer.days?.[today] ?? {})) m[k] = Math.max(Number(m[k]) || 0, Number(v) || 0)
      if (Object.keys(m).length) days[today] = m
    }
    out.days = days
  }
  if (a.daysBackfilled || b.daysBackfilled) out.daysBackfilled = true
  // Badges already shown (id → day) and "not yet" for a harder move (id → the
  // day it may come back): from both devices, so a badge never pops twice.
  if (a.badges || b.badges) {
    const seen: Record<string, string> = { ...(older.badges ?? {}) }
    for (const [k, v] of Object.entries(newer.badges ?? {})) seen[k] = seen[k] && seen[k] < String(v) ? seen[k] : String(v)
    out.badges = seen
  }
  // SP3: sets from both devices (each set once, by its id), the best set per
  // exercise (the higher), level ups already shown and Telegram imports.
  if (a.sets || b.sets) out.sets = mergeSets(older.sets, newer.sets)
  if (a.setsImported || b.setsImported) out.setsImported = true
  // Telegram-imported days (day → exercise ids): from both devices.
  if (a.importedDays || b.importedDays) {
    const imp: Record<string, string[]> = {}
    for (const src of [a.importedDays, b.importedDays]) for (const [d, ids] of Object.entries<any>(src ?? {})) imp[d] = [...new Set([...(imp[d] ?? []), ...(Array.isArray(ids) ? ids.map(String) : [])])]
    out.importedDays = imp
  }
  if (a.best || b.best) {
    const best: Record<string, any> = { ...(older.best ?? {}) }
    for (const [k, v] of Object.entries<any>(newer.best ?? {})) if (!best[k] || (Number(v?.score) || 0) >= (Number(best[k]?.score) || 0)) best[k] = v
    out.best = best
  }
  // Coach: the levels already shown (the higher per ladder) and milestones already noted, so neither pops twice.
  // Goals, the program and the easy week follow the newer device.
  if (a.lvSeen || b.lvSeen) {
    const lv: Record<string, number> = { ...(older.lvSeen ?? {}) }
    for (const [k, v] of Object.entries(newer.lvSeen ?? {})) lv[k] = Math.max(Number(lv[k]) || 0, Number(v) || 0)
    out.lvSeen = lv
  }
  if (a.msSeen || b.msSeen) out.msSeen = { ...(older.msSeen ?? {}), ...(newer.msSeen ?? {}) }
  if (a.levelSeen || b.levelSeen) out.levelSeen = { ...(older.levelSeen ?? {}), ...(newer.levelSeen ?? {}) }
  if (a.notYet || b.notYet) {
    const later: Record<string, string> = { ...(older.notYet ?? {}) }
    for (const [k, v] of Object.entries(newer.notYet ?? {})) later[k] = later[k] && later[k] > String(v) ? later[k] : String(v)
    out.notYet = later
  }
  // Body → Training: sessions from both devices (by id); the week, your ladders and each level from the newer edit.
  Object.assign(out, mergeTrain(a, b))
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
  label: 'Sport Track',
  setting: SETTING,
  event: 'life-sport-changed',
  merge: mergeSport,
  // Today's water and reps are never decided by comparing two copies: they
  // are the sum of the one log (body_log), so every device shows the same.
  finalize: (db, merged, canWrite) => sportFromLog(db, merged, canWrite),
  lists: [
    { path: 'history', key: (h) => JSON.stringify([h?.id, h?.title]) },
    { path: 'exercises', key: (e) => String(e?.id ?? e?.name) }
  ]
}

export function createSportSync(mirror: Mirror, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
  return createAppSync(mirror, SPORT, store)
}

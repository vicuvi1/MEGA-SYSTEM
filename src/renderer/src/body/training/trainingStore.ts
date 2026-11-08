// Body → Training keeps its data inside Sport Track's state (`homeTraining`),
// so it syncs with the rest of Sport Track (settings.sport_tracker_json, the
// newer device wins for this field) and Sport Track's Today reads the program
// it writes (`state.program`, todayRoutine). Nothing here pays points.
import { useCallback, useEffect, useState } from 'react'
import { dayKey } from '@core/dates'
import { applyHomeProgram, blockWeek, cleanPrefs, type HomePrefs, type HomeProgram } from '@core/homeProgram'
import { challengeProgress, defOf, snapToday, type Badge, type Joined, type SportLog } from '@core/challenges'
import type { HistoryInput } from '@core/sportLevels'
import { readSport, SPORT_KEY, sportDay, updateSport } from '../../sportTrack'

export interface HomeTraining {
  prefs: HomePrefs
  /** The program in use (the copy Today follows), or null. */
  active: { startedOn: string; week: number; program: HomeProgram } | null
  challenges: Joined[]
  badges: Badge[]
}

export function cleanTraining(x: unknown): HomeTraining {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, any>
  const active = o.active && typeof o.active === 'object' && o.active.program && typeof o.active.startedOn === 'string' ? o.active : null
  return {
    prefs: cleanPrefs(o.prefs),
    active,
    challenges: Array.isArray(o.challenges) ? o.challenges.filter((j: any) => j && typeof j.id === 'string' && typeof j.joinedOn === 'string') : [],
    badges: Array.isArray(o.badges) ? o.badges.filter((b: any) => b && typeof b.key === 'string') : []
  }
}

/** Your Sport Track log as the levels and challenges read it. */
export function historyOf(st: any, today: string): HistoryInput {
  return { exercises: Array.isArray(st?.exercises) ? st.exercises : [], days: st?.days ?? {}, sets: st?.sets ?? {}, today, best: st?.bestSets ?? null, imported: st?.importedDays ?? null }
}
export const logOf = (st: any): SportLog => ({ exercises: Array.isArray(st?.exercises) ? st.exercises : [], days: st?.days ?? {}, sets: st?.sets ?? {}, importedDays: st?.importedDays ?? null })

/** Changes Sport Track's state (made if this device has none yet) and our part of it. */
export function saveTraining(fn: (st: any, ht: HomeTraining) => void): any | null {
  if (!readSport()) {
    try {
      localStorage.setItem(SPORT_KEY, JSON.stringify({ lastDate: sportDay(), exercises: [], days: {}, sets: {}, history: [], sportySettings: {} }))
    } catch {
      return null
    }
  }
  return updateSport((st) => {
    const ht = cleanTraining(st.homeTraining)
    fn(st, ht)
    st.homeTraining = ht
  })
}

/**
 * Keeps things right for today, writing only when something changed: the program's targets follow the
 * week of the block, a program stopped in Sport Track is no longer "in use", today's totals are kept in
 * each running challenge, and a finished challenge gets its badge (no points).
 */
export function syncTraining(today = dayKey(new Date())): Badge[] {
  const st = readSport()
  if (!st || !Array.isArray(st.exercises)) return []
  const ht = cleanTraining(st.homeTraining)
  const log = logOf(st)
  let changed = false
  const fresh: Badge[] = []
  const next: HomeTraining = { ...ht, challenges: ht.challenges.map((j) => ({ ...j })), badges: [...ht.badges] }
  let exercises = st.exercises
  let dropActive = false
  if (ht.active) {
    if (st.program?.id !== 'home') dropActive = true
    else {
      const w = blockWeek(ht.active.startedOn, today)
      if (w !== ht.active.week) {
        exercises = applyHomeProgram(st.exercises, ht.active.program, w, today)
        next.active = { ...ht.active, week: w }
        changed = true
      }
    }
  }
  if (dropActive) {
    next.active = null
    changed = true
  }
  next.challenges = next.challenges.map((j) => {
    const def = defOf(j)
    if (!def) return j
    const snapped = snapToday(j, def, log, today)
    if (snapped !== j) changed = true
    const pr = challengeProgress(def, snapped, log, today)
    const key = `${j.id}@${j.joinedOn}`
    if (pr.done && !next.badges.some((b) => b.key === key)) {
      const b = { key, id: j.id, name: def.badge, day: pr.doneOn ?? today }
      next.badges.push(b)
      fresh.push(b)
      changed = true
    }
    return snapped
  })
  if (changed)
    updateSport(
      (s) => {
        s.homeTraining = next
        if (exercises !== st.exercises) s.exercises = exercises
      },
      { log: false }
    )
  return fresh
}

/** Sport Track's state and our part, kept fresh when anything changes it. */
export function useTraining(): { st: any | null; ht: HomeTraining; today: string; refresh: () => void } {
  const read = useCallback(() => {
    const st = readSport()
    return { st, ht: cleanTraining(st?.homeTraining), today: dayKey(new Date()) }
  }, [])
  const [v, setV] = useState(read)
  const refresh = useCallback(() => setV(read()), [read])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => (e.key == null || e.key === SPORT_KEY) && refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('life-sport-changed', refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('life-sport-changed', refresh)
    }
  }, [refresh])
  return { ...v, refresh }
}

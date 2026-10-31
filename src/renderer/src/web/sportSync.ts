// Sport Track keeps its data in this browser (localStorage). This copies it
// to Turso (settings.sport_tracker_json) and back, so the phone and the PC
// see the same reps, water and workout history. When both changed, they are
// merged: history from both, and for the same day the higher rep counts.
import { getSetting, setSetting } from '../../../main/settings'
import type { Mirror } from './mirror'

export const SPORT_KEY = 'life_sport_tracker_v1'
const SETTING = 'sport_tracker_json'
const SYNCED = 'life_sport_synced' // the version both sides last agreed on
const EDITED = 'life_sport_edited_at'

interface Saved { savedAt: number; data: any }

const day = (s: any) => String(s?.lastDate ?? '')

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
    const done = sameDay
      ? Math.max(Number(fromLater.get(k)?.doneToday) || 0, Number(fromOther.get(k)?.doneToday) || 0)
      : Number(fromLater.get(k)?.doneToday) || 0
    return { ...e, doneToday: done }
  })
  if (newer.water || later.water) {
    const ml = sameDay ? Math.max(Number(a.water?.currentMl) || 0, Number(b.water?.currentMl) || 0) : Number(later.water?.currentMl) || 0
    out.water = { ...(older.water ?? {}), ...(newer.water ?? {}), currentMl: ml }
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
  return out
}

const parse = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function createSportSync(mirror: Mirror, store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const get = (k: string) => {
    try {
      return store?.getItem(k) ?? null
    } catch {
      return null
    }
  }
  const set = (k: string, v: string) => {
    try {
      store?.setItem(k, v)
    } catch {
      /* private window */
    }
  }

  /** Sport Track changed on this device (its page, the bot, the daily quest). */
  const noteEdit = () => {
    if (get(SPORT_KEY) !== get(SYNCED)) set(EDITED, String(Date.now()))
  }

  const once = async (): Promise<void> => {
    const local = get(SPORT_KEY)
    const synced = get(SYNCED)
    const localChanged = local != null && local !== synced
    const remoteNow = await mirror.read((db) => parse(getSetting(db as any, SETTING)) as Saved | null)
    const remoteRaw = remoteNow?.data ? JSON.stringify(remoteNow.data) : null
    const remoteChanged = remoteRaw != null && remoteRaw !== synced
    if (!localChanged && !remoteChanged) return

    let result: string
    if (localChanged) {
      const edited = Number(get(EDITED)) || Date.now()
      result = await mirror.write((db) => {
        // Read again inside the change: another device may have just saved.
        const remote = parse(getSetting(db as any, SETTING)) as Saved | null
        const mine = parse(local)
        const merged = remote?.data && JSON.stringify(remote.data) !== synced ? mergeSport(mine, remote.data, edited >= (remote.savedAt || 0)) : mine
        const raw = JSON.stringify(merged)
        setSetting(db as any, SETTING, JSON.stringify({ savedAt: Date.now(), data: merged }))
        return raw
      })
    } else {
      result = remoteRaw!
    }
    set(SYNCED, result)
    if (result !== get(SPORT_KEY)) {
      set(SPORT_KEY, result)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-sport-changed', { detail: { fromSync: true } }))
    }
  }

  /** Copies changes both ways; safe to call often (one run at a time). */
  const sync = (): Promise<void> => {
    if (running) return running.then(() => sync())
    running = once()
      .catch(() => {
        /* offline or another device saved first: the next run retries */
      })
      .finally(() => (running = null))
    return running
  }

  const soon = () => {
    noteEdit()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void sync(), 1500)
  }

  return { sync, soon }
}
